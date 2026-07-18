// Duty Rules V2 — Phase 11: activation-readiness check.
//
// Wraps loadDutyPlanVersion (Phase 3, read-only, never modified by this
// phase) and classifies its .diagnostics into BLOCKING vs ADVISORY, plus
// one Phase-11-specific structural check the loader itself doesn't
// perform (zero served day types). Used BOTH by activatePlanVersion (to
// refuse activation) and by the version-editor UI (to show live "kalan
// sorunlar" before the admin even attempts activation) — see
// activate-plan-version.ts.
//
// BLOCKING vs ADVISORY classification and reasoning, one line per code:
//   REGION_INACTIVE              BLOCKING — an inactive region can never
//                                 legitimately generate a schedule; there
//                                 is no sane world where activating a plan
//                                 for a dead region is intentional.
//   SERVED_DAY_TYPE_WITHOUT_SLOTS BLOCKING — a day type marked "served"
//                                 with zero SlotRequirement rows can never
//                                 produce an assignment on that day type;
//                                 this is a genuine configuration gap, not
//                                 a stylistic choice.
//   SLOT_WITHOUT_POOL            BLOCKING — a slot with rotationPoolId
//                                 null has no eligible candidates at all
//                                 (the loader documents null as "default
//                                 pool semantics" but no such default
//                                 exists yet in this phase) — generation
//                                 would fail outright.
//   POOL_EMPTY_AS_OF_EFFECTIVE_DATE ADVISORY — a pool can legitimately be
//                                 populated AFTER activation but before
//                                 the version's validFrom actually arrives
//                                 (e.g. staff plan ahead of pharmacies
//                                 joining); blocking here would make
//                                 forward planning impossible.
//   SLOT_ON_UNSERVED_DAY_TYPE    ADVISORY — a harmless orphaned
//                                 configuration row (the day type simply
//                                 never generates); surfaced so the admin
//                                 can clean it up, but it causes no
//                                 incorrect scheduling behavior.
//   EFFECTIVE_DATE_OUTSIDE_VALIDITY ADVISORY — this diagnostic only fires
//                                 when the CALLER passes an effectiveDate
//                                 outside [validFrom, validTo]; since this
//                                 check always evaluates at the version's
//                                 OWN validFrom, it is expected to occur
//                                 only for a version whose own validTo is
//                                 already in the past — a real but non-
//                                 fatal historical/retiring-soon signal.

import { loadDutyPlanVersion } from "../load-duty-plan-version";
import { DutyPlanLoaderError } from "../errors";
import { prisma } from "@/lib/prisma";
import type { LoaderDiagnostic, LoaderDiagnosticCode } from "../domain/loaded-plan";

const BLOCKING_CODES: ReadonlySet<LoaderDiagnosticCode> = new Set([
  "REGION_INACTIVE",
  "SERVED_DAY_TYPE_WITHOUT_SLOTS",
  "SLOT_WITHOUT_POOL",
]);

const ADVISORY_CODES: ReadonlySet<LoaderDiagnosticCode> = new Set([
  "POOL_EMPTY_AS_OF_EFFECTIVE_DATE",
  "SLOT_ON_UNSERVED_DAY_TYPE",
  "EFFECTIVE_DATE_OUTSIDE_VALIDITY",
]);

export type ActivationIssue = {
  code: LoaderDiagnosticCode | "NO_SERVED_DAY_TYPES" | "LOADER_ERROR";
  subjectId: string;
};

export type CheckPlanVersionActivationReadinessInput = {
  organizationId: string;
  regionId: string;
  versionId: string;
};

export type CheckPlanVersionActivationReadinessSuccess = {
  ok: true;
  advisoryIssues: ActivationIssue[];
};

export type CheckPlanVersionActivationReadinessFailure = {
  ok: false;
  blockingIssues: ActivationIssue[];
  advisoryIssues: ActivationIssue[];
};

export type CheckPlanVersionActivationReadinessResult =
  | CheckPlanVersionActivationReadinessSuccess
  | CheckPlanVersionActivationReadinessFailure;

export async function checkPlanVersionActivationReadiness(
  input: CheckPlanVersionActivationReadinessInput
): Promise<CheckPlanVersionActivationReadinessResult> {
  const { organizationId, regionId, versionId } = input;

  const version = await prisma.dutyPlanVersion.findFirst({
    where: { id: versionId, plan: { organizationId, regionId } },
    select: { validFrom: true },
  });
  if (!version) {
    return {
      ok: false,
      blockingIssues: [{ code: "LOADER_ERROR", subjectId: versionId }],
      advisoryIssues: [],
    };
  }
  const effectiveDate = version.validFrom.toISOString().slice(0, 10);

  let diagnostics: LoaderDiagnostic[];
  try {
    const loaded = await loadDutyPlanVersion({
      organizationId,
      regionId,
      planVersionId: versionId,
      effectiveDate,
    });
    diagnostics = loaded.diagnostics;
  } catch (error) {
    if (error instanceof DutyPlanLoaderError) {
      // A structural/tenant-integrity failure from the loader itself is
      // treated as one blocking issue per underlying loader issue — the
      // loader's own issues already carry subjectId/code semantics close
      // enough to LoaderDiagnosticCode for display purposes.
      return {
        ok: false,
        blockingIssues: error.issues.map((issue) => ({
          code: "LOADER_ERROR" as const,
          subjectId: issue.subjectId,
        })),
        advisoryIssues: [],
      };
    }
    throw error;
  }

  const blockingIssues: ActivationIssue[] = diagnostics
    .filter((d) => BLOCKING_CODES.has(d.code))
    .map((d) => ({ code: d.code, subjectId: d.subjectId }));
  const advisoryIssues: ActivationIssue[] = diagnostics
    .filter((d) => ADVISORY_CODES.has(d.code))
    .map((d) => ({ code: d.code, subjectId: d.subjectId }));

  // Phase-11-specific structural check the loader doesn't perform: a
  // version with zero isServed:true day-type rules would never schedule
  // anything at all — a genuinely empty, meaningless plan.
  const servedCount = await prisma.dayTypeRule.count({
    where: { planVersionId: versionId, isServed: true },
  });
  if (servedCount === 0) {
    blockingIssues.push({ code: "NO_SERVED_DAY_TYPES", subjectId: versionId });
  }

  if (blockingIssues.length > 0) {
    return { ok: false, blockingIssues, advisoryIssues };
  }
  return { ok: true, advisoryIssues };
}
