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
import { prisma } from "@/lib/prisma";
import { requireOrganizationRoleOrRedirect } from "@/lib/auth/tenant";
import {
  describePharmacyImportRowStatus,
  type PharmacyImportRowStatus,
  type PharmacyRowErrorCode,
} from "@/lib/pharmacy-import/analyze-import";
import { importPharmacyBatchAction } from "../../actions";

export const dynamic = "force-dynamic";

const PREVIEW_DISPLAY_LIMIT = 200;

// Factored out of the component body so the impure Date.now() read isn't
// inlined directly in render (the React compiler's purity check flags
// that pattern even in a server component, which re-runs per request
// regardless).
function isBatchExpired(batch: { status: string; expiresAt: Date }): boolean {
  return batch.status === "EXPIRED" || batch.expiresAt.getTime() < Date.now();
}

const STATUS_LABELS: Record<PharmacyImportRowStatus, string> = {
  READY: "Hazır",
  INVALID: "Geçersiz",
  DUPLICATE_IN_FILE: "Dosyada Yinelenen",
  ALREADY_EXISTS: "Zaten Kayıtlı",
  UNKNOWN_REGION: "Bölge Bulunamadı",
};

export default async function IceAktarOnizlemePage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const user = await requireOrganizationRoleOrRedirect(
    "importPharmacies",
    "/eczaneler",
    "Bu sayfaya erişim yetkiniz bulunmuyor."
  );
  const { batchId } = await params;
  const { success, error } = await searchParams;

  // Org-scoped ownership check on every field — a batch id belonging to
  // another organization must 404, never leak whether it exists.
  const batch = await prisma.pharmacyImportBatch.findFirst({
    where: { id: batchId, organizationId: user.organizationId },
    include: {
      rows: { orderBy: { rowNumber: "asc" }, take: PREVIEW_DISPLAY_LIMIT },
      _count: { select: { rows: true } },
    },
  });
  if (!batch) notFound();

  const isExpired = isBatchExpired(batch);
  const canImport =
    batch.status === "PREVIEWED" && !isExpired && batch.readyRows === batch.totalRows && batch.totalRows > 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">İçe Aktarma Önizlemesi</h1>
        <p className="text-muted-foreground text-sm">{batch.sanitizedFileName}</p>
      </div>

      <ListBanner success={success} error={error} />

      <div className="flex flex-wrap gap-2 text-sm">
        <Badge variant="secondary">{batch.totalRows} satır</Badge>
        <Badge variant="success">{batch.readyRows} hazır</Badge>
        <Badge variant={batch.invalidRows > 0 ? "destructive" : "secondary"}>
          {batch.invalidRows} aktarıma hazır değil
        </Badge>
        {batch.status === "IMPORTED" && <Badge variant="info">Aktarıldı</Badge>}
        {isExpired && <Badge variant="secondary">Süresi Doldu</Badge>}
      </div>

      {!canImport && batch.status === "PREVIEWED" && !isExpired && (
        <p className="text-destructive text-sm">
          Bu dosyadaki tüm satırlar aktarıma hazır olmadan içe aktarım yapılamaz. Lütfen
          hataları düzeltip dosyayı yeniden yükleyin.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Satır Önizlemesi</CardTitle>
          <CardDescription>
            {batch._count.rows > PREVIEW_DISPLAY_LIMIT
              ? `İlk ${PREVIEW_DISPLAY_LIMIT} satır gösteriliyor; aktarım tüm satırları kapsar.`
              : "Tüm satırlar."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Satır</TableHead>
                  <TableHead>Eczane Adı</TableHead>
                  <TableHead>Eczacı</TableHead>
                  <TableHead>Telefon</TableHead>
                  <TableHead>Aktif</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>Açıklama</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batch.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.rowNumber}</TableCell>
                    <TableCell className="font-medium">{row.pharmacyName || "-"}</TableCell>
                    <TableCell>{row.pharmacistName ?? "-"}</TableCell>
                    <TableCell>{row.phone ?? "-"}</TableCell>
                    <TableCell>{row.isActive ? "Evet" : "Hayır"}</TableCell>
                    <TableCell>
                      <Badge variant={row.status === "READY" ? "success" : "destructive"}>
                        {STATUS_LABELS[row.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <span className="text-muted-foreground block truncate text-xs">
                        {describePharmacyImportRowStatus(
                          row.status,
                          row.safeErrorCode as PharmacyRowErrorCode | null
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
                {batch.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground py-8 text-center">
                      Bu dosyada veri satırı bulunamadı.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        {canImport && (
          <form action={importPharmacyBatchAction.bind(null, batch.id)}>
            <SubmitButton pendingText="İçe aktarılıyor...">
              {`İçe Aktarımı Onayla (${batch.readyRows} eczane)`}
            </SubmitButton>
          </form>
        )}
        <Button variant="outline" asChild>
          <a href="/eczaneler/ice-aktar">Yeni Dosya Yükle</a>
        </Button>
      </div>
    </div>
  );
}
