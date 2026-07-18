// Duty Rules V2 — Phase 8: atomic Complete Draft Schedule persistence.
//
// Persists a Phase 7 CompleteDraftSchedule into exactly one DRAFT
// DutySchedule, one DutyGenerationRun provenance record, and its
// DutyAssignment rows — or does nothing at all. Never partially writes.
//
// SCOPE BOUNDARY (see docs/architecture/DUTY_RULES_V2_ATOMIC_DRAFT_PERSISTENCE.md):
// this module only persists a generated draft as a DRAFT schedule. It
// NEVER publishes a schedule, never advances RotationState (currentRound/
// lockVersion/carriedForward/lastServedMembershipId are untouched), and
// is called by NOTHING in production yet — there is no route or server
// action wired to it in this phase. Approval/publication is Phase 9.
//
// This module performs its own re-derivation of nothing: every fact it
// writes is either copied verbatim from the CompleteDraftSchedule (a
// pure, already-computed Phase 4-7 artifact) or read back from the
// database purely to VALIDATE that the draft's references still resolve
// to real, same-tenant rows — it never re-ranks, re-selects, or invents
// a winner.

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { logger } from "@/lib/observability/logger";
import type {
  CompleteDraftSchedule,
  DraftAssignment,
} from "../draft/domain/draft-schedule";
import { computeCompleteDraftFingerprint } from "../draft/fingerprint-complete-draft";
import { sha256Canonical } from "../engine/build-selection-input";
import { parseDateKey } from "../../scheduling/date-tr";

// Phase 8's OWN contract version: which shape of CompleteDraftSchedule
// (and which validation rules) this commit service was built against.
// Independent of Phase 7's own engineVersion/selectionEngineVersion,
// both of which are persisted verbatim from the draft instead of
// re-derived here. Bump this only when commit-complete-draft.ts's own
// validation/persistence contract changes in a provenance-relevant way.
export const DRAFT_ENGINE_VERSION = 1;

export type CommitCompleteDraftInput = {
  draft: CompleteDraftSchedule;
  /** Trusted, session-derived tenant context — never taken from the
   *  draft alone. Cross-checked against draft.provenance below. */
  organizationId: string;
  regionId: string;
  /** The authenticated actor committing this draft — recorded on the
   *  audit log entry, exactly like generateAndSaveDutySchedule's userId. */
  userId: string;
};

export type CommitCompleteDraftOutcome = "CREATED" | "IDEMPOTENT_REPLAY";

export type CommitCompleteDraftSuccess = {
  ok: true;
  outcome: CommitCompleteDraftOutcome;
  dutyScheduleId: string;
  generationRunId: string;
  assignmentCount: number;
  completeDraftFingerprint: string;
  scheduleStatus: "DRAFT";
  periodStart: string;
  periodEnd: string;
};

export type CommitCompleteDraftErrorCode =
  | "DRAFT_NOT_COMMIT_ELIGIBLE"
  | "DRAFT_FINGERPRINT_MISMATCH"
  | "DRAFT_MANIFEST_MISMATCH"
  | "DRAFT_TENANT_MISMATCH"
  | "DRAFT_REFERENCE_MISMATCH"
  | "DRAFT_ALREADY_COMMITTED"
  | "DRAFT_TARGET_CONFLICT"
  | "DRAFT_TRANSACTION_FAILED";

export type CommitCompleteDraftFailure = {
  ok: false;
  code: CommitCompleteDraftErrorCode;
  /** Safe, generic message — never a raw Prisma error/driver message. */
  message: string;
};

export type CommitCompleteDraftResult = CommitCompleteDraftSuccess | CommitCompleteDraftFailure;

/** Test-only seams, mirroring generateAndSaveDutySchedule's
 *  writeAuditLogFn convention. Production code never sets these — the
 *  defaults are the real implementations, so production behavior is
 *  byte-identical whether or not this parameter is passed. */
export type CommitCompleteDraftTestOnlyOptions = {
  writeAuditLogFn?: typeof writeAuditLog;
  /** Throws a distinguishable, caught-and-classified test error at the
   *  named point inside the transaction, purely to PROVE the rollback
   *  boundary. Never set in production code. */
  failAfterStep?: "SCHEDULE_CREATED" | "GENERATION_RUN_CREATED" | "PARTIAL_ASSIGNMENTS";
};

class CommitRollbackTestError extends Error {
  constructor(step: string) {
    super(`test-only forced rollback after ${step}`);
    this.name = "CommitRollbackTestError";
  }
}

/** Internal-only signal thrown inside the transaction to unwind it (so
 *  every write so far rolls back) and be reclassified outside as a
 *  typed, non-throwing result. Never escapes this module. */
class IdempotentReplaySignal extends Error {
  constructor(readonly existingGenerationRunId: string) {
    super("idempotent replay");
  }
}
class TargetConflictSignal extends Error {
  constructor() {
    super("target conflict");
  }
}

function fail(code: CommitCompleteDraftErrorCode, message: string): CommitCompleteDraftFailure {
  return { ok: false, code, message };
}

/** Deterministic aggregate over the distinct per-assignment
 *  sourceProvenance.membershipSnapshotHash values present in the draft.
 *  CompleteDraftSchedule has no single top-level membership snapshot
 *  hash because one draft can span more than one rotation pool — this
 *  is the run-level equivalent, sorted+deduplicated for determinism. */
function aggregateMembershipSnapshotHash(assignments: DraftAssignment[]): string {
  const distinct = [...new Set(assignments.map((a) => a.sourceProvenance.membershipSnapshotHash))].sort();
  return sha256Canonical(distinct);
}

/** Deterministic aggregate over every assignment's own restated Phase 6
 *  facts — the run-level equivalent of a "provisional selection
 *  fingerprint", since CompleteDraftSchedule has no single top-level
 *  field for it (per-slot fingerprints exist upstream in Phase 6, not on
 *  the assembled draft). */
function aggregateProvisionalSelectionFingerprint(assignments: DraftAssignment[]): string {
  const facts = assignments
    .map((a) => ({
      slotKey: a.slotKey,
      candidateKey: a.candidateKey,
      selectionOrdinal: a.selectionOrdinal,
      provisionalRank: a.provisionalRank,
      origin: a.origin,
      strategyId: a.strategyId,
      strategyType: a.strategyType,
    }))
    .sort((a, b) => (a.slotKey === b.slotKey ? a.candidateKey.localeCompare(b.candidateKey) : a.slotKey.localeCompare(b.slotKey)));
  return sha256Canonical(facts);
}

/** Pure, DB-free checks: everything derivable from the draft object
 *  alone. No network I/O — always the first gate. */
function validateDraftStructurally(draft: CompleteDraftSchedule): CommitCompleteDraftFailure | null {
  if (draft.status !== "COMPLETE") {
    return fail("DRAFT_NOT_COMMIT_ELIGIBLE", "Taslak tamamlanmamış (status !== COMPLETE).");
  }
  if (!draft.isCommitEligible) {
    return fail("DRAFT_NOT_COMMIT_ELIGIBLE", "Taslak commit için uygun değil (isCommitEligible=false).");
  }
  if (draft.manifest.blockingDiagnosticCodes.length > 0) {
    return fail(
      "DRAFT_NOT_COMMIT_ELIGIBLE",
      "Taslakta engelleyici (blocking) tanı kodları var."
    );
  }

  const recomputed = computeCompleteDraftFingerprint({
    engineVersion: draft.engineVersion,
    selectionEngineVersion: draft.selectionEngineVersion,
    generationMode: draft.generationMode,
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    provenance: draft.provenance,
    days: draft.days,
    assignments: draft.assignments,
    counts: draft.counts,
    diagnostics: draft.diagnostics,
    status: draft.status,
    isCommitEligible: draft.isCommitEligible,
    sourceResultFingerprint: draft.manifest.sourceResultFingerprint,
  });
  if (recomputed !== draft.completeDraftFingerprint) {
    return fail(
      "DRAFT_FINGERPRINT_MISMATCH",
      "Taslak içeriği ile completeDraftFingerprint uyuşmuyor (olası bozulma)."
    );
  }
  if (draft.manifest.completeDraftFingerprint !== draft.completeDraftFingerprint) {
    return fail("DRAFT_MANIFEST_MISMATCH", "Manifest fingerprint alanı taslakla uyuşmuyor.");
  }
  if (
    draft.manifest.periodStart !== draft.periodStart ||
    draft.manifest.periodEnd !== draft.periodEnd ||
    draft.manifest.planVersionId !== draft.provenance.planVersionId ||
    draft.manifest.organizationId !== draft.provenance.organizationId ||
    draft.manifest.regionId !== draft.provenance.regionId
  ) {
    return fail("DRAFT_MANIFEST_MISMATCH", "Manifest, taslağın kendi kimlik/dönem bilgileriyle uyuşmuyor.");
  }
  if (
    draft.manifest.counts.totalAssignments !== draft.assignments.length ||
    draft.counts.totalAssignments !== draft.assignments.length
  ) {
    return fail("DRAFT_MANIFEST_MISMATCH", "Atama sayısı manifest/taslak arasında uyuşmuyor.");
  }
  const expectedKeys = [...draft.assignments.map((a) => a.draftAssignmentKey)].sort();
  const manifestKeys = [...draft.manifest.assignmentKeys].sort();
  if (
    expectedKeys.length !== manifestKeys.length ||
    expectedKeys.some((key, i) => key !== manifestKeys[i])
  ) {
    return fail("DRAFT_MANIFEST_MISMATCH", "Manifest atama anahtarları taslakla uyuşmuyor.");
  }

  const start = parseDateKey(draft.periodStart);
  const end = parseDateKey(draft.periodEnd);
  if (!start || !end || start > end) {
    return fail("DRAFT_MANIFEST_MISMATCH", "Dönem başlangıç/bitiş tarihleri geçersiz.");
  }
  // The persisted DutySchedule model is single-calendar-month
  // granularity (@@unique([year, month, regionId])) — a period this
  // commit service cannot map onto exactly one (year, month) is not yet
  // persistable under the current schema. Multi-month drafts remain a
  // future extension, not silently truncated here.
  if (start.getUTCFullYear() !== end.getUTCFullYear() || start.getUTCMonth() !== end.getUTCMonth()) {
    return fail(
      "DRAFT_MANIFEST_MISMATCH",
      "Taslak dönemi tek bir takvim ayına karşılık gelmiyor; bu commit servisi yalnızca tek aylık dönemleri destekliyor."
    );
  }

  return null;
}

function validateTenant(
  draft: CompleteDraftSchedule,
  organizationId: string,
  regionId: string
): CommitCompleteDraftFailure | null {
  if (draft.provenance.organizationId !== organizationId || draft.provenance.regionId !== regionId) {
    return fail(
      "DRAFT_TENANT_MISMATCH",
      "Taslağın organizasyon/bölge bilgisi, çağıranın oturum bağlamıyla uyuşmuyor."
    );
  }
  return null;
}

/** Read-only reference validation: confirms plan/version/pharmacies/
 *  memberships/pools/shifts referenced by the draft still exist and
 *  belong to the SAME tenant and plan version. Never mutates anything. */
async function validateReferences(
  draft: CompleteDraftSchedule,
  organizationId: string,
  regionId: string
): Promise<CommitCompleteDraftFailure | { ok: true; planId: string }> {
  const planVersion = await prisma.dutyPlanVersion.findUnique({
    where: { id: draft.provenance.planVersionId },
    include: { plan: true },
  });
  if (!planVersion) {
    return fail("DRAFT_REFERENCE_MISMATCH", "Plan versiyonu bulunamadı.");
  }
  if (planVersion.plan.organizationId !== organizationId || planVersion.plan.regionId !== regionId) {
    return fail("DRAFT_TENANT_MISMATCH", "Plan versiyonu, çağıranın organizasyon/bölgesine ait değil.");
  }

  const pharmacyIds = [...new Set(draft.assignments.map((a) => a.pharmacyId))];
  const membershipIds = [...new Set(draft.assignments.map((a) => a.membershipId))];
  const shiftIds = [...new Set(draft.assignments.map((a) => a.shiftId))];

  const [pharmacies, memberships, shifts] = await Promise.all([
    pharmacyIds.length > 0
      ? prisma.pharmacy.findMany({ where: { id: { in: pharmacyIds } }, select: { id: true, regionId: true } })
      : Promise.resolve([]),
    membershipIds.length > 0
      ? prisma.rotationPoolMembership.findMany({
          where: { id: { in: membershipIds } },
          select: { id: true, pool: { select: { organizationId: true, regionId: true } } },
        })
      : Promise.resolve([]),
    shiftIds.length > 0
      ? prisma.shiftDefinition.findMany({ where: { id: { in: shiftIds } }, select: { id: true, planVersionId: true } })
      : Promise.resolve([]),
  ]);

  if (pharmacies.length !== pharmacyIds.length || pharmacies.some((p) => p.regionId !== regionId)) {
    return fail("DRAFT_REFERENCE_MISMATCH", "Taslaktaki bir eczane referansı geçersiz veya başka bir bölgeye ait.");
  }
  if (
    memberships.length !== membershipIds.length ||
    memberships.some(
      (m) => m.pool.organizationId !== organizationId || (m.pool.regionId !== null && m.pool.regionId !== regionId)
    )
  ) {
    return fail(
      "DRAFT_REFERENCE_MISMATCH",
      "Taslaktaki bir rotasyon üyeliği referansı geçersiz veya başka bir organizasyon/bölgeye ait."
    );
  }
  if (
    shifts.length !== shiftIds.length ||
    shifts.some((s) => s.planVersionId !== draft.provenance.planVersionId)
  ) {
    return fail(
      "DRAFT_REFERENCE_MISMATCH",
      "Taslaktaki bir vardiya tanımı referansı geçersiz veya başka bir plan versiyonuna ait."
    );
  }

  return { ok: true, planId: planVersion.planId };
}

/**
 * Validates and atomically persists one Phase 7 CompleteDraftSchedule.
 * Never accepts a raw assignment array independent of the draft — the
 * ENTIRE input surface is the already-computed, self-consistent draft
 * object plus trusted tenant/actor context.
 */
export async function commitCompleteDraft(
  input: CommitCompleteDraftInput,
  testOnly: CommitCompleteDraftTestOnlyOptions = {}
): Promise<CommitCompleteDraftResult> {
  const { draft, organizationId, regionId, userId } = input;
  const writeAuditLogFn = testOnly.writeAuditLogFn ?? writeAuditLog;

  const structuralError = validateDraftStructurally(draft);
  if (structuralError) return structuralError;

  const tenantError = validateTenant(draft, organizationId, regionId);
  if (tenantError) return tenantError;

  const referenceResult = await validateReferences(draft, organizationId, regionId);
  if (referenceResult.ok === false) return referenceResult;
  const { planId } = referenceResult;

  const periodStartDate = parseDateKey(draft.periodStart)!;
  const periodEndDate = parseDateKey(draft.periodEnd)!;
  const year = periodStartDate.getUTCFullYear();
  const month = periodStartDate.getUTCMonth() + 1;

  // Fast pre-check outside the transaction (cheap, avoids opening a
  // transaction for the common "nothing to do" idempotent-replay case).
  // The SAME checks are re-run INSIDE the transaction below to close the
  // TOCTOU race window — this pre-check is an optimization only, never
  // the sole guarantee.
  const existingRun = await prisma.dutyGenerationRun.findUnique({
    where: { completeDraftFingerprint: draft.completeDraftFingerprint },
  });
  if (existingRun) {
    return buildIdempotentReplayResult(existingRun.id, draft);
  }
  const existingSchedule = await prisma.dutySchedule.findUnique({
    where: { year_month_regionId: { year, month, regionId } },
  });
  if (existingSchedule) {
    return fail(
      "DRAFT_TARGET_CONFLICT",
      "Bu bölge için seçilen dönemde farklı bir nöbet çizelgesi zaten mevcut."
    );
  }

  const membershipSnapshotHash = aggregateMembershipSnapshotHash(draft.assignments);
  const provisionalSelectionFingerprint = aggregateProvisionalSelectionFingerprint(draft.assignments);

  try {
    const created = await prisma.$transaction(
      async (tx) => {
        // 1. Re-check conflicting schedule/generation state, inside the
        // transaction, closing the pre-check's TOCTOU window.
        const raceRun = await tx.dutyGenerationRun.findUnique({
          where: { completeDraftFingerprint: draft.completeDraftFingerprint },
        });
        if (raceRun) throw new IdempotentReplaySignal(raceRun.id);

        const raceSchedule = await tx.dutySchedule.findUnique({
          where: { year_month_regionId: { year, month, regionId } },
        });
        if (raceSchedule) throw new TargetConflictSignal();

        // 2. Create the DutySchedule (status DRAFT — never PUBLISHED).
        const schedule = await tx.dutySchedule.create({
          data: {
            year,
            month,
            regionId,
            status: "DRAFT",
            planVersionId: draft.provenance.planVersionId,
          },
        });
        if (testOnly.failAfterStep === "SCHEDULE_CREATED") {
          throw new CommitRollbackTestError("SCHEDULE_CREATED");
        }

        // 3. Create the generation-run provenance record.
        const generationRun = await tx.dutyGenerationRun.create({
          data: {
            status: "COMMITTED",
            organizationId,
            regionId,
            planId,
            planVersionId: draft.provenance.planVersionId,
            dutyScheduleId: schedule.id,
            generationMode: draft.generationMode,
            periodStart: periodStartDate,
            periodEnd: periodEndDate,
            configurationFingerprint: draft.provenance.configurationFingerprint,
            runtimeInputHash: draft.provenance.runtimeInputHash,
            ruleSetFingerprint: draft.provenance.ruleSetFingerprint,
            strategySetFingerprint: draft.provenance.strategySetFingerprint,
            upstreamResultFingerprint: draft.manifest.sourceResultFingerprint,
            membershipSnapshotHash,
            provisionalSelectionFingerprint,
            completeDraftFingerprint: draft.completeDraftFingerprint,
            engineVersion: draft.engineVersion,
            selectionEngineVersion: draft.selectionEngineVersion,
            draftEngineVersion: DRAFT_ENGINE_VERSION,
            manifest: draft.manifest as unknown as Prisma.InputJsonValue,
          },
        });
        if (testOnly.failAfterStep === "GENERATION_RUN_CREATED") {
          throw new CommitRollbackTestError("GENERATION_RUN_CREATED");
        }

        // 4. Create every DutyAssignment row, in Phase 7's own
        // deterministic order (draft.assignments is already sorted
        // draftAssignmentKey ASC). Individual creates (not createMany)
        // so a test can force a genuine PARTIAL-insertion failure at an
        // exact row boundary — createMany is one indivisible statement
        // and cannot be interrupted mid-batch.
        const partialFailureIndex =
          testOnly.failAfterStep === "PARTIAL_ASSIGNMENTS" ? Math.ceil(draft.assignments.length / 2) : -1;
        for (let i = 0; i < draft.assignments.length; i++) {
          const a = draft.assignments[i];
          await tx.dutyAssignment.create({
            data: {
              dutyScheduleId: schedule.id,
              date: parseDateKey(a.date)!,
              weight: a.dutyWeight,
              isManual: false,
              pharmacyId: a.pharmacyId,
              shiftDefinitionId: a.shiftId,
              slotKey: a.slotKey,
              draftAssignmentKey: a.draftAssignmentKey,
              membershipId: a.membershipId,
              selectionOrdinal: a.selectionOrdinal,
              origin: a.origin,
              strategyId: a.strategyId,
              strategyType: a.strategyType,
              fallbackUsed: a.fallbackUsed,
              selectedRank: a.provisionalRank,
              decisiveCriterion: a.decisiveComparatorCriterion,
              generationRunId: generationRun.id,
            },
          });
          if (i + 1 === partialFailureIndex) {
            throw new CommitRollbackTestError("PARTIAL_ASSIGNMENTS");
          }
        }

        // 5. Audit log entry, in the same transaction — if this write
        // fails, everything above rolls back too (see writeAuditLog's
        // own header comment).
        await writeAuditLogFn(tx, {
          organizationId,
          userId,
          action: "CREATE",
          entity: "DutySchedule",
          entityId: schedule.id,
          after: {
            status: "DRAFT",
            generationRunId: generationRun.id,
            completeDraftFingerprint: draft.completeDraftFingerprint,
            assignmentCount: draft.assignments.length,
          },
        });

        // 6. Typed commit result.
        const result: CommitCompleteDraftSuccess = {
          ok: true,
          outcome: "CREATED",
          dutyScheduleId: schedule.id,
          generationRunId: generationRun.id,
          assignmentCount: draft.assignments.length,
          completeDraftFingerprint: draft.completeDraftFingerprint,
          scheduleStatus: "DRAFT",
          periodStart: draft.periodStart,
          periodEnd: draft.periodEnd,
        };
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return created;
  } catch (error) {
    if (error instanceof IdempotentReplaySignal) {
      return buildIdempotentReplayResult(error.existingGenerationRunId, draft);
    }
    if (error instanceof TargetConflictSignal) {
      return fail(
        "DRAFT_TARGET_CONFLICT",
        "Bu bölge için seçilen dönemde farklı bir nöbet çizelgesi zaten mevcut."
      );
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = (error.meta?.target as string[] | undefined) ?? [];
      if (target.some((t) => t.includes("completeDraftFingerprint"))) {
        const winner = await prisma.dutyGenerationRun.findUnique({
          where: { completeDraftFingerprint: draft.completeDraftFingerprint },
        });
        if (winner) return buildIdempotentReplayResult(winner.id, draft);
        return fail("DRAFT_ALREADY_COMMITTED", "Taslak zaten commit edilmiş ancak kayıt yeniden bulunamadı.");
      }
      if (target.some((t) => t === "year" || t === "month" || t === "regionId")) {
        return fail(
          "DRAFT_TARGET_CONFLICT",
          "Bu bölge için seçilen dönemde farklı bir nöbet çizelgesi zaten mevcut."
        );
      }
      logger.error("duty_generation_run_commit_failed", { organizationId, regionId, reason: "unexpected_unique_violation" }, error);
      return fail("DRAFT_TRANSACTION_FAILED", "Taslak kaydedilirken beklenmeyen bir veritabanı çakışması oluştu.");
    }
    // Serializable isolation (set above) can abort the LOSING side of a
    // genuine concurrent race with a write-conflict/deadlock error
    // (P2034) INSTEAD OF a unique-constraint violation, depending on
    // exact statement interleaving. Reclassified with the identical
    // re-query logic as the P2002 branch above: re-check which target
    // state actually won, never guess from the error alone.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      const winner = await prisma.dutyGenerationRun.findUnique({
        where: { completeDraftFingerprint: draft.completeDraftFingerprint },
      });
      if (winner) return buildIdempotentReplayResult(winner.id, draft);
      const targetSchedule = await prisma.dutySchedule.findUnique({
        where: { year_month_regionId: { year, month, regionId } },
      });
      if (targetSchedule) {
        return fail(
          "DRAFT_TARGET_CONFLICT",
          "Bu bölge için seçilen dönemde farklı bir nöbet çizelgesi zaten mevcut."
        );
      }
      logger.error("duty_generation_run_commit_failed", { organizationId, regionId, reason: "serialization_conflict_no_winner_found" }, error);
      return fail("DRAFT_TRANSACTION_FAILED", "Taslak kaydedilirken bir eşzamanlılık çakışması oluştu.");
    }
    if (error instanceof CommitRollbackTestError) {
      // Test-only forced failure — proves the rollback boundary, never
      // reachable in production since failAfterStep is never set there.
      return fail("DRAFT_TRANSACTION_FAILED", error.message);
    }
    logger.error("duty_generation_run_commit_failed", { organizationId, regionId, reason: "unexpected_error" }, error);
    return fail("DRAFT_TRANSACTION_FAILED", "Taslak kaydedilirken beklenmeyen bir hata oluştu.");
  }
}

async function buildIdempotentReplayResult(
  generationRunId: string,
  draft: CompleteDraftSchedule
): Promise<CommitCompleteDraftResult> {
  const run = await prisma.dutyGenerationRun.findUnique({
    where: { id: generationRunId },
    include: { _count: { select: { assignments: true } } },
  });
  if (!run) {
    return fail("DRAFT_ALREADY_COMMITTED", "Taslak zaten commit edilmiş ancak kayıt bulunamadı.");
  }
  return {
    ok: true,
    outcome: "IDEMPOTENT_REPLAY",
    dutyScheduleId: run.dutyScheduleId,
    generationRunId: run.id,
    assignmentCount: run._count.assignments,
    completeDraftFingerprint: run.completeDraftFingerprint,
    scheduleStatus: "DRAFT",
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
  };
}
