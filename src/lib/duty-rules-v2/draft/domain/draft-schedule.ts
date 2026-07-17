// Duty Rules V2 — Phase 7: Complete Draft Schedule contracts.
//
// A CompleteDraftSchedule assembles Phase 4-6 outputs (already-computed
// candidates, eligibility, rule/strategy outcomes, provisional
// selections) into ONE canonical, inspectable artifact. It never
// re-ranks, re-selects, or invents a winner: every DraftAssignment is a
// direct, traceable projection of a Phase 6 ProvisionalSlotSelection's
// selectedCandidateKeys. It contains NO DutySchedule/DutyAssignment
// records and performs no database access.

import type { DraftDiagnostic } from "./draft-diagnostic";
import type { EngineRunProvenance } from "../../engine/build-draft-result";

/** One resolved seat filled by one candidate, traceable back to its
 *  originating ProvisionalSlotSelection ranking. Never re-derives
 *  eligibility or ranking facts — only restates what Phase 6 already
 *  decided, in assembled form. */
export type DraftAssignment = {
  /** Deterministic, globally unique: "{slotKey}#{candidateKey}". */
  assignmentKey: string;
  slotKey: string;
  date: string;
  candidateKey: string;
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
  status: DraftSlotStatus;
  /** Ordered by selectionOrdinal. */
  assignments: DraftAssignment[];
  diagnostics: DraftDiagnostic[];
};

export type DraftDay = {
  date: string;
  dayTypeKey: string | null;
  served: boolean;
  slots: DraftSlot[];
};

export type CompleteDraftStatus = "COMPLETE" | "PARTIAL" | "INVALID";

export type DraftValidationSummary = {
  errorCount: number;
  warningCount: number;
  infoCount: number;
};

export type DraftGenerationManifest = {
  /** The DutyEngineDraftResult this draft was assembled from. */
  sourceResultFingerprint: string;
  provenance: EngineRunProvenance;
  generatedFromProvisionalSelectionsCount: number;
  slotCount: number;
  assignmentCount: number;
  validation: DraftValidationSummary;
  status: CompleteDraftStatus;
  isCommitEligible: boolean;
};

export type CompleteDraftSchedule = {
  engineVersion: number;
  selectionEngineVersion: number;
  generationMode: string;
  periodStart: string;
  periodEnd: string;
  provenance: EngineRunProvenance;
  days: DraftDay[];
  /** Flat, deterministically ordered (assignmentKey ASC) view of every
   *  assignment across the whole period — the primary consumption shape
   *  for anything that doesn't need per-day/per-slot grouping. */
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
