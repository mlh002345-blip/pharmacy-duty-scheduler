import Link from "next/link";
import { Scale } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
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
import { prisma } from "@/lib/prisma";
import { requireOrganizationMember } from "@/lib/auth/tenant";
import { getDutyBalanceRows } from "@/lib/balance/duty-balance";
import {
  BALANCE_STATUS_LABELS,
  classifyBalance,
  formatPoints,
  meanOf,
} from "@/lib/balance/balance-status";

export const dynamic = "force-dynamic";

const STATUS_BADGE_VARIANT = {
  LOW: "info",
  BALANCED: "success",
  HIGH: "warning",
} as const;

export default async function NobetDengesiPage({
  searchParams,
}: {
  searchParams: Promise<{ regionId?: string }>;
}) {
  const { regionId } = await searchParams;

  const user = await requireOrganizationMember();

  const regions = await prisma.region.findMany({
    where: { organizationId: user.organizationId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const selectedRegionId =
    regionId && regions.some((r) => r.id === regionId) ? regionId : undefined;

  const rows = await getDutyBalanceRows({
    organizationId: user.organizationId,
    regionId: selectedRegionId,
  });
  const activeRows = rows.filter((row) => row.isActive);
  const mean = meanOf(activeRows.map((row) => row.totalBalance));
  const maxBalance = rows.reduce((max, row) => Math.max(max, row.totalBalance), 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Nöbet Yükü Analizi"
        description="Eczaneler arasındaki nöbet dağılımını, geçmiş nöbet yükünü, yeni dönem nöbetlerini ve manuel değişikliklerin dengeye etkisini izleyin."
        icon={Scale}
      />

      <Card>
        <CardHeader>
          <CardTitle>Nöbet Dengesi</CardTitle>
          <CardDescription>
            Toplam Denge Skoru = Geçmiş Nöbet Puanı + Manuel Denge Düzeltmesi + Yeni
            Sistem Nöbet Puanı. Düşük skor, yeni çizelgelerde önceliğin o eczaneye
            verileceği anlamına gelir.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="regionId" className="text-sm font-medium">
                Bölge
              </label>
              <Select
                id="regionId"
                name="regionId"
                defaultValue={selectedRegionId ?? ""}
                className="w-56"
              >
                <option value="">Tüm Bölgeler</option>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="secondary">
              Filtrele
            </Button>
          </form>

          {rows.length === 0 ? (
            <EmptyState
              icon={Scale}
              title="Analiz için eczane verisi bulunmuyor."
              description="Önce eczane kayıtlarını ekleyin; geçmiş nöbetleri aktardıkça ve çizelge oluşturdukça denge skorları burada görünecek."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Eczane</TableHead>
                  <TableHead>Bölge</TableHead>
                  <TableHead>Geçmiş Nöbet Puanı</TableHead>
                  <TableHead>Manuel Denge Düzeltmesi</TableHead>
                  <TableHead>Yeni Sistem Nöbet Puanı</TableHead>
                  <TableHead>Toplam Denge Skoru</TableHead>
                  <TableHead>Denge Durumu</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const status = classifyBalance(row.totalBalance, mean);
                  return (
                    <TableRow key={row.pharmacyId}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {row.pharmacyName}
                          {!row.isActive && <Badge variant="secondary">Pasif</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>{row.regionName}</TableCell>
                      <TableCell>{formatPoints(row.historicalPoints)}</TableCell>
                      <TableCell>{formatPoints(row.adjustmentPoints)}</TableCell>
                      <TableCell>{formatPoints(row.generatedPoints)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <span className="w-10 font-medium tabular-nums">
                            {formatPoints(row.totalBalance)}
                          </span>
                          <div className="bg-muted h-1.5 w-20 overflow-hidden rounded-full">
                            <div
                              className="bg-primary h-full rounded-full"
                              style={{
                                width: `${maxBalance > 0 ? (row.totalBalance / maxBalance) * 100 : 0}%`,
                              }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {row.isActive ? (
                          <Badge variant={STATUS_BADGE_VARIANT[status]}>
                            {BALANCE_STATUS_LABELS[status]}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Çizelge Bazlı Analiz</CardTitle>
          <CardDescription>
            Her nöbet çizelgesinin dönem bazlı nöbet yükü analizi, ilgili çizelgenin
            detay sayfasındaki &quot;Nöbet Dengesi&quot; bölümünde görüntülenebilir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild>
            <Link href="/cizelgeler">Nöbet Çizelgelerine Git</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
