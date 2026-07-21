import Link from "next/link";
import { Building } from "lucide-react";
import type { BillingStatus, Prisma } from "@prisma/client";

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
import { Pagination, DEFAULT_PAGE_SIZE, parsePageParam } from "@/components/layout/pagination";
import { prisma } from "@/lib/prisma";
import { BILLING_STATUS_LABELS, BILLING_STATUS_BADGE, BILLING_STATUS_OPTIONS } from "@/lib/billing/labels";

export const dynamic = "force-dynamic";

export default async function PlatformKurumlarPage({
  searchParams,
}: {
  searchParams: Promise<{
    success?: string;
    error?: string;
    q?: string;
    status?: string;
    billing?: string;
    page?: string;
  }>;
}) {
  const { success, error, q, status, billing, page: pageParam } = await searchParams;

  const where: Prisma.OrganizationWhereInput = {};
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { province: { contains: q } },
      { slug: { contains: q } },
    ];
  }
  if (status === "active") {
    where.isActive = true;
  } else if (status === "passive") {
    where.isActive = false;
  }
  if (billing && (BILLING_STATUS_OPTIONS as string[]).includes(billing)) {
    where.billingStatus = billing as BillingStatus;
  }

  const page = parsePageParam(pageParam);

  const [organizations, totalCount] = await Promise.all([
    prisma.organization.findMany({
      where,
      select: {
        id: true,
        name: true,
        province: true,
        slug: true,
        isActive: true,
        billingStatus: true,
        createdAt: true,
        _count: { select: { users: true } },
      },
      orderBy: { name: "asc" },
      skip: (page - 1) * DEFAULT_PAGE_SIZE,
      take: DEFAULT_PAGE_SIZE,
    }),
    prisma.organization.count({ where }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Odalar"
        description={`Platformdaki eczacı odaları (${totalCount} kayıt).`}
        icon={Building}
        actions={
          <Button asChild>
            <Link href="/platform/kurumlar/yeni">Yeni Oda Oluştur</Link>
          </Button>
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
                Ad, İl veya Kısa Ad
              </label>
              <Input id="q" name="q" defaultValue={q} placeholder="Ara..." />
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

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="billing">
                Faturalama
              </label>
              <Select id="billing" name="billing" defaultValue={billing ?? ""} className="w-40">
                <option value="">Tümü</option>
                {BILLING_STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {BILLING_STATUS_LABELS[option]}
                  </option>
                ))}
              </Select>
            </div>

            <Button type="submit" variant="secondary">
              Filtrele
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link href="/platform/kurumlar">Temizle</Link>
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Oda Listesi</CardTitle>
          <CardDescription>Durum ve kullanıcı sayısıyla birlikte.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Oda Adı</TableHead>
                <TableHead>İl / Bölge</TableHead>
                <TableHead>Kısa Ad</TableHead>
                <TableHead>Kullanıcı Sayısı</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>Faturalama</TableHead>
                <TableHead className="text-right">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {organizations.map((organization) => (
                <TableRow key={organization.id}>
                  <TableCell className="font-medium">{organization.name}</TableCell>
                  <TableCell>{organization.province}</TableCell>
                  <TableCell className="text-muted-foreground">{organization.slug}</TableCell>
                  <TableCell>{organization._count.users}</TableCell>
                  <TableCell>
                    <Badge variant={organization.isActive ? "success" : "secondary"}>
                      {organization.isActive ? "Aktif" : "Pasif"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={BILLING_STATUS_BADGE[organization.billingStatus]}>
                      {BILLING_STATUS_LABELS[organization.billingStatus]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/platform/kurumlar/${organization.id}`}>Görüntüle</Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {organizations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground py-8 text-center">
                    {totalCount === 0
                      ? "Henüz tanımlı bir oda bulunmuyor."
                      : "Filtreye uygun oda bulunamadı."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <Pagination
            basePath="/platform/kurumlar"
            searchParams={{ q, status, billing }}
            page={page}
            pageSize={DEFAULT_PAGE_SIZE}
            totalCount={totalCount}
          />
        </CardContent>
      </Card>
    </div>
  );
}
