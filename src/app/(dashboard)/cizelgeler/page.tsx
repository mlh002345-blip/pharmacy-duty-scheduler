import Link from "next/link";
import { CalendarRange } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/layout/empty-state";
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
import { DeleteButton } from "@/components/layout/delete-button";
import { ExportButton } from "@/components/layout/export-button";
import { Pagination, DEFAULT_PAGE_SIZE, parsePageParam } from "@/components/layout/pagination";
import { prisma } from "@/lib/prisma";
import { getTurkishMonthName } from "@/lib/scheduling/date-tr";
import { DUTY_SCHEDULE_STATUS_LABELS } from "@/lib/scheduling/duty-schedule-labels";
import { getCurrentUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { deleteDutyScheduleAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CizelgelerPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string; page?: string }>;
}) {
  const { success, error, page: pageParam } = await searchParams;
  const page = parsePageParam(pageParam);

  const user = await getCurrentUser();
  const canGenerate = !!user && hasPermission(user.role, "generateSchedule");
  const canDelete = !!user && hasPermission(user.role, "deleteSchedule");

  const [schedules, totalCount] = await Promise.all([
    prisma.dutySchedule.findMany({
      select: {
        id: true,
        month: true,
        year: true,
        status: true,
        createdAt: true,
        region: { select: { name: true } },
        _count: { select: { assignments: true } },
      },
      orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE,
    }),
    prisma.dutySchedule.count(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Nöbet Çizelgeleri</h1>
          <p className="text-muted-foreground text-sm">
            Aylık nöbet çizelgeleri ve atamalar.
          </p>
        </div>
        {canGenerate && (
          <Button asChild>
            <Link href="/cizelgeler/yeni">Yeni Ekle</Link>
          </Button>
        )}
      </div>

      <ListBanner success={success} error={error} />

      <Card>
        <CardHeader>
          <CardTitle>Çizelge Listesi</CardTitle>
          <CardDescription>{totalCount} kayıt.</CardDescription>
        </CardHeader>
        <CardContent>
          {schedules.length === 0 ? (
            <EmptyState
              icon={CalendarRange}
              title="Henüz oluşturulmuş bir nöbet çizelgesi bulunmuyor."
              description="Nöbet çizelgesi oluşturmak için önce bölge ve eczane bilgilerini tamamlayın."
              action={
                canGenerate ? (
                  <Button asChild size="sm">
                    <Link href="/cizelgeler/yeni">Yeni Nöbet Çizelgesi Oluştur</Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Çizelge Adı</TableHead>
                  <TableHead>Bölge</TableHead>
                  <TableHead>Ay/Yıl</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>Oluşturulma Tarihi</TableHead>
                  <TableHead className="text-right">İşlemler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((schedule) => (
                  <TableRow key={schedule.id}>
                    <TableCell className="font-medium">
                      {schedule.region.name} {getTurkishMonthName(schedule.month)}{" "}
                      {schedule.year} Nöbet Çizelgesi
                    </TableCell>
                    <TableCell>{schedule.region.name}</TableCell>
                    <TableCell>
                      {getTurkishMonthName(schedule.month)} {schedule.year}
                    </TableCell>
                    <TableCell>
                      <Badge variant={schedule.status === "DRAFT" ? "warning" : "success"}>
                        {DUTY_SCHEDULE_STATUS_LABELS[schedule.status] ?? schedule.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {schedule.createdAt.toLocaleDateString("tr-TR")}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/cizelgeler/${schedule.id}`}>Görüntüle</Link>
                        </Button>
                        <ExportButton
                          href={`/cizelgeler/${schedule.id}/export/excel`}
                          label="Excel"
                          size="sm"
                        />
                        <ExportButton
                          href={`/cizelgeler/${schedule.id}/export/pdf`}
                          label="PDF"
                          size="sm"
                        />
                        {schedule.status === "DRAFT" && canDelete && (
                          <DeleteButton
                            action={deleteDutyScheduleAction.bind(null, schedule.id)}
                            confirmMessage={`${schedule.region.name} ${getTurkishMonthName(schedule.month)} ${schedule.year} çizelgesini silmek istediğinize emin misiniz?`}
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pagination
            basePath="/cizelgeler"
            searchParams={{}}
            page={page}
            pageSize={DEFAULT_PAGE_SIZE}
            totalCount={totalCount}
          />
        </CardContent>
      </Card>
    </div>
  );
}
