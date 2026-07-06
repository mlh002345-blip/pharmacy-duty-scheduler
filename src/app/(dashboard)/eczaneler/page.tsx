import Link from "next/link";
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
import { DeleteButton } from "@/components/layout/delete-button";
import { StatusToggleButton } from "@/components/layout/status-toggle-button";
import { prisma } from "@/lib/prisma";
import { deletePharmacyAction, togglePharmacyStatusAction } from "./actions";

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
  }>;
}) {
  const { success, error, q, regionId, status } = await searchParams;

  const where: Prisma.PharmacyWhereInput = {};
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

  const [pharmacies, regions] = await Promise.all([
    prisma.pharmacy.findMany({
      where,
      include: { region: true },
      orderBy: { name: "asc" },
    }),
    prisma.region.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Eczaneler</h1>
          <p className="text-muted-foreground text-sm">
            Sisteme kayıtlı eczaneler ({pharmacies.length} kayıt).
          </p>
        </div>
        <Button asChild>
          <Link href="/eczaneler/yeni">Yeni Ekle</Link>
        </Button>
      </div>

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
                    <Badge variant={pharmacy.isActive ? "default" : "secondary"}>
                      {pharmacy.isActive ? "Aktif" : "Pasif"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/eczaneler/${pharmacy.id}/duzenle`}>Düzenle</Link>
                      </Button>
                      <StatusToggleButton
                        action={togglePharmacyStatusAction.bind(null, pharmacy.id)}
                        isActive={pharmacy.isActive}
                      />
                      <DeleteButton
                        action={deletePharmacyAction.bind(null, pharmacy.id)}
                        confirmMessage={`"${pharmacy.name}" eczanesini silmek istediğinize emin misiniz?`}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {pharmacies.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground text-center">
                    Filtreye uygun eczane bulunamadı.
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
