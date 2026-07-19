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
import { requireOrganizationMember } from "@/lib/auth/tenant";
import { hasPermission } from "@/lib/auth/permissions";
import { deleteDutyScheduleAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CizelgelerPage({
  searchParams,
}: {
  searchParams: Promise<{
    success?: string;
    error?: string;
    page?: string;
    regionId?: string;
    month?: string;
    year?: string;
    status?: string;
    source?: string;
  }>;
}) {
  const {
    success,
    error,
    page: pageParam,
    regionId: regionIdParam,
    month: monthParam,
    year: yearParam,
    status: statusParam,
    source: sourceParam,
  } = await searchParams;
  const page = parsePageParam(pageParam);

  const user = await requireOrganizationMember();
  const canGenerate = hasPermission(user.role, "generateSchedule");
  const canDelete = hasPermission(user.role, "deleteSchedule");

  const filterMonth = monthParam ? Number(monthParam) : undefined;
  const filterYear = yearParam ? Number(yearParam) : undefined;

  const where = {
    region: { organizationId: user.organizationId },
    ...(regionIdParam ? { regionId: regionIdParam } : {}),
    ...(Number.isInteger(filterMonth) && filterMonth ? { month: filterMonth } : {}),
    ...(Number.isInteger(filterYear) && filterYear ? { year: filterYear } : {}),
    ...(statusParam === "DRAFT" || statusParam === "APPROVED" || statusParam === "PUBLISHED"
      ? { status: statusParam as "DRAFT" | "APPROVED" | "PUBLISHED" }
      : {}),
    ...(sourceParam === "v2"
      ? { generationRun: { isNot: null } }
      : sourceParam === "v1"
        ? { generationRun: null }
        : {}),
  };
  const activeSearchParams: Record<string, string | undefined> = {
    regionId: regionIdParam,
    month: monthParam,
    year: yearParam,
    status: statusParam,
    source: sourceParam,
  };
  const [schedules, totalCount, regions] = await Promise.all([
    prisma.dutySchedule.findMany({
      where,
      select: {
        id: true,
        month: true,
        year: true,
        status: true,
        createdAt: true,
        region: { select: { name: true } },
        generationRun: { select: { id: true } },
        _count: { select: { assignments: true } },
      },
      orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE,
    }),
    prisma.dutySchedule.count({ where }),
    prisma.region.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
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
          <div className="flex flex-col items-end gap-1">
            <div className="flex gap-2">
              <Button asChild>
                <Link href="/cizelgeler/yeni">Yeni Ekle</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/cizelgeler/v2/yeni">V2 Taslak Oluştur</Link>
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">V2 yeni kural motoru (deneysel)</p>
          </div>
        )}
      </div>

      <ListBanner success={success} error={error} />

      <form method="GET" className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="regionId" className="text-muted-foreground text-xs">
            Bölge
          </label>
          <select
            id="regionId"
            name="regionId"
            defaultValue={regionIdParam ?? ""}
            className="border-input h-9 rounded-md border bg-transparent px-2 text-sm"
          >
            <option value="">Tümü</option>
            {regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="month" className="text-muted-foreground text-xs">
            Ay
          </label>
          <input
            id="month"
            name="month"
            type="number"
            min={1}
            max={12}
            defaultValue={monthParam ?? ""}
            className="border-input h-9 w-20 rounded-md border bg-transparent px-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="year" className="text-muted-foreground text-xs">
            Yıl
          </label>
          <input
            id="year"
            name="year"
            type="number"
            defaultValue={yearParam ?? ""}
            className="border-input h-9 w-24 rounded-md border bg-transparent px-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="status" className="text-muted-foreground text-xs">
            Durum
          </label>
          <select
            id="status"
            name="status"
            defaultValue={statusParam ?? ""}
            className="border-input h-9 rounded-md border bg-transparent px-2 text-sm"
          >
            <option value="">Tümü</option>
            <option value="DRAFT">Taslak</option>
            <option value="APPROVED">Onaylandı</option>
            <option value="PUBLISHED">Yayında</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="source" className="text-muted-foreground text-xs">
            Kaynak
          </label>
          <select
            id="source"
            name="source"
            defaultValue={sourceParam ?? ""}
            className="border-input h-9 rounded-md border bg-transparent px-2 text-sm"
          >
            <option value="">Tümü</option>
            <option value="v1">V1</option>
            <option value="v2">V2</option>
          </select>
        </div>
        <Button type="submit" size="sm" variant="outline">
          Filtrele
        </Button>
      </form>

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
                  <TableHead>Kaynak</TableHead>
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
                      {schedule.generationRun ? (
                        <Badge variant="secondary">V2</Badge>
                      ) : (
                        <Badge variant="outline">V1</Badge>
                      )}
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
                        {schedule.status !== "PUBLISHED" && canDelete && (
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
            searchParams={activeSearchParams}
            page={page}
            pageSize={DEFAULT_PAGE_SIZE}
            totalCount={totalCount}
          />
        </CardContent>
      </Card>
    </div>
  );
}
