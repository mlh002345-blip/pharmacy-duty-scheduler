// Duty Rules V2 — Phase 6, Phase 7: candidate-set resolution.
//
// Resolves WHICH candidate keys the strategy engine may rank, sourced
// EXCLUSIVELY from the already-computed Phase 4 relaxation result — this
// module never re-evaluates eligibility, never re-derives HARD/SOFT
// outcomes, and can never resurrect a hard-excluded candidate (a
// candidate absent from both strictEligible and relaxedEligible simply
// cannot appear in the returned map).
//
// Policy: use strictEligible alone when it already meets requiredCount;
// otherwise, if relaxation was applied, use strictEligible ∪
// relaxedEligible. If relaxation was NOT applied (or applied but still
// insufficient), the candidate set may legitimately be smaller than
// requiredCount — that underfill is surfaced later, never hidden here.

import type { SelectionInput } from "../engine/build-selection-input";

export function resolveCandidateSet(
  selectionInput: SelectionInput
): Map<string, "STRICT" | "RELAXED"> {
  const { strictEligible, relaxedEligible, relaxationApplied } = selectionInput.relaxation;
  const origin = new Map<string, "STRICT" | "RELAXED">();

  for (const key of strictEligible) origin.set(key, "STRICT");

  const sufficient = strictEligible.length >= selectionInput.requiredCount;
  if (!sufficient && relaxationApplied) {
    for (const key of relaxedEligible) {
      if (!origin.has(key)) origin.set(key, "RELAXED");
    }
  }

  return origin;
}
