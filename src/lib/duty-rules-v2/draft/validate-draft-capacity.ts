// Duty Rules V2 — Phase 7: slot-capacity validation.
//
// Independently re-derives each slot's selected/missing counts and
// no-strategy status from the source Phase 4-6 output, and flags any
// place assembly's own facts disagree with that re-derivation.

import { makeDraftDiagnostic, type DraftDiagnostic } from "./domain/draft-diagnostic";
import type { DraftSlot } from "./domain/draft-schedule";

export function validateDraftCapacity(input: { slots: DraftSlot[]; hasAnyStrategyConfigured: boolean }): DraftDiagnostic[] {
  const diagnostics: DraftDiagnostic[] = [];

  for (const slot of input.slots) {
    if (slot.status === "UNSCHEDULED") continue;

    if (!input.hasAnyStrategyConfigured && slot.requiredCount > 0) {
      diagnostics.push(makeDraftDiagnostic("DRAFT_NO_SELECTION_STRATEGY", slot.date, slot.slotKey));
    }
    if (slot.status === "UNRESOLVED" && slot.requiredCount > 0 && slot.assignments.length === 0) {
      diagnostics.push(makeDraftDiagnostic("DRAFT_NO_SELECTION_STRATEGY", slot.date, slot.slotKey));
    }

    if (slot.assignments.length > slot.requiredCount) {
      diagnostics.push(
        makeDraftDiagnostic("DRAFT_ASSIGNMENT_COUNT_EXCEEDS_REQUIRED", slot.date, slot.slotKey)
      );
    }
    const expectedMissing = Math.max(0, slot.requiredCount - slot.assignments.length);
    if (slot.missingCount !== expectedMissing || slot.selectedCount !== slot.assignments.length) {
      diagnostics.push(makeDraftDiagnostic("DRAFT_MISSING_COUNT_MISMATCH", slot.date, slot.slotKey));
    }
    if (slot.requiredCount > 0 && slot.assignments.length < slot.requiredCount && slot.status !== "UNRESOLVED") {
      diagnostics.push(makeDraftDiagnostic("DRAFT_SLOT_UNDERFILLED", slot.date, slot.slotKey));
    }
    if (slot.assignments.length > 0 && slot.strategyId === null) {
      diagnostics.push(
        makeDraftDiagnostic("DRAFT_STRATEGY_MISSING_FOR_SELECTED_SLOT", slot.date, slot.slotKey)
      );
    }
  }

  return diagnostics;
}
