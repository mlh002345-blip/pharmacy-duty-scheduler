import Link from "next/link";
import { Building2 } from "lucide-react";
import type { Prisma } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
import { PageHeader } from "@/components/layout/page-header";
import { DeleteButton } from "@/components/layout/delete-button";
import { StatusToggleButton } from "@/components/layout/status-toggle-button";
import { Pagination, DEFAULT_PAGE_SIZE, parsePageParam } from "@/components/layout/pagination";
import { prisma } from "@/lib/prisma";
import { requireOrganizationMember } from "@/lib/auth/tenant";
import { hasPermission } from "@/lib/auth/permissions";
import { deletePharmacyAction, setPharmacyStatusAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function EczanelerPage({
  searchParams,
}: {
  searchParams: Promise<{
    success?: string;
    error?: string;
    q?: string;
    regionId?: string;
    status?: string;
    page?: string;
  }>;
}) {
  const { success, error, q, regionId, status, page: pageParam } = await searchParams;

  const user = await requireOrganizationMember();
  const canManage = hasPermission(user.role, "manageSetupData");
  const canDelete = hasPermission(user.role, "deleteSetupData");

  const where: Prisma.PharmacyWhereInput = {
    region: { organizationId: user.organizationId },
  };
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { pharmacistName: { contains: q } },
    ];
  }
  if (regionId) {
    where.regionId = regionId;
  }
  if (status === "active") {
    where.isActive = true;
  } else if (status === "passive") {
    where.isActive = false;
  }

  const page = parsePageParam(pageParam);

  const [pharmacies, totalCount, regions] = await Promise.all([
    prisma.pharmacy.findMany({
      where,
      select: {
        id: true,
        name: true,
        pharmacistName: true,
        phone: true,
        isActive: true,
        region: { select: { name: true } },
      },
      orderBy: { name: "asc" },
      skip: (page - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE,
    }),
    prisma.pharmacy.count({ where }),
    prisma.region.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Eczaneler"
        description={`Sisteme kayıtlı eczaneler (${totalCount} kayıt).`}
        icon={Building2}
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/eczaneler/yeni">Yeni Ekle</Link>
            </Button>
          ) : undefined
        }
      />

      <ListBanner success={success} error={error} />

      <Card>
        <CardHeader>
          <CardTitle>Filtrele</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="q">
                Eczane veya Eczacı Adı
              </label>
              <Input id="q" name="q" defaultValue={q} placeholder="Ara..." />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="regionId">
                Bölge
              </label>
              <Select id="regionId" name="regionId" defaultValue={regionId ?? ""} className="w-48">
                <option value="">Tümü</option>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="status">
                Durum
              </label>
              <Select id="status" name="status" defaultValue={status ?? ""} className="w-36">
                <option value="">Tümü</option>
                <option value="active">Aktif</option>
                <option value="passive">Pasif</option>
              </Select>
            </div>

            <Button type="submit" variant="secondary">
              Filtrele
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link href="/eczaneler">Temizle</Link>
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Eczane Listesi</CardTitle>
          <CardDescription>Bölge ve durum bilgisiyle birlikte.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Eczane Adı</TableHead>
                <TableHead>Eczacı</TableHead>
                <TableHead>Bölge</TableHead>
                <TableHead>Telefon</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead className="text-right">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pharmacies.map((pharmacy) => (
                <TableRow key={pharmacy.id}>
                  <TableCell className="font-medium">{pharmacy.name}</TableCell>
                  <TableCell>{pharmacy.pharmacistName}</TableCell>
                  <TableCell>{pharmacy.region.name}</TableCell>
                  <TableCell>{pharmacy.phone}</TableCell>
                  <TableCell>
                    <Badge variant={pharmacy.isActive ? "success" : "secondary"}>
                      {pharmacy.isActive ? "Aktif" : "Pasif"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {canManage ? (
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/eczaneler/${pharmacy.id}/duzenle`}>Düzenle</Link>
                        </Button>
                        <StatusToggleButton
                          action={setPharmacyStatusAction.bind(null, pharmacy.id, !pharmacy.isActive)}
                          isActive={pharmacy.isActive}
                        />
                        {canDelete && (
                          <DeleteButton
                            action={deletePharmacyAction.bind(null, pharmacy.id)}
                            confirmMessage={`"${pharmacy.name}" eczanesini silmek istediğinize emin misiniz?`}
                          />
                        )}
                      </div>
                    ) : (
                      <div className="text-muted-foreground text-right text-sm">-</div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {pharmacies.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground py-8 text-center">
                    {totalCount === 0
                      ? "Henüz eczane kaydı bulunmuyor."
                      : "Filtreye uygun eczane bulunamadı."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <Pagination
            basePath="/eczaneler"
            searchParams={{ q, regionId, status }}
            page={page}
            pageSize={DEFAULT_PAGE_SIZE}
            totalCount={totalCount}
          />
        </CardContent>
      </Card>
    </div>
  );
}
