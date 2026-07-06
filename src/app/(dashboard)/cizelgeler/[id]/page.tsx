import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { getCurrentUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {schedule.region.name} {getTurkishMonthName(schedule.month)} {schedule.year} Nöbet
            Çizelgesi
          </h1>
          <p className="text-muted-foreground text-sm">
            {getTurkishMonthName(schedule.month)} {schedule.year} dönemi nöbet ataması.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButton
            href={`/cizelgeler/${schedule.id}/export/excel`}
            label="Excel'e Aktar"
          />
          <ExportButton href={`/cizelgeler/${schedule.id}/export/pdf`} label="PDF İndir" />
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

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Card>
          <CardHeader>
            <CardDescription>Toplam Gün</CardDescription>
            <CardTitle className="text-2xl">{totalDays}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Toplam Nöbet Ataması</CardDescription>
            <CardTitle className="text-2xl">{schedule.assignments.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Uyarılı Gün Sayısı</CardDescription>
            <CardTitle className="text-2xl">{schedule.warnings.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Bölge</CardDescription>
            <CardTitle className="text-2xl">{schedule.region.name}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Durum</CardDescription>
            <CardTitle className="text-2xl">
              <Badge variant={schedule.status === "DRAFT" ? "secondary" : "default"}>
                {DUTY_SCHEDULE_STATUS_LABELS[schedule.status] ?? schedule.status}
              </Badge>
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {schedule.warnings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Uyarılar</CardTitle>
            <CardDescription>
              Bu tarihlerde yeterli sayıda uygun eczane bulunamadı.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {schedule.warnings.map((warning) => (
                <li key={warning.id} className="text-destructive">
                  {warning.date.toLocaleDateString("tr-TR")} — {warning.message}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
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
              {schedule.assignments.map((assignment) => (
                <TableRow key={assignment.id}>
                  <TableCell>{assignment.date.toLocaleDateString("tr-TR")}</TableCell>
                  <TableCell>{getTurkishDayName(assignment.date)}</TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {assignment.pharmacy.name}
                      {assignment.isManual && <Badge variant="outline">Manuel</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>{assignment.pharmacy.phone}</TableCell>
                  <TableCell className="max-w-xs truncate">
                    {assignment.pharmacy.address}
                  </TableCell>
                  <TableCell>{assignment.weight}</TableCell>
                  <TableCell>{assignment.note ?? "-"}</TableCell>
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
              ))}
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

      <Card id="adalet-raporu">
        <CardHeader>
          <CardTitle>Adalet Raporu</CardTitle>
          <CardDescription>Bu çizelgedeki atamalara göre eczane bazlı özet.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Eczane</TableHead>
                <TableHead>Toplam Nöbet</TableHead>
                <TableHead>Hafta Sonu Nöbeti</TableHead>
                <TableHead>Tatil/Bayram Nöbeti</TableHead>
                <TableHead>Toplam Yük Puanı</TableHead>
                <TableHead>Son Nöbet Tarihi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fairnessRows.map((row) => (
                <TableRow key={row.pharmacyId}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>{row.totalDuties}</TableCell>
                  <TableCell>{row.weekendDuties}</TableCell>
                  <TableCell>{row.holidayDuties}</TableCell>
                  <TableCell>{row.totalLoadScore}</TableCell>
                  <TableCell>{row.lastDutyDate.toLocaleDateString("tr-TR")}</TableCell>
                </TableRow>
              ))}
              {fairnessRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground text-center">
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
