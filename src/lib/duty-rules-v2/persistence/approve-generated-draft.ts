// Duty Rules V2 — Phase 9: approval — the first of the two-step DRAFT ->
// APPROVED -> PUBLISHED lifecycle for a Phase 8-generated schedule.
//
// SCOPE BOUNDARY (see docs/architecture/DUTY_RULES_V2_APPROVAL_PUBLICATION.md):
// approval NEVER writes to RotationState — it only READS the RotationState
// rows publication will later touch, to snapshot their current
// lockVersions as the "expected state" optimistic-lock baseline
// publish-approved-schedule.ts checks against. Approval never re-ranks,
// re-selects, or changes a single DutyAssignment row. No production
// route or server action calls this service in this phase.

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { logger } from "@/lib/observability/logger";
import { resolveRotationTargets } from "./resolve-rotation-targets";
import { validateGenerationRunIntegrity } from "./validate-generation-run-integrity";

export type ApproveGeneratedDraftInput = {
  dutyScheduleId: string;
  /** Trusted, session-derived tenant context — never taken from the
   *  schedule alone. */
  organizationId: string;
  /** The authenticated actor approving this draft. */
  userId: string;
};

export type ApproveGeneratedDraftOutcome = "APPROVED" | "IDEMPOTENT_REPLAY";

export type ApproveGeneratedDraftSuccess = {
  ok: true;
  outcome: ApproveGeneratedDraftOutcome;
  dutyScheduleId: string;
  generationRunId: string;
  status: "APPROVED";
  approvedBy: string;
  approvedAt: string;
};

export type ApproveGeneratedDraftErrorCode =
  | "SCHEDULE_NOT_FOUND"
  | "TENANT_MISMATCH"
  | "GENERATION_RUN_MISSING"
  | "SCHEDULE_NOT_DRAFT"
  | "SCHEDULE_ALREADY_PUBLISHED"
  | "GENERATION_RECORD_CORRUPTED"
  | "APPROVAL_TRANSACTION_FAILED";

export type ApproveGeneratedDraftFailure = {
  ok: false;
  code: ApproveGeneratedDraftErrorCode;
  message: string;
};

export type ApproveGeneratedDraftResult = ApproveGeneratedDraftSuccess | ApproveGeneratedDraftFailure;

export type ApproveGeneratedDraftTestOnlyOptions = {
  writeAuditLogFn?: typeof writeAuditLog;
};

function fail(code: ApproveGeneratedDraftErrorCode, message: string): ApproveGeneratedDraftFailure {
  return { ok: false, code, message };
}

class ApprovalIdempotentReplaySignal extends Error {
  constructor() {
    super("idempotent replay");
  }
}

export async function approveGeneratedDraft(
  input: ApproveGeneratedDraftInput,
  testOnly: ApproveGeneratedDraftTestOnlyOptions = {}
): Promise<ApproveGeneratedDraftResult> {
  const { dutyScheduleId, organizationId, userId } = input;
  const writeAuditLogFn = testOnly.writeAuditLogFn ?? writeAuditLog;

  const schedule = await prisma.dutySchedule.findUnique({
    where: { id: dutyScheduleId },
    include: { region: { select: { organizationId: true } }, generationRun: true },
  });
  if (!schedule) {
    return fail("SCHEDULE_NOT_FOUND", "Nöbet çizelgesi bulunamadı.");
  }
  if (schedule.region.organizationId !== organizationId) {
    return fail("TENANT_MISMATCH", "Çizelge, çağıranın organizasyonuna ait değil.");
  }
  if (!schedule.generationRun) {
    return fail(
      "GENERATION_RUN_MISSING",
      "Bu çizelge Faz 8 ile oluşturulmamış; onay yalnızca üretim kaydı olan taslaklar için geçerlidir."
    );
  }
  const run = schedule.generationRun;
  if (run.organizationId !== organizationId || run.regionId !== schedule.regionId) {
    return fail("TENANT_MISMATCH", "Üretim kaydı, çağıranın organizasyon/bölgesine ait değil.");
  }

  if (schedule.status === "PUBLISHED") {
    return fail("SCHEDULE_ALREADY_PUBLISHED", "Yayınlanmış bir çizelge onaylanamaz.");
  }
  if (schedule.status === "APPROVED") {
    if (run.status !== "APPROVED" || !run.approvedById || !run.approvedAt) {
      return fail(
        "GENERATION_RECORD_CORRUPTED",
        "Çizelge onaylı görünüyor ancak üretim kaydı tutarsız."
      );
    }
    return {
      ok: true,
      outcome: "IDEMPOTENT_REPLAY",
      dutyScheduleId: schedule.id,
      generationRunId: run.id,
      status: "APPROVED",
      approvedBy: run.approvedById,
      approvedAt: run.approvedAt.toISOString(),
    };
  }
  if (schedule.status !== "DRAFT") {
    return fail("SCHEDULE_NOT_DRAFT", "Çizelge DRAFT durumunda değil.");
  }

  const integrityError = await validateGenerationRunIntegrity(run, organizationId, schedule.regionId);
  if (integrityError) return fail(integrityError.code, integrityError.message);

  // The persisted DutySchedule.@@unique([year, month, regionId]) makes a
  // second, conflicting schedule for this exact target structurally
  // impossible while this row exists — there is nothing further to check
  // beyond the status gate above.

  try {
    const rotationTargets = await resolveRotationTargets(prisma, run.id);
    const rotationStateSnapshot = rotationTargets.map((t) => ({
      rotationStateId: t.rotationStateId,
      lockVersion: t.priorLockVersion,
    }));

    const result = await prisma.$transaction(
      async (tx) => {
        // Conditional update (not an unconditional update after a
        // separate read) so that two concurrent approvals can never both
        // "win": only the request whose WHERE clause still matches
        // status: DRAFT at UPDATE time affects a row. The other's count
        // is 0 and is recovered below as an idempotent replay — this is
        // the same race-safety pattern publish-approved-schedule.ts uses
        // for its own schedule-status transition.
        const scheduleUpdate = await tx.dutySchedule.updateMany({
          where: { id: dutyScheduleId, status: "DRAFT" },
          data: { status: "APPROVED" },
        });
        if (scheduleUpdate.count !== 1) throw new ApprovalIdempotentReplaySignal();

        const approvedAt = new Date();
        const updatedRun = await tx.dutyGenerationRun.update({
          where: { id: run.id },
          data: {
            status: "APPROVED",
            approvedById: userId,
            approvedAt,
            rotationStateSnapshot: rotationStateSnapshot as unknown as Prisma.InputJsonValue,
          },
        });

        await writeAuditLogFn(tx, {
          organizationId,
          userId,
          action: "UPDATE",
          entity: "DutySchedule",
          entityId: dutyScheduleId,
          before: { status: "DRAFT" },
          after: { status: "APPROVED", generationRunId: run.id },
        });

        const success: ApproveGeneratedDraftSuccess = {
          ok: true,
          outcome: "APPROVED",
          dutyScheduleId,
          generationRunId: run.id,
          status: "APPROVED",
          approvedBy: userId,
          approvedAt: updatedRun.approvedAt!.toISOString(),
        };
        return success;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return result;
  } catch (error) {
    if (error instanceof ApprovalIdempotentReplaySignal) {
      const fresh = await prisma.dutySchedule.findUnique({
        where: { id: dutyScheduleId },
        include: { generationRun: true },
      });
      if (fresh?.generationRun?.approvedById && fresh.generationRun.approvedAt) {
        return {
          ok: true,
          outcome: "IDEMPOTENT_REPLAY",
          dutyScheduleId,
          generationRunId: fresh.generationRun.id,
          status: "APPROVED",
          approvedBy: fresh.generationRun.approvedById,
          approvedAt: fresh.generationRun.approvedAt.toISOString(),
        };
      }
      return fail("APPROVAL_TRANSACTION_FAILED", "Onay eşzamanlılık çakışmasından sonra yeniden bulunamadı.");
    }
    logger.error("duty_generation_run_approval_failed", { organizationId, dutyScheduleId, reason: "unexpected_error" }, error);
    return fail("APPROVAL_TRANSACTION_FAILED", "Onay sırasında beklenmeyen bir hata oluştu.");
  }
}
