// Duty Rules V2 — Phase 7: chronology and identity-uniqueness validation.
//
// Whole-draft structural checks that do not depend on cross-slot policy
// (same-day pharmacy conflicts live in validate-draft-cross-slot.ts,
// which needs the sameDaySecondAssignmentAllowed flag). Pure; read-only.

import { makeDraftDiagnostic, type DraftDiagnostic } from "./domain/draft-diagnostic";
import type { DraftSlot } from "./domain/draft-schedule";

export function validateDraftChronology(input: {
  slots: DraftSlot[];
  periodStart: string;
  periodEnd: string;
}): DraftDiagnostic[] {
  const diagnostics: DraftDiagnostic[] = [];

  const seenSlotKeys = new Set<string>();
  for (const slot of input.slots) {
    if (seenSlotKeys.has(slot.slotKey)) {
      diagnostics.push(makeDraftDiagnostic("DRAFT_DUPLICATE_SLOT_IDENTITY", slot.date, slot.slotKey));
    }
    seenSlotKeys.add(slot.slotKey);

    if (slot.date < input.periodStart || slot.date > input.periodEnd) {
      diagnostics.push(makeDraftDiagnostic("DRAFT_PERIOD_BOUNDARY_VIOLATION", slot.date, slot.slotKey));
    }

    const seenCandidateKeys = new Set<string>();
    const seenPharmacyIds = new Set<string>();
    const seenOrdinals = new Set<number>();
    let previousRank = -Infinity;
    let rankMonotonic = true;

    for (const assignment of slot.assignments) {
      if (assignment.date < input.periodStart || assignment.date > input.periodEnd) {
        diagnostics.push(
          makeDraftDiagnostic("DRAFT_PERIOD_BOUNDARY_VIOLATION", assignment.date, assignment.draftAssignmentKey)
        );
      }
      if (seenCandidateKeys.has(assignment.candidateKey)) {
        diagnostics.push(
          makeDraftDiagnostic("DRAFT_DUPLICATE_CANDIDATE_KEY_IN_SLOT", assignment.date, assignment.draftAssignmentKey)
        );
      }
      seenCandidateKeys.add(assignment.candidateKey);

      if (seenPharmacyIds.has(assignment.pharmacyId)) {
        diagnostics.push(
          makeDraftDiagnostic("DRAFT_SAME_SLOT_DUPLICATE_PHARMACY", assignment.date, slot.slotKey)
        );
      }
      seenPharmacyIds.add(assignment.pharmacyId);

      if (seenOrdinals.has(assignment.selectionOrdinal)) {
        diagnostics.push(
          makeDraftDiagnostic("DRAFT_DUPLICATE_SELECTION_ORDINAL", assignment.date, assignment.draftAssignmentKey)
        );
      }
      seenOrdinals.add(assignment.selectionOrdinal);

      if (assignment.provisionalRank >= previousRank) {
        previousRank = assignment.provisionalRank;
      } else {
        rankMonotonic = false;
      }
    }
    if (!rankMonotonic) {
      diagnostics.push(makeDraftDiagnostic("DRAFT_RANK_NOT_MONOTONIC", slot.date, slot.slotKey));
    }

    const ordinals = slot.assignments.map((a) => a.selectionOrdinal).sort((a, b) => a - b);
    const contiguous = ordinals.every((ordinal, i) => ordinal === i + 1);
    if (!contiguous) {
      diagnostics.push(makeDraftDiagnostic("DRAFT_SELECTION_ORDINAL_GAP", slot.date, slot.slotKey));
    }
  }

  return diagnostics;
}
