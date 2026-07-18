// Duty Rules V2 — Phase 10: draft preview persistence helpers.
//
// A DutyDraftPreview row is a short-lived, tenant-scoped holder for one
// generated (but not yet committed) Phase 7 CompleteDraftSchedule. This
// is what makes the "generate -> review -> save" admin UI flow safe:
// commitV2DraftAction never accepts a browser-supplied assignment array
// — it reads the ALREADY-GENERATED draft back from this table (by a
// server-issued previewId) and feeds it, unmodified, into
// commit-complete-draft.ts.

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { CompleteDraftSchedule } from "../draft/domain/draft-schedule";

export const DRAFT_PREVIEW_TTL_MINUTES = 30;

export type SaveDraftPreviewParams = {
  organizationId: string;
  regionId: string;
  planVersionId: string;
  createdById: string;
  draft: CompleteDraftSchedule;
};

export async function saveDraftPreview(
  params: SaveDraftPreviewParams
): Promise<{ previewId: string }> {
  const { organizationId, regionId, planVersionId, createdById, draft } = params;

  // Sum of each day's own (already-validated-consistent) missingCount —
  // equivalent to totalSlots - filledSlots but derived from the
  // per-day summary Phase 7 already computed and cross-checked.
  const missingAssignmentCount = draft.days.reduce((sum, day) => sum + day.missingCount, 0);
  const warningCount = draft.diagnostics.filter((d) => d.severity === "WARNING").length;

  const expiresAt = new Date(Date.now() + DRAFT_PREVIEW_TTL_MINUTES * 60 * 1000);

  const row = await prisma.dutyDraftPreview.create({
    data: {
      status: draft.status,
      isCommitEligible: draft.isCommitEligible,
      periodStart: new Date(`${draft.periodStart}T00:00:00.000Z`),
      periodEnd: new Date(`${draft.periodEnd}T00:00:00.000Z`),
      assignmentCount: draft.counts.totalAssignments,
      missingAssignmentCount,
      warningCount,
      completeDraftFingerprint: draft.completeDraftFingerprint,
      // Round-tripped through JSON.parse(JSON.stringify(...)) so the
      // stored value is plain, Prisma-InputJsonValue-safe JSON — the
      // draft object itself never carries Date instances or class
      // instances (see draft-schedule.ts's header), so this is a
      // lossless round trip.
      payload: JSON.parse(JSON.stringify(draft)) as Prisma.InputJsonValue,
      expiresAt,
      organizationId,
      regionId,
      planVersionId,
      createdById,
    },
    select: { id: true },
  });

  return { previewId: row.id };
}

export type LoadDraftPreviewParams = {
  previewId: string;
  organizationId: string;
};

export type LoadedDraftPreviewRow = {
  id: string;
  organizationId: string;
  regionId: string;
  planVersionId: string;
  createdById: string;
  status: string;
  isCommitEligible: boolean;
  assignmentCount: number;
  missingAssignmentCount: number;
  warningCount: number;
  completeDraftFingerprint: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
};

export type LoadDraftPreviewResult =
  | { ok: true; row: LoadedDraftPreviewRow; draft: CompleteDraftSchedule }
  | { ok: false; code: "NOT_FOUND" | "EXPIRED" | "ALREADY_CONSUMED"; message: string };

/**
 * Tenant-scoped lookup: cross-tenant and nonexistent ids are both
 * NOT_FOUND (never distinguishable), matching this codebase's standard
 * non-disclosure convention (see load-duty-plan-version.ts).
 */
export async function loadDraftPreview(
  params: LoadDraftPreviewParams
): Promise<LoadDraftPreviewResult> {
  const { previewId, organizationId } = params;

  const row = await prisma.dutyDraftPreview.findFirst({
    where: { id: previewId, organizationId },
  });
  if (!row) {
    return { ok: false, code: "NOT_FOUND", message: "Taslak önizlemesi bulunamadı." };
  }
  if (row.expiresAt.getTime() < Date.now()) {
    return {
      ok: false,
      code: "EXPIRED",
      message: "Taslak önizlemesinin süresi doldu. Lütfen yeniden oluşturun.",
    };
  }
  if (row.consumedAt !== null) {
    return {
      ok: false,
      code: "ALREADY_CONSUMED",
      message: "Bu taslak önizlemesi zaten kaydedilmiş.",
    };
  }

  return {
    ok: true,
    row,
    draft: row.payload as unknown as CompleteDraftSchedule,
  };
}

export async function markDraftPreviewConsumed(previewId: string): Promise<void> {
  await prisma.dutyDraftPreview.update({
    where: { id: previewId },
    data: { consumedAt: new Date() },
  });
}
