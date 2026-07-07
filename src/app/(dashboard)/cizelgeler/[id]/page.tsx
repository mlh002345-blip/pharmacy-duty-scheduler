import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CalendarCheck, CalendarRange, MapPin, Scale } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatCard } from "@/components/layout/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ListBanner } from "@/components/layout/list-banner";
import { SubmitButton } from "@/components/layout/submit-button";
import { ExportButton } from "@/components/layout/export-button";
import { prisma } from "@/lib/prisma";
import {
  dateAtUtcMidnight,
  daysInMonth,
  getTurkishDayName,
  getTurkishMonthName,
  toDateKey,
} from "@/lib/scheduling/date-tr";
import { DUTY_SCHEDULE_STATUS_LABELS } from "@/lib/scheduling/duty-schedule-labels";
import { findDutyRequestConflicts } from "@/lib/scheduling/duty-assignment-edit";
import { DUTY_REQUEST_TYPE_LABELS } from "@/lib/duty-requests/labels";
import { getCurrentUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import {
  BALANCE_STATUS_LABELS,
  classifyBalance,
  formatPoints,
  meanOf,
} from "@/lib/balance/balance-status";
import { publishDutyScheduleAction, unpublishDutyScheduleAction } from "../actions";

export const dynamic = "force-dynamic";

type FairnessRow = {
  pharmacyId: string;
  name: string;
  totalDuties: number;
  weekendDuties: number;
  holidayDuties: number;
  totalLoadScore: number;
  lastDutyDate: Date;
};

// Manuel atama gerekçesi tek kelimeyle "talep" gibi kısa girilmişse,
// tabloda anlamı belirsiz kalmasın diye daha açık bir ifadeyle gösterilir.
function formatAssignmentNote(note: string, isManual: boolean): string {
  if (isManual && note.trim().toLocaleLowerCase("tr") === "talep") {
    return "Talep doğrultusunda manuel atama";
  }
  return note;
}

export default async function CizelgeDetayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { id } = await params;
  const { success, error } = await searchParams;

  const user = await getCurrentUser();
  const canPublish = !!user && hasPermission(user.role, "publishSchedule");
  const canEditAssignment = !!user && hasPermission(user.role, "editAssignment");

  const schedule = await prisma.dutySchedule.findUnique({
    where: { id },
    select: {
      id: true,
      month: true,
      year: true,
      status: true,
      regionId: true,
      region: { select: { name: true, dailyDutyCount: true } },
      assignments: {
        select: {
          id: true,
          date: true,
          weight: true,
          note: true,
          isManual: true,
          pharmacyId: true,
          pharmacy: { select: { name: true, phone: true, address: true } },
        },
        orderBy: [{ date: "asc" }, { pharmacy: { name: "asc" } }],
      },
      warnings: {
        select: { id: true, date: true, message: true },
        orderBy: { date: "asc" },
      },
    },
  });

  if (!schedule) notFound();

  const totalDays = daysInMonth(schedule.year, schedule.month);

  const monthStart = dateAtUtcMidnight(schedule.year, schedule.month, 1);
  const monthEnd = dateAtUtcMidnight(schedule.year, schedule.month, totalDays);
  const holidaysInMonth = await prisma.holiday.findMany({
    where: { date: { gte: monthStart, lte: monthEnd } },
    select: { date: true },
  });
  const holidayDateKeys = new Set(holidaysInMonth.map((h) => toDateKey(h.date)));
  const isHolidayDate = (date: Date) => holidayDateKeys.has(toDateKey(date));

  // Dikkate Alınan Nöbet Talepleri: bu dönemle çakışan, ilgili bölgedeki
  // talepler (yalnızca özet gösterim amaçlı, çizelgeyi tekrar hesaplamaz).
  const dutyRequestCounts = await prisma.dutyRequest.groupBy({
    by: ["requestType", "status"],
    where: {
      pharmacy: { regionId: schedule.regionId },
      startDate: { lte: monthEnd },
      endDate: { gte: monthStart },
    },
    _count: { _all: true },
  });
  const countFor = (requestType: string, status: string) =>
    dutyRequestCounts.find((c) => c.requestType === requestType && c.status === status)
      ?._count._all ?? 0;
  const approvedCannotDutyCount = countFor("CANNOT_DUTY", "APPROVED");
  const approvedEmergencyCount = countFor("EMERGENCY_EXCUSE", "APPROVED");
  const pendingCount =
    countFor("CANNOT_DUTY", "PENDING") +
    countFor("EMERGENCY_EXCUSE", "PENDING") +
    countFor("PREFER_DUTY", "PENDING") +
    countFor("SWAP_REQUEST", "PENDING");

  // Nöbet Talebi Çakışması: bu düzeltmeden önce oluşmuş veya manuel olarak
  // girilmiş, onaylı bir kesin kısıt talebiyle çakışan atamaları tespit eder.
  const assignmentPharmacyIds = [
    ...new Set(schedule.assignments.map((a) => a.pharmacyId)),
  ];
  const approvedBlockingRequests = await prisma.dutyRequest.findMany({
    where: {
      pharmacyId: { in: assignmentPharmacyIds },
      status: "APPROVED",
      requestType: { in: ["CANNOT_DUTY", "EMERGENCY_EXCUSE"] },
    },
    select: { pharmacyId: true, requestType: true, startDate: true, endDate: true },
  });
  const requestConflicts = findDutyRequestConflicts({
    assignments: schedule.assignments.map((a) => ({
      id: a.id,
      pharmacyId: a.pharmacyId,
      date: a.date,
    })),
    dutyRequests: approvedBlockingRequests as {
      pharmacyId: string;
      requestType: "CANNOT_DUTY" | "EMERGENCY_EXCUSE";
      startDate: Date;
      endDate: Date;
    }[],
  });
  const assignmentById = new Map(schedule.assignments.map((a) => [a.id, a]));

  const fairnessMap = new Map<string, FairnessRow>();
  for (const assignment of schedule.assignments) {
    const isWeekendDate =
      assignment.date.getUTCDay() === 0 || assignment.date.getUTCDay() === 6;
    const isHolidayDuty = isHolidayDate(assignment.date);
    const existing = fairnessMap.get(assignment.pharmacyId);
    if (!existing) {
      fairnessMap.set(assignment.pharmacyId, {
        pharmacyId: assignment.pharmacyId,
        name: assignment.pharmacy.name,
        totalDuties: 1,
        weekendDuties: isWeekendDate ? 1 : 0,
        holidayDuties: isHolidayDuty ? 1 : 0,
        totalLoadScore: assignment.weight,
        lastDutyDate: assignment.date,
      });
    } else {
      existing.totalDuties += 1;
      if (isWeekendDate) existing.weekendDuties += 1;
      if (isHolidayDuty) existing.holidayDuties += 1;
      existing.totalLoadScore += assignment.weight;
      if (assignment.date > existing.lastDutyDate) {
        existing.lastDutyDate = assignment.date;
      }
    }
  }
  const fairnessRows = Array.from(fairnessMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "tr")
  );
  const maxLoadScore = fairnessRows.reduce(
    (max, row) => Math.max(max, row.totalLoadScore),
    0
  );

  // Nöbet dengesi bileşenleri: geçmiş nöbet puanı, manuel denge düzeltmesi
  // ve yeni sistemdeki (tüm çizelgeler) toplam nöbet puanı.
  const pharmacyIds = fairnessRows.map((row) => row.pharmacyId);
  const [historicalGroups, adjustmentGroups, generatedGroups] = await Promise.all([
    prisma.historicalDutyRecord.groupBy({
      by: ["pharmacyId"],
      where: { matchStatus: "MATCHED", pharmacyId: { in: pharmacyIds } },
      _sum: { weight: true },
    }),
    prisma.dutyBalanceAdjustment.groupBy({
      by: ["pharmacyId"],
      where: { pharmacyId: { in: pharmacyIds } },
      _sum: { points: true },
    }),
    prisma.dutyAssignment.groupBy({
      by: ["pharmacyId"],
      where: { pharmacyId: { in: pharmacyIds } },
      _sum: { weight: true },
    }),
  ]);
  const historicalByPharmacy = new Map(
    historicalGroups.map((g) => [g.pharmacyId as string, g._sum.weight ?? 0])
  );
  const adjustmentByPharmacy = new Map(
    adjustmentGroups.map((g) => [g.pharmacyId, g._sum.points ?? 0])
  );
  const generatedByPharmacy = new Map(
    generatedGroups.map((g) => [g.pharmacyId, g._sum.weight ?? 0])
  );

  const balanceRows = fairnessRows.map((row) => {
    const historicalPoints = historicalByPharmacy.get(row.pharmacyId) ?? 0;
    const adjustmentPoints = adjustmentByPharmacy.get(row.pharmacyId) ?? 0;
    const generatedPoints = generatedByPharmacy.get(row.pharmacyId) ?? 0;
    return {
      ...row,
      historicalPoints,
      adjustmentPoints,
      generatedPoints,
      totalBalance: historicalPoints + adjustmentPoints + generatedPoints,
    };
  });
  const meanBalance = meanOf(balanceRows.map((row) => row.totalBalance));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="bg-primary/10 text-primary mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl">
            <CalendarRange className="size-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight">
                {schedule.region.name} {getTurkishMonthName(schedule.month)} {schedule.year}
              </h1>
              <Badge variant={schedule.status === "DRAFT" ? "warning" : "success"}>
                {DUTY_SCHEDULE_STATUS_LABELS[schedule.status] ?? schedule.status}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {getTurkishMonthName(schedule.month)} {schedule.year} dönemi nöbet çizelgesi.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-2 rounded-xl border bg-white p-1.5 shadow-sm">
            <ExportButton
              href={`/cizelgeler/${schedule.id}/export/excel`}
              label="Excel'e Aktar"
              size="sm"
            />
            <ExportButton
              href={`/cizelgeler/${schedule.id}/export/pdf`}
              label="PDF İndir"
              size="sm"
            />
          </div>
          {canPublish &&
            (schedule.status === "DRAFT" ? (
              <form action={publishDutyScheduleAction.bind(null, schedule.id)}>
                <SubmitButton>Yayınla</SubmitButton>
              </form>
            ) : (
              <form action={unpublishDutyScheduleAction.bind(null, schedule.id)}>
                <SubmitButton variant="secondary">Yayından Kaldır</SubmitButton>
              </form>
            ))}
        </div>
      </div>

      <ListBanner success={success} error={error} />

      {requestConflicts.length > 0 && (
        <div className="border-destructive/50 bg-destructive/10 rounded-xl border p-5">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="text-destructive size-5 shrink-0" />
            <div>
              <p className="text-destructive font-semibold">Nöbet Talebi Çakışması</p>
              <p className="text-destructive/80 text-sm">
                Bu çizelgede onaylı nöbet talebiyle çakışan manuel veya mevcut
                atamalar bulunmaktadır.
              </p>
            </div>
          </div>
          <Table className="mt-3">
            <TableHeader>
              <TableRow>
                <TableHead>Tarih</TableHead>
                <TableHead>Eczane</TableHead>
                <TableHead>Talep Türü</TableHead>
                <TableHead>Talep Tarih Aralığı</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requestConflicts.map((conflict) => {
                const assignment = assignmentById.get(conflict.assignmentId);
                return (
                  <TableRow key={conflict.assignmentId}>
                    <TableCell>{conflict.date.toLocaleDateString("tr-TR")}</TableCell>
                    <TableCell className="font-medium">
                      {assignment?.pharmacy.name ?? "-"}
                    </TableCell>
                    <TableCell>{DUTY_REQUEST_TYPE_LABELS[conflict.requestType]}</TableCell>
                    <TableCell>
                      {conflict.requestStartDate.toLocaleDateString("tr-TR")}
                      {" – "}
                      {conflict.requestEndDate.toLocaleDateString("tr-TR")}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Toplam Gün" value={totalDays} icon={CalendarRange} accent="navy" />
        <StatCard
          label="Toplam Nöbet Ataması"
          value={schedule.assignments.length}
          icon={CalendarCheck}
          accent="green"
        />
        <StatCard
          label="Uyarılı Gün Sayısı"
          value={schedule.warnings.length}
          icon={AlertTriangle}
          accent="amber"
        />
        <StatCard label="Bölge" value={schedule.region.name} icon={MapPin} accent="sky" />
      </div>

      {(approvedCannotDutyCount > 0 || approvedEmergencyCount > 0 || pendingCount > 0) && (
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <p className="font-semibold">Dikkate Alınan Nöbet Talepleri</p>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Bu dönemle çakışan onaylı nöbet talepleri çizelge oluşturulurken dikkate
            alındı.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {approvedCannotDutyCount > 0 && (
              <Badge variant="success">
                {approvedCannotDutyCount} onaylı nöbet tutamama
              </Badge>
            )}
            {approvedEmergencyCount > 0 && (
              <Badge variant="success">{approvedEmergencyCount} onaylı acil mazeret</Badge>
            )}
            {pendingCount > 0 && (
              <Badge variant="warning">{pendingCount} bekleyen talep</Badge>
            )}
          </div>
        </div>
      )}

      {schedule.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-5">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="size-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-semibold text-amber-900">Uyarılar</p>
              <p className="text-sm text-amber-800/80">
                Bu tarihlerde yeterli sayıda uygun eczane bulunamadı.
              </p>
            </div>
          </div>
          <ul className="mt-3 flex flex-col gap-1.5 pl-1 text-sm text-amber-900">
            {schedule.warnings.map((warning) => (
              <li key={warning.id} className="flex items-baseline gap-2">
                <span className="font-medium whitespace-nowrap">
                  {warning.date.toLocaleDateString("tr-TR")}
                </span>
                <span className="text-amber-800/90">{warning.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Günlük Atamalar</CardTitle>
          <CardDescription>
            Bölgenin günlük nöbetçi eczane sayısı: {schedule.region.dailyDutyCount}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarih</TableHead>
                <TableHead>Gün</TableHead>
                <TableHead>Nöbetçi Eczane</TableHead>
                <TableHead>Telefon</TableHead>
                <TableHead>Adres</TableHead>
                <TableHead>Ağırlık</TableHead>
                <TableHead>Not</TableHead>
                <TableHead className="text-right">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedule.assignments.map((assignment) => {
                const dayOfWeek = assignment.date.getUTCDay();
                const isWeekendDay = dayOfWeek === 0 || dayOfWeek === 6;
                return (
                <TableRow key={assignment.id}>
                  <TableCell>{assignment.date.toLocaleDateString("tr-TR")}</TableCell>
                  <TableCell
                    className={isWeekendDay ? "font-medium text-amber-700" : undefined}
                  >
                    {getTurkishDayName(assignment.date)}
                  </TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {assignment.pharmacy.name}
                      {assignment.isManual && <Badge variant="info">Manuel</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>{assignment.pharmacy.phone}</TableCell>
                  <TableCell className="max-w-xs truncate">
                    {assignment.pharmacy.address}
                  </TableCell>
                  <TableCell>{assignment.weight}</TableCell>
                  <TableCell className="max-w-[200px]">
                    {assignment.note ? (
                      <span
                        title={assignment.note}
                        className="text-muted-foreground block truncate text-sm italic"
                      >
                        {formatAssignmentNote(assignment.note, assignment.isManual)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {canEditAssignment ? (
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/cizelgeler/${schedule.id}/atama/${assignment.id}/duzenle`}>
                          Düzenle
                        </Link>
                      </Button>
                    ) : (
                      <span className="text-muted-foreground text-sm">-</span>
                    )}
                  </TableCell>
                </TableRow>
                );
              })}
              {schedule.assignments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground text-center">
                    Bu çizelge için atama bulunmuyor.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card id="nobet-dengesi">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="text-primary size-4.5" />
            Nöbet Dengesi
          </CardTitle>
          <CardDescription>
            Eczane bazlı nöbet yükü analizi: geçmiş nöbet yükü, manuel denge
            düzeltmeleri ve yeni sistem nöbetleri birlikte değerlendirilir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Eczane</TableHead>
                <TableHead>Bu Dönem Nöbet Sayısı</TableHead>
                <TableHead>Bu Dönem Yük Puanı</TableHead>
                <TableHead>Geçmiş Nöbet Puanı</TableHead>
                <TableHead>Manuel Denge Düzeltmesi</TableHead>
                <TableHead>Yeni Sistem Nöbet Puanı</TableHead>
                <TableHead>Toplam Denge Skoru</TableHead>
                <TableHead>Denge Durumu</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balanceRows.map((row) => {
                const status = classifyBalance(row.totalBalance, meanBalance);
                return (
                  <TableRow key={row.pharmacyId}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.totalDuties}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <span className="w-8 font-medium tabular-nums">
                          {formatPoints(row.totalLoadScore)}
                        </span>
                        <div className="bg-muted h-1.5 w-20 overflow-hidden rounded-full">
                          <div
                            className="bg-primary h-full rounded-full"
                            style={{
                              width: `${maxLoadScore > 0 ? (row.totalLoadScore / maxLoadScore) * 100 : 0}%`,
                            }}
                          />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{formatPoints(row.historicalPoints)}</TableCell>
                    <TableCell>{formatPoints(row.adjustmentPoints)}</TableCell>
                    <TableCell>{formatPoints(row.generatedPoints)}</TableCell>
                    <TableCell className="font-medium">
                      {formatPoints(row.totalBalance)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          status === "HIGH"
                            ? "warning"
                            : status === "LOW"
                              ? "info"
                              : "success"
                        }
                      >
                        {BALANCE_STATUS_LABELS[status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {balanceRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground text-center">
                    Bu çizelge için veri bulunmuyor.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
