// Duty Rules V2 — Phase 7: eligibility-origin validation.
//
// Independently re-checks that every assignment's origin/strategy/rank/
// relaxation facts agree with Phase 4-6's OWN determination — never
// re-derives eligibility itself, only cross-checks restatement fidelity.

import type { EngineDraftResultPreDraft } from "../engine/build-draft-result";
import { makeDraftDiagnostic, type DraftDiagnostic } from "./domain/draft-diagnostic";
import type { DraftSlot } from "./domain/draft-schedule";

export function validateDraftEligibilityOrigin(input: {
  result: EngineDraftResultPreDraft;
  slots: DraftSlot[];
}): DraftDiagnostic[] {
  const diagnostics: DraftDiagnostic[] = [];
  const selectionInputBySlotKey = new Map(input.result.selectionInputs.map((si) => [si.slot.slotKey, si]));
  const provisionalBySlotKey = new Map(input.result.provisionalSelections.map((p) => [p.slotKey, p]));

  for (const slot of input.slots) {
    const selectionInput = selectionInputBySlotKey.get(slot.slotKey) ?? null;
    const provisional = provisionalBySlotKey.get(slot.slotKey) ?? null;
    if (!selectionInput || !provisional) continue;

    const strictSet = new Set(selectionInput.relaxation.strictEligible);
    const relaxedSet = new Set(selectionInput.relaxation.relaxedEligible);
    const rankingByKey = new Map(provisional.rankings.map((r) => [r.candidateKey, r]));

    for (const assignment of slot.assignments) {
      const inStrict = strictSet.has(assignment.candidateKey);
      const inRelaxed = relaxedSet.has(assignment.candidateKey);
      if (!inStrict && !inRelaxed) {
        diagnostics.push(
          makeDraftDiagnostic(
            "DRAFT_CANDIDATE_NOT_IN_STRICT_OR_RELAXED",
            assignment.date,
            assignment.draftAssignmentKey
          )
        );
      } else {
        const expectedOrigin = inStrict ? "STRICT" : "RELAXED";
        if (assignment.origin !== expectedOrigin) {
          diagnostics.push(
            makeDraftDiagnostic("DRAFT_ORIGIN_MISMATCH", assignment.date, assignment.draftAssignmentKey)
          );
        }
      }

      if (assignment.origin === "RELAXED" && !selectionInput.relaxation.relaxationApplied) {
        diagnostics.push(
          makeDraftDiagnostic("DRAFT_RELAXATION_MISMATCH", assignment.date, assignment.draftAssignmentKey)
        );
      }

      if (assignment.strategyId !== provisional.strategyId || assignment.strategyType !== provisional.strategyType) {
        diagnostics.push(
          makeDraftDiagnostic("DRAFT_STRATEGY_MISMATCH", assignment.date, assignment.draftAssignmentKey)
        );
      }

      const ranking = rankingByKey.get(assignment.candidateKey);
      if (ranking && ranking.provisionalRank !== assignment.provisionalRank) {
        diagnostics.push(
          makeDraftDiagnostic("DRAFT_SELECTED_RANK_MISMATCH", assignment.date, assignment.draftAssignmentKey)
        );
      }

      if (provisional.date !== assignment.date || slot.date !== assignment.date) {
        diagnostics.push(
          makeDraftDiagnostic("DRAFT_SLOT_DATE_MISMATCH", assignment.date, assignment.draftAssignmentKey)
        );
      }
    }
  }

  return diagnostics;
}
