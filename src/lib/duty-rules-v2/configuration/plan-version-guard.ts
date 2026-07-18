// Duty Rules V2 — Phase 11: shared tenant + DRAFT-status guard used by
// every mutation service in this directory. NOT part of the Phase 1-9
// loader stack (never imported by it, never imports from
// load-duty-plan-version.ts) — a small, focused, configuration-time-only
// helper so every setX/addX/createX service enforces the same two rules
// identically: (a) the version belongs to the caller's own organization
// (and, when a regionId is supplied, that region too), (b) the version is
// still DRAFT (edit-frozen otherwise, per plan-version-policy.ts's status
// matrix — this phase only allows DRAFT to be mutated).

import { prisma } from "@/lib/prisma";

export type PlanVersionGuardErrorCode = "VERSION_NOT_FOUND" | "VERSION_NOT_DRAFT";

export type PlanVersionGuardFailure = {
  ok: false;
  code: PlanVersionGuardErrorCode;
  message: string;
};

export type PlanVersionGuardSuccess = {
  ok: true;
  version: {
    id: string;
    status: string;
    versionNumber: number;
    validFrom: Date;
    validTo: Date | null;
    planId: string;
    regionId: string;
    organizationId: string;
  };
};

export type PlanVersionGuardResult = PlanVersionGuardSuccess | PlanVersionGuardFailure;

/**
 * Tenant-scoped fetch of a DutyPlanVersion + its parent plan's
 * organizationId/regionId, requiring DRAFT status. Every configuration
 * mutation service should call this FIRST, before touching any child
 * rows, and never trust a client-supplied versionId without it.
 */
export async function requireDraftPlanVersion(
  organizationId: string,
  versionId: string
): Promise<PlanVersionGuardResult> {
  const version = await prisma.dutyPlanVersion.findFirst({
    where: { id: versionId, plan: { organizationId } },
    select: {
      id: true,
      status: true,
      versionNumber: true,
      validFrom: true,
      validTo: true,
      planId: true,
      plan: { select: { regionId: true, organizationId: true } },
    },
  });
  if (!version) {
    return { ok: false, code: "VERSION_NOT_FOUND", message: "Plan sürümü bulunamadı." };
  }
  if (version.status !== "DRAFT") {
    return {
      ok: false,
      code: "VERSION_NOT_DRAFT",
      message: "Bu sürüm DRAFT durumunda olmadığı için düzenlenemez.",
    };
  }
  return {
    ok: true,
    version: {
      id: version.id,
      status: version.status,
      versionNumber: version.versionNumber,
      validFrom: version.validFrom,
      validTo: version.validTo,
      planId: version.planId,
      regionId: version.plan.regionId,
      organizationId: version.plan.organizationId,
    },
  };
}
