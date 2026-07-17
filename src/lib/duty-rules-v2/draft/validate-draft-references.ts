// Duty Rules V2 — Phase 7: reference-integrity validation.
//
// Independently re-derives "does this assignment point at something that
// actually exists in the source Phase 4-6 output" — never trusts
// assembly's own best-effort construction. Pure; read-only; never
// mutates or drops an assignment.

import type { EngineDraftResultPreDraft } from "../engine/build-draft-result";
import { makeDraftDiagnostic, type DraftDiagnostic } from "./domain/draft-diagnostic";
import type { DraftSlot } from "./domain/draft-schedule";

const SLOT_KEY_SHAPE = /^\d{4}-\d{2}-\d{2}:.+:.+:\d+$/;

export function validateDraftReferences(input: {
  result: EngineDraftResultPreDraft;
  slots: DraftSlot[];
}): DraftDiagnostic[] {
  const diagnostics: DraftDiagnostic[] = [];
  const { result, slots } = input;
  const knownSlotKeys = new Set(slots.map((s) => s.slotKey));
  const selectionInputBySlotKey = new Map(result.selectionInputs.map((si) => [si.slot.slotKey, si]));

  for (const provisional of result.provisionalSelections) {
    if (!knownSlotKeys.has(provisional.slotKey)) {
      diagnostics.push(
        makeDraftDiagnostic("DRAFT_ASSIGNMENT_REFERENCES_UNKNOWN_SLOT", provisional.date, provisional.slotKey)
      );
      continue;
    }
    const slot = slots.find((s) => s.slotKey === provisional.slotKey)!;
    const assembledCandidateKeys = new Set(slot.assignments.map((a) => a.candidateKey));
    for (const candidateKey of provisional.selectedCandidateKeys) {
      if (!assembledCandidateKeys.has(candidateKey)) {
        diagnostics.push(
          makeDraftDiagnostic(
            "DRAFT_ASSIGNMENT_REFERENCES_UNKNOWN_CANDIDATE",
            provisional.date,
            `${provisional.slotKey}#${candidateKey}`
          )
        );
      }
    }
    if (slot.assignments.length !== provisional.selectedCandidateKeys.length) {
      diagnostics.push(
        makeDraftDiagnostic("DRAFT_ASSIGNMENT_COUNT_MISMATCH_SELECTION", provisional.date, provisional.slotKey)
      );
    }
  }

  for (const slot of slots) {
    if (slot.status === "UNSCHEDULED") {
      diagnostics.push(makeDraftDiagnostic("DRAFT_SLOT_WITHOUT_POOL", slot.date, slot.slotKey));
    }
    if (!SLOT_KEY_SHAPE.test(slot.slotKey)) {
      diagnostics.push(makeDraftDiagnostic("DRAFT_SLOT_KEY_FORMAT_INVALID", slot.date, slot.slotKey));
    }
    const selectionInput = selectionInputBySlotKey.get(slot.slotKey) ?? null;
    const candidatePharmacyIds = new Set((selectionInput?.candidates ?? []).map((c) => c.pharmacyId));
    const candidateMembershipIds = new Set((selectionInput?.candidates ?? []).map((c) => c.membershipId));

    for (const assignment of slot.assignments) {
      if (candidatePharmacyIds.size > 0 && !candidatePharmacyIds.has(assignment.pharmacyId)) {
        diagnostics.push(
          makeDraftDiagnostic(
            "DRAFT_UNKNOWN_PHARMACY_REFERENCE",
            assignment.date,
            `${slot.slotKey}#${assignment.pharmacyId}`
          )
        );
      }
      if (candidateMembershipIds.size > 0 && !candidateMembershipIds.has(assignment.membershipId)) {
        diagnostics.push(
          makeDraftDiagnostic("DRAFT_MEMBERSHIP_MISMATCH", assignment.date, assignment.draftAssignmentKey)
        );
      }
      if (
        assignment.sourceProvenance.configurationFingerprint !== "" &&
        assignment.sourceProvenance.configurationFingerprint !== result.provenance.configurationFingerprint
      ) {
        diagnostics.push(
          makeDraftDiagnostic("DRAFT_PLAN_VERSION_MISMATCH", assignment.date, assignment.draftAssignmentKey)
        );
      }
      if (assignment.shiftId !== slot.shiftId || assignment.shiftKey !== slot.shiftKey) {
        diagnostics.push(
          makeDraftDiagnostic("DRAFT_SHIFT_MISMATCH", assignment.date, assignment.draftAssignmentKey)
        );
      }
      if (assignment.poolId !== slot.poolId) {
        diagnostics.push(
          makeDraftDiagnostic("DRAFT_POOL_MISMATCH", assignment.date, assignment.draftAssignmentKey)
        );
      }
    }
  }

  return diagnostics;
}
