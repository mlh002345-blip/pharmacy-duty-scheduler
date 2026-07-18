// Duty Rules V2 — Phase 9: publication — the second step of the DRAFT ->
// APPROVED -> PUBLISHED lifecycle. The ONLY place in this codebase that
// ever writes RotationState.currentRound/lastServedMembershipId/
// carriedForward/lockVersion (see advance-rotation-state.ts's header).
//
// SCOPE BOUNDARY (see docs/architecture/DUTY_RULES_V2_APPROVAL_PUBLICATION.md):
// never re-runs Phase 4-7, never re-ranks or replaces a single
// DutyAssignment row — RotationState advancement is derived ENTIRELY
// from already-persisted assignment facts (resolveRotationTargets) and
// the pure computeRotationAdvancement math. No production route or
// server action calls this service in this phase.

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { logger } from "@/lib/observability/logger";
import { computeRotationAdvancement } from "./advance-rotation-state";
import { resolveRotationTargets, type RotationTarget } from "./resolve-rotation-targets";
import { validateGenerationRunIntegrity } from "./validate-generation-run-integrity";

export type PublishApprovedScheduleInput = {
  dutyScheduleId: string;
  organizationId: string;
  userId: string;
};

export type PublishApprovedScheduleOutcome = "PUBLISHED" | "IDEMPOTENT_REPLAY";

export type PublishApprovedScheduleSuccess = {
  ok: true;
  outcome: PublishApprovedScheduleOutcome;
  dutyScheduleId: string;
  generationRunId: string;
  status: "PUBLISHED";
  publishedBy: string;
  publishedAt: string;
  updatedRotationStateCount: number;
};

export type PublishApprovedScheduleErrorCode =
  | "SCHEDULE_NOT_FOUND"
  | "TENANT_MISMATCH"
  | "GENERATION_RUN_MISSING"
  | "SCHEDULE_NOT_APPROVED"
  | "GENERATION_RECORD_CORRUPTED"
  | "ROTATION_STATE_CONFLICT"
  | "PUBLICATION_TARGET_CONFLICT"
  | "PUBLICATION_TRANSACTION_FAILED";

export type PublishApprovedScheduleFailure = {
  ok: false;
  code: PublishApprovedScheduleErrorCode;
  message: string;
};

export type PublishApprovedScheduleResult = PublishApprovedScheduleSuccess | PublishApprovedScheduleFailure;

export type PublishApprovedScheduleTestOnlyOptions = {
  writeAuditLogFn?: typeof writeAuditLog;
  failAfterStep?: "FIRST_ROTATION_UPDATE" | "ALL_ROTATION_UPDATES" | "SCHEDULE_STATUS_UPDATE" | "AUDIT_WRITE";
};

function fail(code: PublishApprovedScheduleErrorCode, message: string): PublishApprovedScheduleFailure {
  return { ok: false, code, message };
}

class PublishRollbackTestError extends Error {
  constructor(step: string) {
    super(`test-only forced rollback after ${step}`);
  }
}
class PublishIdempotentReplaySignal extends Error {
  constructor() {
    super("idempotent replay");
  }
}
class RotationStateConflictSignal extends Error {
  constructor() {
    super("rotation state conflict");
  }
}

type RotationSnapshotEntry = { rotationStateId: string; lockVersion: number };

function snapshotMismatch(
  snapshot: RotationSnapshotEntry[],
  current: RotationTarget[]
): boolean {
  if (snapshot.length !== current.length) return true;
  const currentByRotationStateId = new Map(current.map((t) => [t.rotationStateId, t.priorLockVersion]));
  return snapshot.some((entry) => currentByRotationStateId.get(entry.rotationStateId) !== entry.lockVersion);
}

export async function publishApprovedSchedule(
  input: PublishApprovedScheduleInput,
  testOnly: PublishApprovedScheduleTestOnlyOptions = {}
): Promise<PublishApprovedScheduleResult> {
  const { dutyScheduleId, organizationId, userId } = input;
  const writeAuditLogFn = testOnly.writeAuditLogFn ?? writeAuditLog;

  const schedule = await prisma.dutySchedule.findUnique({
    where: { id: dutyScheduleId },
    include: { region: { select: { organizationId: true } }, generationRun: true },
  });
  if (!schedule) return fail("SCHEDULE_NOT_FOUND", "Nöbet çizelgesi bulunamadı.");
  if (schedule.region.organizationId !== organizationId) {
    return fail("TENANT_MISMATCH", "Çizelge, çağıranın organizasyonuna ait değil.");
  }
  if (!schedule.generationRun) {
    return fail(
      "GENERATION_RUN_MISSING",
      "Bu çizelge Faz 8 ile oluşturulmamış; yayınlama yalnızca üretim kaydı olan çizelgeler için geçerlidir."
    );
  }
  const run = schedule.generationRun;
  if (run.organizationId !== organizationId || run.regionId !== schedule.regionId) {
    return fail("TENANT_MISMATCH", "Üretim kaydı, çağıranın organizasyon/bölgesine ait değil.");
  }

  if (schedule.status === "PUBLISHED") {
    if (run.status === "PUBLISHED" && run.publishedById && run.publishedAt) {
      return {
        ok: true,
        outcome: "IDEMPOTENT_REPLAY",
        dutyScheduleId,
        generationRunId: run.id,
        status: "PUBLISHED",
        publishedBy: run.publishedById,
        publishedAt: run.publishedAt.toISOString(),
        updatedRotationStateCount: 0,
      };
    }
    return fail("GENERATION_RECORD_CORRUPTED", "Çizelge yayınlanmış görünüyor ancak üretim kaydı tutarsız.");
  }
  if (schedule.status === "DRAFT") {
    return fail("SCHEDULE_NOT_APPROVED", "Çizelge önce onaylanmalıdır (DRAFT durumunda).");
  }
  // schedule.status === "APPROVED" from here on.
  if (run.status !== "APPROVED" || !run.rotationStateSnapshot) {
    return fail("GENERATION_RECORD_CORRUPTED", "Çizelge onaylı görünüyor ancak onay anlık görüntüsü eksik.");
  }

  const integrityError = await validateGenerationRunIntegrity(run, organizationId, schedule.regionId);
  if (integrityError) return fail(integrityError.code, integrityError.message);

  const approvalSnapshot = run.rotationStateSnapshot as unknown as RotationSnapshotEntry[];
  const currentTargets = await resolveRotationTargets(prisma, run.id);
  if (snapshotMismatch(approvalSnapshot, currentTargets)) {
    return fail(
      "ROTATION_STATE_CONFLICT",
      "İlgili rotasyon durumu, onaydan bu yana değişmiş; yayınlama reddedildi."
    );
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const fresh = await tx.dutySchedule.findUnique({ where: { id: dutyScheduleId }, select: { status: true } });
        if (!fresh) throw new Error("schedule vanished mid-transaction");
        if (fresh.status === "PUBLISHED") throw new PublishIdempotentReplaySignal();
        if (fresh.status !== "APPROVED") throw new RotationStateConflictSignal();

        // Re-check the SAME lockVersions inside the transaction, closing
        // the pre-check's TOCTOU window.
        const raceTargets = await resolveRotationTargets(tx, run.id);
        if (snapshotMismatch(approvalSnapshot, raceTargets)) {
          throw new RotationStateConflictSignal();
        }

        let updatedCount = 0;
        for (const target of raceTargets) {
          const advancement = computeRotationAdvancement({
            currentRound: target.priorCurrentRound,
            lastServedMembershipId: target.priorLastServedMembershipId,
            carriedForward: target.priorCarriedForward,
            servedMembershipIdsInOrder: target.servedMembershipIdsInOrder,
            activeMembershipIdsInOrder: target.activeMembershipIdsInOrder,
          });
          const updateResult = await tx.rotationState.updateMany({
            where: { id: target.rotationStateId, lockVersion: target.priorLockVersion },
            data: {
              currentRound: advancement.currentRound,
              lastServedMembershipId: advancement.lastServedMembershipId,
              carriedForward: advancement.carriedForward as unknown as Prisma.InputJsonValue,
              lockVersion: { increment: 1 },
            },
          });
          if (updateResult.count !== 1) throw new RotationStateConflictSignal();
          updatedCount += 1;

          if (updatedCount === 1 && testOnly.failAfterStep === "FIRST_ROTATION_UPDATE") {
            throw new PublishRollbackTestError("FIRST_ROTATION_UPDATE");
          }
        }
        if (testOnly.failAfterStep === "ALL_ROTATION_UPDATES") {
          throw new PublishRollbackTestError("ALL_ROTATION_UPDATES");
        }

        const scheduleUpdate = await tx.dutySchedule.updateMany({
          where: { id: dutyScheduleId, status: "APPROVED" },
          data: { status: "PUBLISHED" },
        });
        if (scheduleUpdate.count !== 1) throw new PublishIdempotentReplaySignal();
        if (testOnly.failAfterStep === "SCHEDULE_STATUS_UPDATE") {
          throw new PublishRollbackTestError("SCHEDULE_STATUS_UPDATE");
        }

        const publishedAt = new Date();
        const updatedRun = await tx.dutyGenerationRun.update({
          where: { id: run.id },
          data: { status: "PUBLISHED", publishedById: userId, publishedAt },
        });

        await writeAuditLogFn(tx, {
          organizationId,
          userId,
          action: "UPDATE",
          entity: "DutySchedule",
          entityId: dutyScheduleId,
          before: { status: "APPROVED" },
          after: { status: "PUBLISHED", generationRunId: run.id, updatedRotationStateCount: updatedCount },
        });
        if (testOnly.failAfterStep === "AUDIT_WRITE") {
          throw new PublishRollbackTestError("AUDIT_WRITE");
        }

        const success: PublishApprovedScheduleSuccess = {
          ok: true,
          outcome: "PUBLISHED",
          dutyScheduleId,
          generationRunId: run.id,
          status: "PUBLISHED",
          publishedBy: userId,
          publishedAt: updatedRun.publishedAt!.toISOString(),
          updatedRotationStateCount: updatedCount,
        };
        return success;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return result;
  } catch (error) {
    if (error instanceof PublishIdempotentReplaySignal) {
      const fresh = await prisma.dutySchedule.findUnique({
        where: { id: dutyScheduleId },
        include: { generationRun: true },
      });
      if (fresh?.generationRun?.status === "PUBLISHED" && fresh.generationRun.publishedById && fresh.generationRun.publishedAt) {
        return {
          ok: true,
          outcome: "IDEMPOTENT_REPLAY",
          dutyScheduleId,
          generationRunId: fresh.generationRun.id,
          status: "PUBLISHED",
          publishedBy: fresh.generationRun.publishedById,
          publishedAt: fresh.generationRun.publishedAt.toISOString(),
          updatedRotationStateCount: 0,
        };
      }
      return fail("PUBLICATION_TARGET_CONFLICT", "Yayınlama eşzamanlılık çakışmasından sonra yeniden bulunamadı.");
    }
    if (error instanceof RotationStateConflictSignal) {
      return fail(
        "ROTATION_STATE_CONFLICT",
        "İlgili rotasyon durumu, onaydan bu yana değişmiş; yayınlama reddedildi."
      );
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      // Serializable write-conflict/deadlock — re-check which state
      // actually won rather than guessing from the error alone.
      const fresh = await prisma.dutySchedule.findUnique({
        where: { id: dutyScheduleId },
        include: { generationRun: true },
      });
      if (fresh?.status === "PUBLISHED" && fresh.generationRun?.publishedById && fresh.generationRun.publishedAt) {
        return {
          ok: true,
          outcome: "IDEMPOTENT_REPLAY",
          dutyScheduleId,
          generationRunId: fresh.generationRun.id,
          status: "PUBLISHED",
          publishedBy: fresh.generationRun.publishedById,
          publishedAt: fresh.generationRun.publishedAt.toISOString(),
          updatedRotationStateCount: 0,
        };
      }
      logger.error("duty_generation_run_publication_failed", { organizationId, dutyScheduleId, reason: "serialization_conflict" }, error);
      return fail("PUBLICATION_TRANSACTION_FAILED", "Yayınlama sırasında bir eşzamanlılık çakışması oluştu.");
    }
    if (error instanceof PublishRollbackTestError) {
      return fail("PUBLICATION_TRANSACTION_FAILED", error.message);
    }
    logger.error("duty_generation_run_publication_failed", { organizationId, dutyScheduleId, reason: "unexpected_error" }, error);
    return fail("PUBLICATION_TRANSACTION_FAILED", "Yayınlama sırasında beklenmeyen bir hata oluştu.");
  }
}
