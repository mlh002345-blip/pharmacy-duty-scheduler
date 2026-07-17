// Duty Rules V2 — Phase 6: stable selection diagnostic/error catalogues.

export const SELECTION_DIAGNOSTIC_CODES = [
  "STRATEGY_NOT_FOUND",
  "STRATEGY_EQUAL_PRECEDENCE_CONFLICT",
  "STRATEGY_UNRESOLVED",
  "FALLBACK_USED",
  "FALLBACK_UNKNOWN_TARGET",
  "FALLBACK_DISABLED_TARGET",
  "FALLBACK_CYCLE_DETECTED",
  "UNDERFILLED_SELECTION",
  "NO_ELIGIBLE_CANDIDATES",
  /** Phase 6 corrective: a pharmacy reachable through more than one
   *  membership/pool would have occupied more than one seat in the SAME
   *  slot; only the highest-ranked occurrence was kept. */
  "PROVISIONAL_SAME_SLOT_DUPLICATE",
  /** Phase 6 corrective: a pharmacy already provisionally selected
   *  earlier THIS RUN on the same calendar date was excluded from a
   *  later same-date slot because sameDaySecondAssignmentAllowed is
   *  false. */
  "PROVISIONAL_SAME_DAY_ASSIGNMENT_CONFLICT",
  /** Sequential-relaxation-contract corrective: accumulator-adjusted
   *  strict count fell below requiredCount for this slot, and at least
   *  one candidate was admitted into the relaxed pool solely because
   *  this module independently re-derived relax-admissibility from
   *  Phase 4/5's own static eligibility facts — a candidate Phase 4's
   *  own static (pre-sequential) evaluation never placed in
   *  relaxedEligible. subjectKey encodes
   *  "{slotKey}#required={n}#strict={n}#relaxed={n}" — no pharmacy or
   *  tenant display name. */
  "SEQUENTIAL_RELAXATION_APPLIED",
] as const;
export type SelectionDiagnosticCode = (typeof SELECTION_DIAGNOSTIC_CODES)[number];

export type SelectionDiagnostic = {
  code: SelectionDiagnosticCode;
  date: string;
  subjectKey: string;
};

export function sortSelectionDiagnostics(
  diagnostics: SelectionDiagnostic[]
): SelectionDiagnostic[] {
  return [...diagnostics].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.subjectKey < b.subjectKey ? -1 : a.subjectKey > b.subjectKey ? 1 : 0;
  });
}
