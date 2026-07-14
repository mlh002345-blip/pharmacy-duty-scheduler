import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
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
import { assignRowToCandidateAction } from "../../candidate-actions";
import { CandidateReviewSection } from "./candidate-review";

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
  REGION_PENDING: "Bölge Kararı Bekliyor",
  EXCLUDED: "Kapsam Dışı",
};

function rowStatusVariant(status: PharmacyImportRowStatus): "success" | "destructive" | "secondary" {
  if (status === "READY") return "success";
  if (status === "EXCLUDED") return "secondary";
  return "destructive";
}

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
      rows: {
        orderBy: { rowNumber: "asc" },
        take: PREVIEW_DISPLAY_LIMIT,
        include: {
          region: { select: { name: true } },
          candidate: { select: { proposedName: true, status: true, sourceValue: true } },
        },
      },
      regionCandidates: {
        orderBy: { sourceValue: "asc" },
        include: {
          matchedRegion: { select: { id: true, name: true, isActive: true } },
          _count: { select: { rows: true } },
        },
      },
      _count: { select: { rows: true } },
    },
  });
  if (!batch) notFound();

  const regions = await prisma.region.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, isActive: true },
  });

  const isExpired = isBatchExpired(batch);
  const editable = batch.status === "PREVIEWED" && !isExpired;
  const canImport = editable && batch.invalidRows === 0 && batch.readyRows > 0;
  const excludedCount = batch.rows.filter((row) => row.status === "EXCLUDED").length;
  const assignableCandidates = batch.regionCandidates.filter(
    (candidate) => candidate.status !== "EXCLUDED_BY_ADMIN"
  );

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
        {excludedCount > 0 && <Badge variant="secondary">{excludedCount} kapsam dışı</Badge>}
        <Badge variant="secondary">{batch.regionCandidates.length} bölge adayı</Badge>
        {batch.status === "IMPORTED" && <Badge variant="info">Aktarıldı</Badge>}
        {isExpired && <Badge variant="secondary">Süresi Doldu</Badge>}
      </div>

      {!canImport && editable && (
        <p className="text-destructive text-sm">
          İçe aktarım, tüm bölge kararları tamamlanıp kalan satırlar aktarıma hazır olmadan
          yapılamaz. Bölge Eşleştirme ve Onay bölümündeki adayları sonuçlandırın.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Bölge Eşleştirme ve Onay</CardTitle>
          <CardDescription>
            Dosyadaki benzersiz bölge değerleri. Her aday için: mevcut bir bölgeyle eşleştirin,
            yeni bölge olarak onaylayın, düzenleyin veya içe aktarım dışında bırakın. Hiçbir bölge
            onaysız oluşturulmaz.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CandidateReviewSection
            batchId={batch.id}
            editable={editable}
            regions={regions}
            candidates={batch.regionCandidates.map((candidate) => ({
              id: candidate.id,
              sourceValue: candidate.sourceValue,
              sourceType: candidate.sourceType,
              status: candidate.status,
              proposedName: candidate.proposedName,
              proposedCity: candidate.proposedCity,
              proposedDistrict: candidate.proposedDistrict,
              proposedIsActive: candidate.proposedIsActive,
              approvedAt: candidate.approvedAt,
              reactivateOnImport: candidate.reactivateOnImport,
              matchedRegion: candidate.matchedRegion,
              rowCount: candidate._count.rows,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Eczane Ön İzleme</CardTitle>
          <CardDescription>
            {batch._count.rows > PREVIEW_DISPLAY_LIMIT
              ? `İlk ${PREVIEW_DISPLAY_LIMIT} satır gösteriliyor; aktarım tüm satırları kapsar.`
              : "Tüm satırlar."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[32rem] overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Satır</TableHead>
                  <TableHead>Bölge Çözümü</TableHead>
                  <TableHead>Eczane Adı</TableHead>
                  <TableHead>Eczacı</TableHead>
                  <TableHead>Telefon</TableHead>
                  <TableHead>Adres</TableHead>
                  <TableHead>Aktif</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>Açıklama</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batch.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.rowNumber}</TableCell>
                    <TableCell className="min-w-[180px]">
                      {row.region?.name ? (
                        <span>{row.region.name}</span>
                      ) : row.candidate ? (
                        <span className="text-muted-foreground">
                          Aday: {row.candidate.proposedName}
                        </span>
                      ) : editable && assignableCandidates.length > 0 ? (
                        <form
                          action={assignRowToCandidateAction.bind(null, row.id)}
                          className="flex items-center gap-1"
                        >
                          <Select name="candidateId" defaultValue="" className="h-8 w-40 text-xs">
                            <option value="" disabled>
                              Bölge adayı seçin…
                            </option>
                            {assignableCandidates.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.proposedName}
                              </option>
                            ))}
                          </Select>
                          <SubmitButton variant="outline" size="sm" pendingText="...">
                            Ata
                          </SubmitButton>
                        </form>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{row.pharmacyName || "-"}</TableCell>
                    <TableCell>{row.pharmacistName ?? "-"}</TableCell>
                    <TableCell>{row.phone ?? "-"}</TableCell>
                    <TableCell className="max-w-[200px]">
                      <span className="block truncate text-xs">{row.address ?? "-"}</span>
                    </TableCell>
                    <TableCell>{row.isActive ? "Evet" : "Hayır"}</TableCell>
                    <TableCell>
                      <Badge variant={rowStatusVariant(row.status)}>
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
                    <TableCell colSpan={9} className="text-muted-foreground py-8 text-center">
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
