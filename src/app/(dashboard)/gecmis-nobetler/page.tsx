import { Archive, Download, FileWarning, Scale, TrendingDown, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/layout/stat-card";
import { EmptyState } from "@/components/layout/empty-state";
import { ListBanner } from "@/components/layout/list-banner";
import { DeleteButton } from "@/components/layout/delete-button";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/permissions";
import { getDutyBalanceRows } from "@/lib/balance/duty-balance";
import { formatPoints } from "@/lib/balance/balance-status";
import { HistoricalImportForm } from "./import-form";
import { BalanceAdjustmentForm } from "./adjustment-form";
import { deleteBalanceAdjustmentAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function GecmisNobetlerPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;

  const user = await getCurrentUser();
  const canManage = !!user && hasPermission(user.role, "manageSetupData");
  const isAdmin = !!user && hasPermission(user.role, "manageUsers");

  const [recordStats, matchedPoints, batches, adjustments, balanceRows, pharmacies] =
    await Promise.all([
      prisma.historicalDutyRecord.groupBy({
        by: ["matchStatus"],
        _count: { _all: true },
      }),
      prisma.historicalDutyRecord.aggregate({
        where: { matchStatus: "MATCHED" },
        _sum: { weight: true },
      }),
      prisma.historicalDutyImportBatch.findMany({
        select: {
          id: true,
          fileName: true,
          createdAt: true,
          rowCount: true,
          matchedCount: true,
          unmatchedCount: true,
          warningCount: true,
          importedBy: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.dutyBalanceAdjustment.findMany({
        select: {
          id: true,
          points: true,
          reason: true,
          createdAt: true,
          pharmacy: { select: { name: true } },
          createdBy: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      getDutyBalanceRows(),
      prisma.pharmacy.findMany({
        where: { isActive: true },
        select: { id: true, name: true, region: { select: { name: true } } },
        orderBy: { name: "asc" },
      }),
    ]);

  const matchedCount =
    recordStats.find((s) => s.matchStatus === "MATCHED")?._count._all ?? 0;
  const unmatchedCount =
    recordStats.find((s) => s.matchStatus === "UNMATCHED")?._count._all ?? 0;
  const totalRecords = recordStats.reduce((sum, s) => sum + s._count._all, 0);
  const totalHistoricalPoints = matchedPoints._sum.weight ?? 0;

  const rowsWithHistory = balanceRows.filter(
    (row) => row.historicalCount > 0 || row.adjustmentPoints !== 0
  );
  const historicalLoads = balanceRows
    .filter((row) => row.historicalCount > 0)
    .map((row) => row.historicalPoints);
  const maxLoad = historicalLoads.length > 0 ? Math.max(...historicalLoads) : 0;
  const minLoad = historicalLoads.length > 0 ? Math.min(...historicalLoads) : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Geçmiş Nöbetler"
        description="Eski nöbet listelerinizi sisteme aktarın; sistem her eczanenin geçmiş nöbet yükünü hesaplar ve yeni çizelgeleri bu başlangıç nöbet dengesini dikkate alarak oluşturur."
        icon={Archive}
        actions={
          canManage ? (
            <Button variant="outline" asChild>
              <a href="/gecmis-nobetler/sablon">
                <Download className="size-4" />
                Örnek Geçmiş Nöbet Şablonu İndir
              </a>
            </Button>
          ) : undefined
        }
      />

      <ListBanner success={success} error={error} />

      <div className="rounded-xl border border-sky-300/60 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        Geçmiş nöbet listeleri, yeni çizelge oluşturulurken başlangıç nöbet dengesi
        olarak dikkate alınır. Bu kayıtlar yeni çizelge yerine geçmez; yalnızca
        eczanelerin geçmiş nöbet yükünü hesaplamak için kullanılır.
      </div>

      {/* Özet kartları */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Toplam Aktarılan Nöbet"
          value={totalRecords}
          hint={`${matchedCount} eşleşen kayıt`}
          icon={Archive}
          accent="green"
        />
        <StatCard
          label="Eşleşmeyen Kayıt"
          value={unmatchedCount}
          hint={unmatchedCount > 0 ? "Denge skoruna katılmaz" : undefined}
          icon={FileWarning}
          accent={unmatchedCount > 0 ? "amber" : "navy"}
        />
        <StatCard
          label="Toplam Geçmiş Nöbet Puanı"
          value={formatPoints(totalHistoricalPoints)}
          icon={Scale}
          accent="sky"
        />
        <StatCard
          label="En Yüksek Geçmiş Yük"
          value={formatPoints(maxLoad)}
          icon={TrendingUp}
          accent="amber"
        />
        <StatCard
          label="En Düşük Geçmiş Yük"
          value={formatPoints(minLoad)}
          icon={TrendingDown}
          accent="green"
        />
      </div>

      {/* İçe aktarma */}
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Geçmiş Nöbet Listesi Aktar</CardTitle>
            <CardDescription>
              Excel dosyanızı yükleyin; sistem satırları analiz edip önizleme gösterir.
              Kritik hata yoksa içe aktarımı onaylayabilirsiniz. İçe aktarmadan önce
              ön izleme ekranındaki eşleşmeleri kontrol ediniz.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HistoricalImportForm />
          </CardContent>
        </Card>
      )}

      {/* Son aktarımlar */}
      {batches.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Son Aktarımlar</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dosya</TableHead>
                  <TableHead>Tarih</TableHead>
                  <TableHead>Aktaran</TableHead>
                  <TableHead>Satır</TableHead>
                  <TableHead>Eşleşen</TableHead>
                  <TableHead>Eşleşmeyen</TableHead>
                  <TableHead>Uyarılı</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((batch) => (
                  <TableRow key={batch.id}>
                    <TableCell className="font-medium">{batch.fileName}</TableCell>
                    <TableCell>{batch.createdAt.toLocaleString("tr-TR")}</TableCell>
                    <TableCell>{batch.importedBy?.name ?? "-"}</TableCell>
                    <TableCell>{batch.rowCount}</TableCell>
                    <TableCell>
                      <Badge variant="success">{batch.matchedCount}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={batch.unmatchedCount > 0 ? "warning" : "secondary"}>
                        {batch.unmatchedCount}
                      </Badge>
                    </TableCell>
                    <TableCell>{batch.warningCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Geçmiş nöbet yükü özeti */}
      <Card>
        <CardHeader>
          <CardTitle>Başlangıç Nöbet Dengesi</CardTitle>
          <CardDescription>
            Eczane bazlı geçmiş nöbet yükü ve manuel denge düzeltmeleri. Toplam
            Başlangıç Yükü, yeni çizelgelerde denge skorunun başlangıç değeridir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rowsWithHistory.length === 0 ? (
            <EmptyState
              icon={Archive}
              title="Henüz geçmiş nöbet kaydı bulunmuyor."
              description="Excel dosyanızı yukarıdan yükleyerek geçmiş nöbet listelerinizi aktarın; başlangıç nöbet dengesi burada görünecek."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Eczane</TableHead>
                  <TableHead>Bölge</TableHead>
                  <TableHead>Geçmiş Nöbet Sayısı</TableHead>
                  <TableHead>Geçmiş Nöbet Puanı</TableHead>
                  <TableHead>Hafta Sonu Nöbeti</TableHead>
                  <TableHead>Tatil/Bayram Nöbeti</TableHead>
                  <TableHead>Manuel Denge Düzeltmesi</TableHead>
                  <TableHead>Toplam Başlangıç Yükü</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rowsWithHistory.map((row) => (
                  <TableRow key={row.pharmacyId}>
                    <TableCell className="font-medium">{row.pharmacyName}</TableCell>
                    <TableCell>{row.regionName}</TableCell>
                    <TableCell>{row.historicalCount}</TableCell>
                    <TableCell>{formatPoints(row.historicalPoints)}</TableCell>
                    <TableCell>{row.historicalWeekendCount}</TableCell>
                    <TableCell>{row.historicalHolidayCount}</TableCell>
                    <TableCell>{formatPoints(row.adjustmentPoints)}</TableCell>
                    <TableCell className="font-medium">
                      {formatPoints(row.historicalPoints + row.adjustmentPoints)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Manuel denge düzeltmesi */}
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Manuel Denge Düzeltmesi</CardTitle>
            <CardDescription>
              Sisteme aktarılamayan dönemler için eczanelere başlangıç yükü ekleyin
              veya çıkarın. Her düzeltme gerekçesiyle birlikte denetim kaydına yazılır.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BalanceAdjustmentForm
              pharmacies={pharmacies.map((p) => ({
                id: p.id,
                name: p.name,
                regionName: p.region.name,
              }))}
            />
          </CardContent>
        </Card>
      )}

      {/* Düzeltme listesi */}
      {adjustments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Son Denge Düzeltmeleri</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Eczane</TableHead>
                  <TableHead>Puan</TableHead>
                  <TableHead>Gerekçe</TableHead>
                  <TableHead>Ekleyen</TableHead>
                  <TableHead>Tarih</TableHead>
                  {isAdmin && <TableHead className="text-right">İşlem</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {adjustments.map((adjustment) => (
                  <TableRow key={adjustment.id}>
                    <TableCell className="font-medium">
                      {adjustment.pharmacy.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant={adjustment.points > 0 ? "warning" : "info"}>
                        {adjustment.points > 0 ? "+" : ""}
                        {formatPoints(adjustment.points)}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate" title={adjustment.reason}>
                      {adjustment.reason}
                    </TableCell>
                    <TableCell>{adjustment.createdBy?.name ?? "-"}</TableCell>
                    <TableCell>{adjustment.createdAt.toLocaleDateString("tr-TR")}</TableCell>
                    {isAdmin && (
                      <TableCell>
                        <div className="flex justify-end">
                          <DeleteButton
                            action={deleteBalanceAdjustmentAction.bind(null, adjustment.id)}
                            confirmMessage={`${adjustment.pharmacy.name} için ${formatPoints(adjustment.points)} puanlık denge düzeltmesini silmek istediğinize emin misiniz? Bu işlem denetim kaydına yazılır.`}
                          />
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
