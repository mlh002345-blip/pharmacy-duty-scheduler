import Link from "next/link";
import { Inbox } from "lucide-react";
import type { Prisma, DutyRequestStatus, DutyRequestType } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { ListBanner } from "@/components/layout/list-banner";
import { Pagination, DEFAULT_PAGE_SIZE, parsePageParam } from "@/components/layout/pagination";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import {
  DUTY_REQUEST_STATUS_BADGE,
  DUTY_REQUEST_STATUS_LABELS,
  DUTY_REQUEST_TYPE_LABELS,
} from "@/lib/duty-requests/labels";
import { DutyRequestForm } from "./request-form";

export const dynamic = "force-dynamic";

const STATUS_VALUES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "LATE"] as const;
const TYPE_VALUES = [
  "CANNOT_DUTY",
  "PREFER_DUTY",
  "SWAP_REQUEST",
  "EMERGENCY_EXCUSE",
] as const;

export default async function NobetTalepleriPage({
  searchParams,
}: {
  searchParams: Promise<{
    success?: string;
    error?: string;
    status?: string;
    requestType?: string;
    regionId?: string;
    q?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const {
    success,
    error,
    status,
    requestType,
    regionId,
    q,
    from,
    to,
    page: pageParam,
  } = await searchParams;

  const user = await getCurrentUser();
  const canManage = !!user && hasPermission(user.role, "manageSetupData");
  const isAdmin = !!user && hasPermission(user.role, "manageUsers");

  const where: Prisma.DutyRequestWhereInput = {};
  if (status && (STATUS_VALUES as readonly string[]).includes(status)) {
    where.status = status as DutyRequestStatus;
  }
  if (requestType && (TYPE_VALUES as readonly string[]).includes(requestType)) {
    where.requestType = requestType as DutyRequestType;
  }
  if (regionId) where.regionId = regionId;
  if (q) where.pharmacy = { name: { contains: q, mode: "insensitive" } };
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  if (fromDate && !Number.isNaN(fromDate.getTime())) {
    where.endDate = { gte: fromDate };
  }
  if (toDate && !Number.isNaN(toDate.getTime())) {
    where.startDate = { lte: toDate };
  }

  const page = parsePageParam(pageParam);

  const [requests, totalCount, pendingCount, regions, pharmacies] = await Promise.all([
    prisma.dutyRequest.findMany({
      where,
      select: {
        id: true,
        requestType: true,
        startDate: true,
        endDate: true,
        explanation: true,
        status: true,
        pharmacy: { select: { name: true } },
        region: { select: { name: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE,
    }),
    prisma.dutyRequest.count({ where }),
    prisma.dutyRequest.count({ where: { status: "PENDING" } }),
    prisma.region.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    canManage
      ? prisma.pharmacy.findMany({
          where: { isActive: true },
          select: { id: true, name: true, region: { select: { name: true } } },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Nöbet Talep Yönetimi"
        description="Eczanelerden gelen nöbet tutamama, tercih ve değişiklik taleplerini inceleyin; onaylanan talepleri çizelge oluşturma sürecine dahil edin."
        icon={Inbox}
      />

      <ListBanner success={success} error={error} />

      {pendingCount > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-medium">{pendingCount} bekleyen talep var.</span>
          Çizelge oluşturmadan önce incelemeniz önerilir; yalnızca onaylı talepler
          çizelgeyi etkiler.
        </div>
      )}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Yeni Talep Girişi</CardTitle>
            <CardDescription>
              Telefonla veya yazılı olarak iletilen eczane taleplerini buradan kaydedin.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DutyRequestForm
              pharmacies={pharmacies.map((p) => ({
                id: p.id,
                name: p.name,
                regionName: p.region.name,
              }))}
              canApproveDirectly={isAdmin || canManage}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Talep Listesi</CardTitle>
          <CardDescription>{totalCount} kayıt.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="status">
                Durum
              </label>
              <Select id="status" name="status" defaultValue={status ?? ""} className="w-40">
                <option value="">Tümü</option>
                {STATUS_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {DUTY_REQUEST_STATUS_LABELS[value]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="requestType">
                Talep Türü
              </label>
              <Select
                id="requestType"
                name="requestType"
                defaultValue={requestType ?? ""}
                className="w-44"
              >
                <option value="">Tümü</option>
                {TYPE_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {DUTY_REQUEST_TYPE_LABELS[value]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="regionId">
                Bölge
              </label>
              <Select id="regionId" name="regionId" defaultValue={regionId ?? ""} className="w-40">
                <option value="">Tümü</option>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="q">
                Eczane
              </label>
              <Input id="q" name="q" defaultValue={q} placeholder="Ara..." className="w-44" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="from">
                Tarih (başlangıç)
              </label>
              <Input id="from" name="from" type="date" defaultValue={from} className="w-40" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="to">
                Tarih (bitiş)
              </label>
              <Input id="to" name="to" type="date" defaultValue={to} className="w-40" />
            </div>
            <Button type="submit" variant="secondary">
              Filtrele
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link href="/nobet-talepleri">Temizle</Link>
            </Button>
          </form>

          {requests.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Filtreye uygun nöbet talebi bulunmuyor."
              description="Eczanelerden gelen talepler burada listelenir. Yeni talep girmek için yukarıdaki formu kullanabilirsiniz."
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Eczane</TableHead>
                    <TableHead>Bölge</TableHead>
                    <TableHead>Talep Türü</TableHead>
                    <TableHead>Tarih Aralığı</TableHead>
                    <TableHead>Açıklama</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead className="text-right">İşlem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell className="font-medium">{request.pharmacy.name}</TableCell>
                      <TableCell>{request.region?.name ?? "-"}</TableCell>
                      <TableCell>{DUTY_REQUEST_TYPE_LABELS[request.requestType]}</TableCell>
                      <TableCell>
                        {request.startDate.toLocaleDateString("tr-TR")}
                        {" – "}
                        {request.endDate.toLocaleDateString("tr-TR")}
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        <span
                          className="text-muted-foreground block truncate text-sm"
                          title={request.explanation}
                        >
                          {request.explanation}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={DUTY_REQUEST_STATUS_BADGE[request.status]}>
                          {DUTY_REQUEST_STATUS_LABELS[request.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <Button variant="outline" size="sm" asChild>
                            <Link href={`/nobet-talepleri/${request.id}`}>
                              {canManage &&
                              (request.status === "PENDING" || request.status === "LATE")
                                ? "İncele"
                                : "Detay"}
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                basePath="/nobet-talepleri"
                searchParams={{ status, requestType, regionId, q, from, to }}
                page={page}
                pageSize={DEFAULT_PAGE_SIZE}
                totalCount={totalCount}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
