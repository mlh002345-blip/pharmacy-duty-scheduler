// Duty Rules V2 — Phase 16: delete a DRAFT DutyPlanVersion, tenant- and
// status-checked via the same requireDraftPlanVersion guard every other
// mutation service in this directory uses. A DRAFT version is, by
// construction, never referenced by any DutySchedule or
// DutyGenerationRun (both hold a Restrict FK to planVersionId, and both
// are only ever created against an ACTIVE version — see
// assemble-v1-compatibility-engine-input.ts / assemble-v2-native-engine-input.ts)
// — so deleting one is always safe and never destroys committed schedule
// history. Its DayTypeRule/ShiftDefinition/DutyDraftPreview children
// cascade automatically (see prisma/schema.prisma).
//
// If this was the plan's only version, the now-empty DutyPlan is deleted
// too, so a fully-abandoned draft plan doesn't linger as an empty card on
// the plan list page.

import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { requireDraftPlanVersion, type PlanVersionGuardFailure } from "./plan-version-guard";

export type DeletePlanVersionInput = {
  organizationId: string;
  versionId: string;
  userId: string;
};

export type DeletePlanVersionSuccess = {
  ok: true;
  planDeleted: boolean;
};

export type DeletePlanVersionErrorCode = PlanVersionGuardFailure["code"];

export type DeletePlanVersionFailure = {
  ok: false;
  code: DeletePlanVersionErrorCode;
  message: string;
};

export type DeletePlanVersionResult = DeletePlanVersionSuccess | DeletePlanVersionFailure;

export async function deletePlanVersion(
  input: DeletePlanVersionInput
): Promise<DeletePlanVersionResult> {
  const { organizationId, versionId, userId } = input;

  const guard = await requireDraftPlanVersion(organizationId, versionId);
  if (!guard.ok) return { ok: false, code: guard.code, message: guard.message };
  const { planId } = guard.version;

  const planDeleted = await prisma.$transaction(async (tx) => {
    await tx.dutyPlanVersion.delete({ where: { id: versionId } });
    await writeAuditLog(tx, {
      organizationId,
      userId,
      action: "DELETE",
      entity: "DutyPlanVersion",
      entityId: versionId,
      before: { planId, status: "DRAFT" },
    });

    const remainingVersions = await tx.dutyPlanVersion.count({ where: { planId } });
    if (remainingVersions === 0) {
      await tx.dutyPlan.delete({ where: { id: planId } });
      await writeAuditLog(tx, {
        organizationId,
        userId,
        action: "DELETE",
        entity: "DutyPlan",
        entityId: planId,
        before: { lastVersionId: versionId },
      });
      return true;
    }
    return false;
  });

  return { ok: true, planDeleted };
}
