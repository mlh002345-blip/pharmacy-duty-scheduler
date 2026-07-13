import Link from "next/link";

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
import { DeleteButton } from "@/components/layout/delete-button";
import { StatusToggleButton } from "@/components/layout/status-toggle-button";
import { prisma } from "@/lib/prisma";
import { requireOrganizationMember } from "@/lib/auth/tenant";
import { hasPermission } from "@/lib/auth/permissions";
import { deleteRegionAction, setRegionStatusAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function BolgelerPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;

  const user = await requireOrganizationMember();
  const canManage = hasPermission(user.role, "manageRegions");
  const canDelete = hasPermission(user.role, "deleteSetupData");

  const regions = await prisma.region.findMany({
    where: { organizationId: user.organizationId },
    include: { _count: { select: { pharmacies: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Nöbet Bölgeleri</h1>
          <p className="text-muted-foreground text-sm">
            Eczanelerin gruplandığı nöbet bölgeleri.
          </p>
        </div>
        {canManage && (
          <Button asChild>
            <Link href="/bolgeler/yeni">Yeni Bölge Ekle</Link>
          </Button>
        )}
      </div>

      <ListBanner success={success} error={error} />

      <Card>
        <CardHeader>
          <CardTitle>Bölge Listesi</CardTitle>
          <CardDescription>{regions.length} kayıt.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bölge Adı</TableHead>
                <TableHead>İlçe</TableHead>
                <TableHead>Günlük Nöbetçi Sayısı</TableHead>
                <TableHead>Eczane Sayısı</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead className="text-right">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {regions.map((region) => (
                <TableRow key={region.id}>
                  <TableCell className="font-medium">{region.name}</TableCell>
                  <TableCell>{region.district}</TableCell>
                  <TableCell>{region.dailyDutyCount}</TableCell>
                  <TableCell>{region._count.pharmacies}</TableCell>
                  <TableCell>
                    <Badge variant={region.isActive ? "success" : "secondary"}>
                      {region.isActive ? "Aktif" : "Pasif"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {canManage ? (
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/bolgeler/${region.id}/duzenle`}>Düzenle</Link>
                        </Button>
                        <StatusToggleButton
                          action={setRegionStatusAction.bind(null, region.id, !region.isActive)}
                          isActive={region.isActive}
                        />
                        {canDelete && (
                          <DeleteButton
                            action={deleteRegionAction.bind(null, region.id)}
                            confirmMessage={`"${region.name}" bölgesini silmek istediğinize emin misiniz?`}
                          />
                        )}
                      </div>
                    ) : (
                      <div className="text-muted-foreground text-right text-sm">-</div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {regions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground text-center">
                    Henüz tanımlı bir bölge bulunmuyor.
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
