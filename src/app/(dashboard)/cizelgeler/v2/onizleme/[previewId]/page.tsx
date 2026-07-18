import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatCard } from "@/components/layout/stat-card";
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
import { CalendarCheck, AlertTriangle, CalendarRange } from "lucide-react";

import { prisma } from "@/lib/prisma";
import { requireOrganizationMember } from "@/lib/auth/tenant";
import { loadDraftPreview } from "@/lib/duty-rules-v2/ui/draft-preview-store";
import { commitV2DraftAction } from "./actions";

const DRAFT_STATUS_LABELS: Record<string, string> = {
  COMPLETE: "Tamamlandı",
  PARTIAL: "Eksik",
  INVALID: "Geçersiz",
};

const DRAFT_STATUS_BADGE_VARIANT: Record<string, "success" | "warning" | "destructive"> = {
  COMPLETE: "success",
  PARTIAL: "warning",
  INVALID: "destructive",
};

const ORIGIN_LABELS: Record<string, string> = {
  STRICT: "Normal seçim",
  RELAXED: "Kural gevşetilerek seçildi",
};

export default async function V2DraftPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ previewId: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { previewId } = await params;
  const { success, error } = await searchParams;

  const user = await requireOrganizationMember();

  const loaded = await loadDraftPreview({ previewId, organizationId: user.organizationId });
  if (!loaded.ok) {
    // NOT_FOUND (including cross-tenant), EXPIRED, and ALREADY_CONSUMED
    // are all rendered as a plain 404 — never a raw error page, and
    // never a hint that distinguishes "wrong tenant" from "doesn't exist".
    notFound();
  }
  const { draft } = loaded;

  const region = await prisma.region.findFirst({
    where: { id: loaded.row.regionId, organizationId: user.organizationId },
    select: { name: true },
  });

  const statusLabel = DRAFT_STATUS_LABELS[draft.status] ?? draft.status;
  const statusVariant = DRAFT_STATUS_BADGE_VARIANT[draft.status] ?? "warning";
  const canSave = draft.status === "COMPLETE" && draft.isCommitEligible;

  const warnings = draft.diagnostics.filter((d) => d.severity !== "INFO");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">
              {region?.name ?? "Bölge"} — V2 Taslak Önizlemesi
            </h1>
            <Badge variant={statusVariant}>{statusLabel}</Badge>
          </div>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {draft.periodStart} – {draft.periodEnd} dönemi
          </p>
        </div>
        <form action={commitV2DraftAction.bind(null, previewId)}>
          <SubmitButton disabled={!canSave}>Taslağı Kaydet</SubmitButton>
        </form>
      </div>

      <ListBanner success={success} error={error} />

      {!canSave && (
        <p className="text-destructive text-sm font-medium">
          Bu taslak eksik/geçersiz olduğu için kaydedilemez.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Toplam Atama"
          value={draft.counts.totalAssignments}
          icon={CalendarCheck}
          accent="green"
        />
        <StatCard
          label="Eksik Atama"
          value={loaded.row.missingAssignmentCount}
          icon={CalendarRange}
          accent="amber"
        />
        <StatCard
          label="Uyarı Sayısı"
          value={loaded.row.warningCount}
          icon={AlertTriangle}
          accent="sky"
        />
        <StatCard label="Dönem" value={`${draft.periodStart} – ${draft.periodEnd}`} icon={CalendarRange} accent="navy" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Atamalar</CardTitle>
          <CardDescription>{draft.assignments.length} atama.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarih</TableHead>
                <TableHead>Slot</TableHead>
                <TableHead>Eczane</TableHead>
                <TableHead>Sıra</TableHead>
                <TableHead>Ağırlık</TableHead>
                <TableHead>Seçim Türü</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {draft.assignments.map((assignment) => (
                <TableRow key={assignment.draftAssignmentKey}>
                  <TableCell>{assignment.date}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {assignment.slotKey}
                  </TableCell>
                  <TableCell className="font-medium">{assignment.pharmacyName}</TableCell>
                  <TableCell>{assignment.selectionOrdinal}</TableCell>
                  <TableCell>{assignment.dutyWeight}</TableCell>
                  <TableCell>
                    <Badge variant={assignment.origin === "RELAXED" ? "warning" : "success"}>
                      {ORIGIN_LABELS[assignment.origin] ?? assignment.origin}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {draft.assignments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground text-center">
                    Bu taslak için atama bulunmuyor.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {(warnings.length > 0 ||
        draft.manifest.unresolvedSlotKeys.length > 0 ||
        draft.manifest.underfilledSlotKeys.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Uyarılar ve Tanılar</CardTitle>
            <CardDescription>
              Çözümlenemeyen slot sayısı: {draft.manifest.unresolvedSlotKeys.length}, eksik
              doldurulan slot sayısı: {draft.manifest.underfilledSlotKeys.length}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1.5 text-sm">
              {warnings.map((diagnostic, index) => (
                <li key={`${diagnostic.code}-${diagnostic.subjectKey}-${index}`} className="flex items-baseline gap-2">
                  <Badge variant={diagnostic.severity === "ERROR" ? "destructive" : "warning"}>
                    {diagnostic.severity}
                  </Badge>
                  <span className="text-muted-foreground">
                    {diagnostic.code}
                    {diagnostic.date ? ` (${diagnostic.date})` : ""} — {diagnostic.subjectKey}
                  </span>
                </li>
              ))}
              {warnings.length === 0 && (
                <li className="text-muted-foreground">Uyarı bulunmuyor.</li>
              )}
            </ul>
          </CardContent>
        </Card>
      )}

      <details className="rounded-xl border bg-white p-5 text-sm shadow-sm">
        <summary className="cursor-pointer font-medium">Teknik Ayrıntılar</summary>
        <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground text-xs">Taslak Parmak İzi</dt>
            <dd className="font-mono text-xs">
              {draft.completeDraftFingerprint.slice(0, 12)}…
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Plan Sürümü</dt>
            <dd className="font-mono text-xs">{draft.provenance.planVersionId}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Motor Sürümü</dt>
            <dd className="text-xs">
              {draft.engineVersion} / {draft.selectionEngineVersion}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Tanı Kodları</dt>
            <dd className="text-xs">
              {draft.manifest.blockingDiagnosticCodes.length > 0
                ? draft.manifest.blockingDiagnosticCodes.join(", ")
                : "-"}
            </dd>
          </div>
        </dl>
      </details>
    </div>
  );
}
