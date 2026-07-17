// Duty Rules V2 — Phase 7: stable Complete Draft Schedule diagnostic
// catalogue. Codes are the program-level contract; free text belongs to
// a later presentation layer and is never used as logic here.

export const DRAFT_DIAGNOSTIC_CODES = [
  /** A resolvable slot carries no pool reference at the ResolvedSlot
   *  stage — mirrors Phase 4's SLOT_WITHOUT_POOL, restated at draft
   *  level so the whole schedule can be judged from this artifact alone. */
  "DRAFT_SLOT_WITHOUT_POOL",
  /** A resolvable slot with requiredCount > 0 has no provisional
   *  selection at all (no strategy configured, or the strategy
   *  resolution failed) — the slot carries zero assignments. */
  "DRAFT_SLOT_UNRESOLVED_NO_STRATEGY",
  /** A slot received fewer assignments than requiredCount. */
  "DRAFT_SLOT_UNDERFILLED",
  /** An assignment's slotKey does not match any slot in this draft. */
  "DRAFT_ASSIGNMENT_REFERENCES_UNKNOWN_SLOT",
  /** A provisional selection's selectedCandidateKeys entry has no
   *  matching ranking, so no assignment fact could be assembled for it. */
  "DRAFT_ASSIGNMENT_REFERENCES_UNKNOWN_CANDIDATE",
  /** A slot assembled more assignments than its requiredCount allows. */
  "DRAFT_ASSIGNMENT_COUNT_EXCEEDS_REQUIRED",
  /** The number of assignments assembled for a slot does not match the
   *  number of selectedCandidateKeys reported by Phase 6. */
  "DRAFT_ASSIGNMENT_COUNT_MISMATCH_SELECTION",
  /** Two assignments in the whole draft share an assignmentKey. */
  "DRAFT_DUPLICATE_ASSIGNMENT_KEY",
  /** The same pharmacyId occupies more than one seat in one slot. */
  "DRAFT_SAME_SLOT_DUPLICATE_PHARMACY",
  /** The same pharmacyId holds assignments on more than one slot of the
   *  same calendar date while same-day second assignments are not
   *  permitted by policy. */
  "DRAFT_SAME_DAY_PHARMACY_CONFLICT",
  /** An assignment's candidateKey is not present in the source slot's
   *  strict or relaxed eligible sets (Phase 4/5's own determination). */
  "DRAFT_CANDIDATE_NOT_IN_STRICT_OR_RELAXED",
  /** A slot's selectionOrdinal sequence is not the contiguous 1..N run
   *  implied by its assignment count. */
  "DRAFT_SELECTION_ORDINAL_GAP",
  /** An assignment's date does not match its own slot's date. */
  "DRAFT_SLOT_DATE_MISMATCH",
  /** A slotKey does not follow the mandatory
   *  "{date}:{dayTypeKey}:{shiftKey}:{sortOrder}" shape. */
  "DRAFT_SLOT_KEY_FORMAT_INVALID",
  /** A slot carries assignments but no strategyId/strategyType was
   *  recorded for the provisional selection that produced them. */
  "DRAFT_STRATEGY_MISSING_FOR_SELECTED_SLOT",
  /** Selected assignments are not in non-decreasing provisionalRank
   *  order — ranking is not being preserved by assembly. */
  "DRAFT_RANK_NOT_MONOTONIC",
  /** Informational: this assignment was produced via a fallback
   *  strategy rather than the slot's primary strategy. */
  "DRAFT_FALLBACK_USED_ON_ASSIGNMENT",
  /** An assignment or slot date falls outside [periodStart, periodEnd]. */
  "DRAFT_PERIOD_BOUNDARY_VIOLATION",
  /** An assignment's pharmacyId is not present among the source
   *  selection input's own candidate facts for that slot. */
  "DRAFT_UNKNOWN_PHARMACY_REFERENCE",
] as const;
export type DraftDiagnosticCode = (typeof DRAFT_DIAGNOSTIC_CODES)[number];

export const DRAFT_DIAGNOSTIC_SEVERITY: Readonly<Record<DraftDiagnosticCode, "ERROR" | "WARNING" | "INFO">> = {
  DRAFT_SLOT_WITHOUT_POOL: "INFO",
  DRAFT_SLOT_UNRESOLVED_NO_STRATEGY: "WARNING",
  DRAFT_SLOT_UNDERFILLED: "WARNING",
  DRAFT_ASSIGNMENT_REFERENCES_UNKNOWN_SLOT: "ERROR",
  DRAFT_ASSIGNMENT_REFERENCES_UNKNOWN_CANDIDATE: "ERROR",
  DRAFT_ASSIGNMENT_COUNT_EXCEEDS_REQUIRED: "ERROR",
  DRAFT_ASSIGNMENT_COUNT_MISMATCH_SELECTION: "ERROR",
  DRAFT_DUPLICATE_ASSIGNMENT_KEY: "ERROR",
  DRAFT_SAME_SLOT_DUPLICATE_PHARMACY: "ERROR",
  DRAFT_SAME_DAY_PHARMACY_CONFLICT: "ERROR",
  DRAFT_CANDIDATE_NOT_IN_STRICT_OR_RELAXED: "ERROR",
  DRAFT_SELECTION_ORDINAL_GAP: "WARNING",
  DRAFT_SLOT_DATE_MISMATCH: "ERROR",
  DRAFT_SLOT_KEY_FORMAT_INVALID: "ERROR",
  DRAFT_STRATEGY_MISSING_FOR_SELECTED_SLOT: "ERROR",
  DRAFT_RANK_NOT_MONOTONIC: "WARNING",
  DRAFT_FALLBACK_USED_ON_ASSIGNMENT: "INFO",
  DRAFT_PERIOD_BOUNDARY_VIOLATION: "ERROR",
  DRAFT_UNKNOWN_PHARMACY_REFERENCE: "ERROR",
};

export type DraftDiagnostic = {
  code: DraftDiagnosticCode;
  severity: "ERROR" | "WARNING" | "INFO";
  date: string | null;
  subjectKey: string;
};

export function makeDraftDiagnostic(
  code: DraftDiagnosticCode,
  date: string | null,
  subjectKey: string
): DraftDiagnostic {
  return { code, severity: DRAFT_DIAGNOSTIC_SEVERITY[code], date, subjectKey };
}

/** Canonical diagnostic ordering: date (nulls first), code, subjectKey. */
export function sortDraftDiagnostics(diagnostics: DraftDiagnostic[]): DraftDiagnostic[] {
  return [...diagnostics].sort((a, b) => {
    const dateA = a.date ?? "";
    const dateB = b.date ?? "";
    if (dateA !== dateB) return dateA < dateB ? -1 : 1;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.subjectKey < b.subjectKey ? -1 : a.subjectKey > b.subjectKey ? 1 : 0;
  });
}
