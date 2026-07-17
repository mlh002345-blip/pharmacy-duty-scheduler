// Duty Rules V2 — Phase 7: stable Complete Draft Schedule diagnostic
// catalogue. Codes are the program-level contract; free text belongs to
// a later presentation layer and is never used as logic here.
//
// Every code is owned by exactly one validator module (documented
// inline) — see docs/architecture/DUTY_RULES_V2_COMPLETE_DRAFT_GENERATION.md
// for the full validator-boundary table.

export const DRAFT_DIAGNOSTIC_CODES = [
  // --- reference integrity (validate-draft-references.ts) ---
  /** A resolvable slot carries no pool reference at the ResolvedSlot
   *  stage — mirrors Phase 4's SLOT_WITHOUT_POOL, restated at draft
   *  level so the whole schedule can be judged from this artifact alone. */
  "DRAFT_SLOT_WITHOUT_POOL",
  /** A provisional selection references a slotKey absent from this
   *  draft's own days/slots structure. */
  "DRAFT_ASSIGNMENT_REFERENCES_UNKNOWN_SLOT",
  /** A provisional selection's selectedCandidateKeys entry has no
   *  matching ranking, so no assignment fact could be assembled for it. */
  "DRAFT_ASSIGNMENT_REFERENCES_UNKNOWN_CANDIDATE",
  /** An assignment's pharmacyId is not present among the source
   *  selection input's own candidate facts for that slot. */
  "DRAFT_UNKNOWN_PHARMACY_REFERENCE",
  /** An assignment's candidateKey does not decode to a membershipId
   *  present in the source selection input's own candidate list. */
  "DRAFT_MEMBERSHIP_MISMATCH",
  /** An assignment's provenance planVersionId does not match the
   *  draft's own run-level provenance. */
  "DRAFT_PLAN_VERSION_MISMATCH",
  /** An assignment's shiftId/shiftKey does not match its own slot's
   *  shiftId/shiftKey. */
  "DRAFT_SHIFT_MISMATCH",
  /** An assignment's poolId does not match its own slot's poolId. */
  "DRAFT_POOL_MISMATCH",
  /** A slotKey does not follow the mandatory
   *  "{date}:{dayTypeKey}:{shiftKey}:{sortOrder}" shape. */
  "DRAFT_SLOT_KEY_FORMAT_INVALID",

  // --- slot capacity (validate-draft-capacity.ts) ---
  /** A resolvable slot with requiredCount > 0 has no provisional
   *  selection at all (no strategy configured, or the strategy
   *  resolution failed) — the slot carries zero assignments. */
  "DRAFT_NO_SELECTION_STRATEGY",
  /** A slot received fewer assignments than requiredCount. */
  "DRAFT_SLOT_UNDERFILLED",
  /** A slot assembled more assignments than its requiredCount allows. */
  "DRAFT_ASSIGNMENT_COUNT_EXCEEDS_REQUIRED",
  /** The number of assignments assembled for a slot does not match the
   *  number of selectedCandidateKeys reported by Phase 6. */
  "DRAFT_ASSIGNMENT_COUNT_MISMATCH_SELECTION",
  /** A slot's (requiredCount - selectedCount) missingCount fact does not
   *  match the actual gap observed on re-derivation. */
  "DRAFT_MISSING_COUNT_MISMATCH",
  /** A slot carries assignments but no strategyId/strategyType was
   *  recorded for the provisional selection that produced them. */
  "DRAFT_STRATEGY_MISSING_FOR_SELECTED_SLOT",

  // --- eligibility origin (validate-draft-eligibility-origin.ts) ---
  /** An assignment's candidateKey has no matching entry in the source
   *  provisional selection's own rankings (Phase 6's own determination
   *  of the admitted candidate pool, including sequential-relaxation
   *  widening). */
  "DRAFT_CANDIDATE_NOT_IN_STRICT_OR_RELAXED",
  /** An assignment's recorded origin does not match its own
   *  CandidateRankingFacts.origin as recorded by Phase 6. */
  "DRAFT_ORIGIN_MISMATCH",
  /** An assignment's strategyId/strategyType does not match the
   *  provisional selection's own recorded strategy for that slot. */
  "DRAFT_STRATEGY_MISMATCH",
  /** An assignment's provisionalRank does not match its own ranking's
   *  provisionalRank as recorded by Phase 6. */
  "DRAFT_SELECTED_RANK_MISMATCH",

  // --- chronology / identity uniqueness (validate-draft-chronology.ts) ---
  /** Two assignments in the whole draft share a draftAssignmentKey. */
  "DRAFT_DUPLICATE_ASSIGNMENT_KEY",
  /** The same candidateKey appears more than once among one slot's
   *  selectedCandidateKeys. */
  "DRAFT_DUPLICATE_CANDIDATE_KEY_IN_SLOT",
  /** The same pharmacyId occupies more than one seat in one slot. */
  "DRAFT_SAME_SLOT_DUPLICATE_PHARMACY",
  /** Two assignments within one slot share a selectionOrdinal. */
  "DRAFT_DUPLICATE_SELECTION_ORDINAL",
  /** A slot's selectionOrdinal sequence is not the contiguous 1..N run
   *  implied by its assignment count. */
  "DRAFT_SELECTION_ORDINAL_GAP",
  /** Selected assignments are not in non-decreasing provisionalRank
   *  order — ranking is not being preserved by assembly. */
  "DRAFT_RANK_NOT_MONOTONIC",
  /** An assignment's date does not match its own slot's date. */
  "DRAFT_SLOT_DATE_MISMATCH",
  /** An assignment or slot date falls outside [periodStart, periodEnd]. */
  "DRAFT_PERIOD_BOUNDARY_VIOLATION",
  /** Two distinct ResolvedSlot entries in this draft share a slotKey. */
  "DRAFT_DUPLICATE_SLOT_IDENTITY",
  /** The same pharmacyId holds assignments on more than one slot of the
   *  same calendar date while same-day second assignments are not
   *  permitted by policy. */
  "DRAFT_SAME_DAY_PHARMACY_CONFLICT",
  /** The same pharmacyId is reachable — and assigned — through more
   *  than one distinct membershipId on the same date while same-day
   *  second assignments are not permitted by policy. */
  "DRAFT_SAME_DAY_PHARMACY_MULTI_MEMBERSHIP_CONFLICT",

  // --- completeness / summary consistency (validate-draft-completeness.ts) ---
  /** A DraftDay's own requiredCount/selectedCount/missingCount or key
   *  lists do not match the actual sum/union of its slots. */
  "DRAFT_DAY_SUMMARY_INCONSISTENT",
  /** The draft-level counts object does not match the actual sum of
   *  per-slot/per-day facts. */
  "DRAFT_PERIOD_SUMMARY_INCONSISTENT",

  // --- informational ---
  /** Informational: this assignment was produced via a fallback
   *  strategy rather than the slot's primary strategy. */
  "DRAFT_FALLBACK_USED_ON_ASSIGNMENT",
] as const;
export type DraftDiagnosticCode = (typeof DRAFT_DIAGNOSTIC_CODES)[number];

export const DRAFT_DIAGNOSTIC_SEVERITY: Readonly<Record<DraftDiagnosticCode, "ERROR" | "WARNING" | "INFO">> = {
  DRAFT_SLOT_WITHOUT_POOL: "INFO",
  DRAFT_ASSIGNMENT_REFERENCES_UNKNOWN_SLOT: "ERROR",
  DRAFT_ASSIGNMENT_REFERENCES_UNKNOWN_CANDIDATE: "ERROR",
  DRAFT_UNKNOWN_PHARMACY_REFERENCE: "ERROR",
  DRAFT_MEMBERSHIP_MISMATCH: "ERROR",
  DRAFT_PLAN_VERSION_MISMATCH: "ERROR",
  DRAFT_SHIFT_MISMATCH: "ERROR",
  DRAFT_POOL_MISMATCH: "ERROR",
  DRAFT_SLOT_KEY_FORMAT_INVALID: "ERROR",

  DRAFT_NO_SELECTION_STRATEGY: "WARNING",
  DRAFT_SLOT_UNDERFILLED: "WARNING",
  DRAFT_ASSIGNMENT_COUNT_EXCEEDS_REQUIRED: "ERROR",
  DRAFT_ASSIGNMENT_COUNT_MISMATCH_SELECTION: "ERROR",
  DRAFT_MISSING_COUNT_MISMATCH: "ERROR",
  DRAFT_STRATEGY_MISSING_FOR_SELECTED_SLOT: "ERROR",

  DRAFT_CANDIDATE_NOT_IN_STRICT_OR_RELAXED: "ERROR",
  DRAFT_ORIGIN_MISMATCH: "ERROR",
  DRAFT_STRATEGY_MISMATCH: "ERROR",
  DRAFT_SELECTED_RANK_MISMATCH: "ERROR",

  DRAFT_DUPLICATE_ASSIGNMENT_KEY: "ERROR",
  DRAFT_DUPLICATE_CANDIDATE_KEY_IN_SLOT: "ERROR",
  DRAFT_SAME_SLOT_DUPLICATE_PHARMACY: "ERROR",
  DRAFT_DUPLICATE_SELECTION_ORDINAL: "ERROR",
  DRAFT_SELECTION_ORDINAL_GAP: "WARNING",
  DRAFT_RANK_NOT_MONOTONIC: "WARNING",
  DRAFT_SLOT_DATE_MISMATCH: "ERROR",
  DRAFT_PERIOD_BOUNDARY_VIOLATION: "ERROR",
  DRAFT_DUPLICATE_SLOT_IDENTITY: "ERROR",
  DRAFT_SAME_DAY_PHARMACY_CONFLICT: "ERROR",
  DRAFT_SAME_DAY_PHARMACY_MULTI_MEMBERSHIP_CONFLICT: "ERROR",

  DRAFT_DAY_SUMMARY_INCONSISTENT: "ERROR",
  DRAFT_PERIOD_SUMMARY_INCONSISTENT: "ERROR",

  DRAFT_FALLBACK_USED_ON_ASSIGNMENT: "INFO",
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

/** Deduplicated, sorted diagnostic codes — used by the manifest's
 *  blockingDiagnosticCodes and by dedup-focused tests. */
export function dedupedDiagnosticCodes(diagnostics: DraftDiagnostic[]): string[] {
  return [...new Set(diagnostics.map((d) => d.code as string))].sort();
}
