// Duty Rules V2 engine — Stage 10: the LIMITED interval relaxation policy.
//
// V1's exact semantics (generate-duty-schedule.ts:266-269), preserved
// verbatim and NOT generalized:
//   - strict eligibility is evaluated first;
//   - ONLY when strictly-eligible candidates cannot fill requiredCount is
//     the minimum-day interval relaxed;
//   - ONLY MIN_DAYS_BETWEEN_DUTIES is ever relaxed — inactive,
//     non-member, unavailable, blocking-request, and duplicate-assignment
//     exclusions are never touched.
// A candidate is "relax-admissible" iff its ONLY hard failure is the
// interval — exactly V1's availableToday fallback set.

import type { EngineDiagnostic } from "./domain/diagnostics";
import type { CandidateEligibilityResult } from "./evaluate-eligibility";

export type EligibilityRelaxationResult = {
  slotKey: string;
  date: string;
  requiredCount: number;
  /** Candidate keys, deterministically ordered (input order preserved —
   *  candidates are already sorted by candidateKey). */
  strictEligible: string[];
  /** Additional candidates admitted by relaxation (empty when none). */
  relaxedEligible: string[];
  relaxationApplied: boolean;
  /** "MIN_DAYS_BETWEEN_DUTIES" and, in Phase 5, the violation codes of
   *  catalogue rules whose entry AND configuration declare relaxability
   *  (currently only the V1_MIN_INTERVAL mode exists). */
  relaxedConstraintCodes: string[];
  diagnostics: EngineDiagnostic[];
};

/** The Phase 4 default: only the built-in V1 interval reason relaxes. */
export const DEFAULT_RELAXABLE_REASONS: readonly string[] = ["MIN_DAYS_INTERVAL"];

export function applyEligibilityRelaxation(context: {
  slotKey: string;
  date: string;
  requiredCount: number;
  eligibilityResults: CandidateEligibilityResult[];
  relaxMinIntervalWhenInsufficient: boolean;
  /** Reasons admissible for relaxation. Defaults to the V1 interval
   *  reason only; Phase 5 adds catalogue-declared relaxable rule
   *  violation codes (never inactive/unavailable/blocking/exclusions). */
  relaxableReasonCodes?: readonly string[];
}): EligibilityRelaxationResult {
  const diagnostics: EngineDiagnostic[] = [];
  const strictEligible = context.eligibilityResults
    .filter((result) => result.eligible)
    .map((result) => result.candidateKey);

  let relaxedEligible: string[] = [];
  let relaxationApplied = false;

  if (strictEligible.length < context.requiredCount) {
    diagnostics.push({
      code: "INSUFFICIENT_STRICT_CANDIDATES",
      date: context.date,
      subjectKey: context.slotKey,
    });
    if (context.relaxMinIntervalWhenInsufficient) {
      const relaxable = new Set(context.relaxableReasonCodes ?? DEFAULT_RELAXABLE_REASONS);
      // Relax-admissible iff EVERY hard failure is a relaxable interval
      // reason — a candidate that also fails any non-relaxable rule
      // (inactive, unavailable, blocking, exclusion, …) stays out.
      relaxedEligible = context.eligibilityResults
        .filter(
          (result) =>
            !result.eligible &&
            result.hardExclusionReasons.length > 0 &&
            result.hardExclusionReasons.every((reason) => relaxable.has(reason))
        )
        .map((result) => result.candidateKey);
      if (relaxedEligible.length > 0) {
        relaxationApplied = true;
        diagnostics.push({
          code: "MIN_INTERVAL_RELAXED",
          date: context.date,
          subjectKey: context.slotKey,
        });
      }
    }
    if (strictEligible.length + relaxedEligible.length < context.requiredCount) {
      diagnostics.push({
        code: "INSUFFICIENT_CANDIDATES_AFTER_RELAXATION",
        date: context.date,
        subjectKey: context.slotKey,
      });
    }
  }

  return {
    slotKey: context.slotKey,
    date: context.date,
    requiredCount: context.requiredCount,
    strictEligible,
    relaxedEligible,
    relaxationApplied,
    relaxedConstraintCodes: relaxationApplied ? ["MIN_DAYS_BETWEEN_DUTIES"] : [],
    diagnostics,
  };
}
