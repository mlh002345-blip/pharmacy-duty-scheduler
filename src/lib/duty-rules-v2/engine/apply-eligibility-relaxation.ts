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
  relaxedConstraintCodes: ("MIN_DAYS_BETWEEN_DUTIES")[];
  diagnostics: EngineDiagnostic[];
};

export function applyEligibilityRelaxation(context: {
  slotKey: string;
  date: string;
  requiredCount: number;
  eligibilityResults: CandidateEligibilityResult[];
  relaxMinIntervalWhenInsufficient: boolean;
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
      relaxedEligible = context.eligibilityResults
        .filter(
          (result) =>
            !result.eligible &&
            result.hardExclusionReasons.length === 1 &&
            result.hardExclusionReasons[0] === "MIN_DAYS_INTERVAL"
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
