// Duty Rules V2 — Phase 7: Complete Draft Schedule contracts.
//
// A CompleteDraftSchedule assembles Phase 4-6 outputs (already-computed
// candidates, eligibility, rule/strategy outcomes, provisional
// selections) into ONE canonical, inspectable artifact. It never
// re-ranks, re-selects, or invents a winner: every DraftAssignment is a
// direct, traceable projection of a Phase 6 ProvisionalSlotSelection's
// selectedCandidateKeys. It contains NO DutySchedule/DutyAssignment
// records and performs no database access.
//
// Every field here is either copied verbatim from Phase 4-6 output or a
// deterministic derivation of it (e.g. dutyWeight = the candidate's own
// dateWeight fact). No field is a database-generated id or a
// current-time value — see fingerprint-complete-draft.ts's header for
// the exact canonical payload this feeds.

import type { DraftDiagnostic } from "./draft-diagnostic";
import type { EngineRunProvenance } from "../../engine/build-draft-result";

export type DraftAssignmentSourceProvenance = {
  configurationFingerprint: string;
  runtimeInputHash: string;
  ruleSetFingerprint: string;
  strategySetFingerprint: string;
  membershipSnapshotHash: string;
};

/** One resolved seat filled by one candidate, traceable back to its
 *  originating ProvisionalSlotSelection ranking. Never re-derives
 *  eligibility or ranking facts — only restates what Phase 6 already
 *  decided, in assembled form. */
export type DraftAssignment = {
  /** Deterministic, globally unique: "{slotKey}#{candidateKey}". */
  draftAssignmentKey: string;
  slotKey: string;
  date: string;
  shiftId: string;
  shiftKey: string;
  poolId: string | null;
  candidateKey: string;
  membershipId: string;
  pharmacyId: string;
  pharmacyName: string;
  origin: "STRICT" | "RELAXED";
  strategyId: string | null;
  strategyType: string | null;
  /** Phase 6's own rank position among this slot's candidates. */
  provisionalRank: number;
  /** Phase 6's own 1-based selection order within this slot. */
  selectionOrdinal: number;
  fallbackUsed: boolean;
  /** The candidate's own dateWeight fact (Phase 4 fairness facts) — the
   *  weight this specific assignment carries, never recomputed here. */
  dutyWeight: number;
  resolvedDayType: string | null;
  /** Phase 6 corrective compatibility fact, only non-null on
   *  HOLIDAY_EVE dates: see resolve-calendar-context.ts. */
  compatibilityWeightDayType: "WEEKDAY" | "SATURDAY" | "SUNDAY" | null;
  /** Phase 6's own decisive comparator criterion for this candidate, or
   *  null when no SelectionExplanation exists for this candidateKey. */
  decisiveComparatorCriterion: string | null;
  /** Stable violation/explanation codes of every non-PASS Phase 5 rule
   *  outcome this candidate carries for this slot (ADVISORY included). */
  ruleExplanationRefs: string[];
  sourceProvenance: DraftAssignmentSourceProvenance;
};

export type DraftSlotStatus = "FILLED" | "UNDERFILLED" | "UNRESOLVED" | "UNSCHEDULED";

export type DraftSlot = {
  slotKey: string;
  date: string;
  dayTypeKey: string;
  shiftId: string;
  shiftKey: string;
  poolId: string | null;
  slotId: string;
  slotName: string | null;
  sortOrder: number;
  requiredCount: number;
  selectedCount: number;
  missingCount: number;
  status: DraftSlotStatus;
  strategyId: string | null;
  strategyType: string | null;
  fallbackUsed: boolean;
  relaxation: {
    strictEligibleCount: number;
    relaxedEligibleCount: number;
    relaxationApplied: boolean;
  };
  /** Ordered by selectionOrdinal. */
  assignments: DraftAssignment[];
  /** Stable codes: every non-PASS Phase 5 rule outcome anywhere in this
   *  slot (candidate-independent view; per-candidate refs live on the
   *  assignment). */
  ruleDiagnosticRefs: string[];
  /** Stable Phase 6 SelectionDiagnostic codes for this slot. */
  strategyDiagnosticRefs: string[];
  /** candidateKeys with a SelectionExplanation for this slot. */
  explanationRefs: string[];
  diagnostics: DraftDiagnostic[];
};

export type DraftDay = {
  date: string;
  weekdayName: string;
  dayTypeKey: string | null;
  compatibilityWeightDayType: "WEEKDAY" | "SATURDAY" | "SUNDAY" | null;
  isHolidayEve: boolean;
  holidays: { type: string; name: string }[];
  served: boolean;
  requiredCount: number;
  selectedCount: number;
  missingCount: number;
  status: DraftSlotStatus;
  slotKeys: string[];
  assignmentKeys: string[];
  slots: DraftSlot[];
};

export type CompleteDraftStatus = "COMPLETE" | "PARTIAL" | "INVALID";

export type DraftValidationSummary = {
  errorCount: number;
  warningCount: number;
  infoCount: number;
};

export type DraftGenerationManifest = {
  planVersionId: string;
  organizationId: string;
  regionId: string;
  periodStart: string;
  periodEnd: string;
  status: CompleteDraftStatus;
  isCommitEligible: boolean;
  counts: {
    totalSlots: number;
    filledSlots: number;
    underfilledSlots: number;
    unresolvedSlots: number;
    unscheduledSlots: number;
    totalAssignments: number;
  };
  /** The DutyEngineDraftResult this draft was assembled from. */
  sourceResultFingerprint: string;
  provenance: EngineRunProvenance;
  generatedFromProvisionalSelectionsCount: number;
  completeDraftFingerprint: string;
  /** Deterministically ordered (ASC). */
  assignmentKeys: string[];
  unresolvedSlotKeys: string[];
  underfilledSlotKeys: string[];
  /** Deduplicated, sorted ERROR-severity diagnostic codes present
   *  anywhere in the draft. Empty unless status is INVALID. */
  blockingDiagnosticCodes: string[];
  validation: DraftValidationSummary;
};

export type CompleteDraftSchedule = {
  engineVersion: number;
  selectionEngineVersion: number;
  generationMode: string;
  periodStart: string;
  periodEnd: string;
  provenance: EngineRunProvenance;
  days: DraftDay[];
  /** Flat, deterministically ordered (draftAssignmentKey ASC) view of
   *  every assignment across the whole period — the primary consumption
   *  shape for anything that doesn't need per-day/per-slot grouping. */
  assignments: DraftAssignment[];
  counts: {
    totalSlots: number;
    filledSlots: number;
    underfilledSlots: number;
    unresolvedSlots: number;
    unscheduledSlots: number;
    totalAssignments: number;
  };
  diagnostics: DraftDiagnostic[];
  status: CompleteDraftStatus;
  /** True only when status is COMPLETE and there is not a single ERROR
   *  diagnostic anywhere in the draft. A future (not-yet-built) commit
   *  step should refuse to run against a draft where this is false. */
  isCommitEligible: boolean;
  manifest: DraftGenerationManifest;
  completeDraftFingerprint: string;
};
