// Duty Rules V2 — Phase 11: the concurrency-safe DRAFT -> ACTIVE
// transition. Mirrors Phase 8/9's transaction idiom exactly (see
// commit-complete-draft.ts / approve-generated-draft.ts /
// publish-approved-schedule.ts, read but never imported from) without
// importing anything from those modules.
//
// "Only one plan VERSION may be ACTIVE for a region over an overlapping
// effective period" (see prisma/schema.prisma's DutyPlanVersion comment)
// is enforced here at the SERVICE layer: every OTHER ACTIVE version for
// the SAME region — across ALL plans for that region, not just the same
// plan — is retired inside the same transaction that activates the
// target version.

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import {
  checkPlanVersionActivationReadiness,
  type ActivationIssue,
} from "./validate-plan-version-completeness";

export type ActivatePlanVersionInput = {
  organizationId: string;
  regionId: string;
  planVersionId: string;
  userId: string;
};

export type ActivatePlanVersionOutcome = "ACTIVATED" | "IDEMPOTENT_REPLAY";

export type ActivatePlanVersionSuccess = {
  ok: true;
  outcome: ActivatePlanVersionOutcome;
  planVersionId: string;
  retiredVersionIds: string[];
};

export type ActivatePlanVersionErrorCode =
  | "VERSION_NOT_FOUND"
  | "NOT_DRAFT"
  | "NOT_READY"
  | "ACTIVATION_TRANSACTION_FAILED";

export type ActivatePlanVersionFailure = {
  ok: false;
  code: ActivatePlanVersionErrorCode;
  message: string;
  blockingIssues?: ActivationIssue[];
};

export type ActivatePlanVersionResult = ActivatePlanVersionSuccess | ActivatePlanVersionFailure;

function fail(code: ActivatePlanVersionErrorCode, message: string, blockingIssues?: ActivationIssue[]): ActivatePlanVersionFailure {
  return { ok: false, code, message, blockingIssues };
}

class ActivationIdempotentReplaySignal extends Error {
  constructor() {
    super("idempotent replay");
  }
}

// P2034 under Serializable isolation means "the LOSING side of a genuine
// concurrent conflict" — unlike Phase 8/9's idempotent-replay scenarios
// (where the conflict is always the SAME logical write happening twice,
// so re-querying the winner's already-committed result is sufficient),
// activating two DIFFERENT DRAFT versions for the SAME region is a
// legitimate, expected-to-happen race between two distinct writes
// neither of which is a duplicate of the other. A loser here has done NO
// work that could be recovered by re-querying — its own transaction
// never committed anything — so the correct behavior is to retry the
// WHOLE operation from scratch (bounded), not merely reclassify the
// error. This is a deliberate, documented deviation from the Phase 8/9
// precedent for exactly this reason.
const MAX_ACTIVATION_ATTEMPTS = 5;

export async function activatePlanVersion(
  input: ActivatePlanVersionInput
): Promise<ActivatePlanVersionResult> {
  let lastResult: ActivatePlanVersionResult = fail(
    "ACTIVATION_TRANSACTION_FAILED",
    "Etkinleştirme sırasında bir eşzamanlılık çakışması oluştu."
  );
  for (let attempt = 0; attempt < MAX_ACTIVATION_ATTEMPTS; attempt++) {
    const result = await attemptActivatePlanVersion(input);
    if (result.ok || result.code !== "ACTIVATION_TRANSACTION_FAILED") {
      return result;
    }
    lastResult = result;
  }
  return lastResult;
}

async function attemptActivatePlanVersion(
  input: ActivatePlanVersionInput
): Promise<ActivatePlanVersionResult> {
  const { organizationId, regionId, planVersionId, userId } = input;

  const version = await prisma.dutyPlanVersion.findFirst({
    where: { id: planVersionId, plan: { organizationId, regionId } },
    select: { id: true, status: true, validFrom: true },
  });
  if (!version) {
    return fail("VERSION_NOT_FOUND", "Plan sürümü bulunamadı.");
  }
  if (version.status === "ACTIVE") {
    // Idempotent-friendly: activating an already-ACTIVE version is a
    // successful no-op, never an error — mirrors Phase 8/9's own
    // IDEMPOTENT_REPLAY outcome convention.
    return { ok: true, outcome: "IDEMPOTENT_REPLAY", planVersionId, retiredVersionIds: [] };
  }
  if (version.status !== "DRAFT") {
    return fail("NOT_DRAFT", "Yalnızca DRAFT durumundaki bir sürüm etkinleştirilebilir.");
  }

  const readiness = await checkPlanVersionActivationReadiness({ organizationId, regionId, versionId: planVersionId });
  if (!readiness.ok) {
    return fail(
      "NOT_READY",
      "Bu sürüm etkinleştirme için hazır değil: çözülmesi gereken engelleyici sorunlar var.",
      readiness.blockingIssues
    );
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // Conditional DRAFT -> ACTIVE update: only the request whose
        // WHERE clause still matches status: DRAFT at UPDATE time affects
        // a row, so two concurrent activations of the SAME version can
        // never both "win" (mirrors approve-generated-draft.ts's exact
        // updateMany + count-check idiom).
        const activated = await tx.dutyPlanVersion.updateMany({
          where: { id: planVersionId, status: "DRAFT" },
          data: { status: "ACTIVE", activatedAt: new Date() },
        });
        if (activated.count !== 1) {
          throw new ActivationIdempotentReplaySignal();
        }

        // Retire every OTHER ACTIVE version for the SAME region (across
        // all plans for that region — schema comment says "for a
        // region", not "per plan").
        const others = await tx.dutyPlanVersion.findMany({
          where: {
            id: { not: planVersionId },
            status: "ACTIVE",
            plan: { regionId },
          },
          select: { id: true, validTo: true },
        });

        const newValidTo = new Date(version.validFrom);
        newValidTo.setUTCDate(newValidTo.getUTCDate() - 1);

        const retiredVersionIds: string[] = [];
        for (const other of others) {
          // Never widen an existing validTo, only narrow it to end right
          // before the new version begins.
          const nextValidTo =
            other.validTo === null || other.validTo > newValidTo ? newValidTo : other.validTo;
          await tx.dutyPlanVersion.update({
            where: { id: other.id },
            data: { status: "RETIRED", retiredAt: new Date(), validTo: nextValidTo },
          });
          retiredVersionIds.push(other.id);
        }

        await writeAuditLog(tx, {
          organizationId,
          userId,
          action: "UPDATE",
          entity: "DutyPlanVersion",
          entityId: planVersionId,
          before: { status: "DRAFT" },
          after: { status: "ACTIVE", retiredVersionIds },
        });

        const success: ActivatePlanVersionSuccess = {
          ok: true,
          outcome: "ACTIVATED",
          planVersionId,
          retiredVersionIds,
        };
        return success;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    return result;
  } catch (error) {
    if (error instanceof ActivationIdempotentReplaySignal) {
      const fresh = await prisma.dutyPlanVersion.findUnique({
        where: { id: planVersionId },
        select: { status: true },
      });
      if (fresh?.status === "ACTIVE") {
        return { ok: true, outcome: "IDEMPOTENT_REPLAY", planVersionId, retiredVersionIds: [] };
      }
      return fail("ACTIVATION_TRANSACTION_FAILED", "Etkinleştirme eşzamanlılık çakışmasından sonra yeniden doğrulanamadı.");
    }
    // Serializable isolation can abort the LOSING side of a genuine
    // concurrent race with a write-conflict error (P2034) instead of
    // reaching the updateMany count check — reclassified the same way
    // Phase 8/9 reclassify P2034: re-query, never guess from the error alone.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      const fresh = await prisma.dutyPlanVersion.findUnique({
        where: { id: planVersionId },
        select: { status: true },
      });
      if (fresh?.status === "ACTIVE") {
        return { ok: true, outcome: "IDEMPOTENT_REPLAY", planVersionId, retiredVersionIds: [] };
      }
      return fail("ACTIVATION_TRANSACTION_FAILED", "Etkinleştirme sırasında bir eşzamanlılık çakışması oluştu.");
    }
    throw error;
  }
}
