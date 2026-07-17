// Duty Rules V2 — Phase 7: eligibility-origin validation.
//
// Independently re-checks that every assignment's origin/strategy/rank
// facts agree with Phase 4-6's OWN determination — never re-derives
// eligibility itself, only cross-checks restatement fidelity.
//
// Origin is cross-checked against each candidate's own
// CandidateRankingFacts.origin (provisional.rankings[].rankFacts.origin),
// not against the source selection input's static strictEligible/
// relaxedEligible sets. Those sets are Phase 4's one-time, single-slot
// evaluation and cannot see a candidate Phase 6 admits later via
// sequential-relaxation widening (apply-sequential-selection-state.ts's
// resolveSequentialCandidateSet, sequential-relaxation-contract
// corrective) — rankFacts.origin is stamped from that same function's
// authoritative origin map and is correct for both admission paths.

import type { EngineDraftResultPreDraft } from "../engine/build-draft-result";
import { makeDraftDiagnostic, type DraftDiagnostic } from "./domain/draft-diagnostic";
import type { DraftSlot } from "./domain/draft-schedule";

export function validateDraftEligibilityOrigin(input: {
  result: EngineDraftResultPreDraft;
  slots: DraftSlot[];
}): DraftDiagnostic[] {
  const diagnostics: DraftDiagnostic[] = [];
  const provisionalBySlotKey = new Map(input.result.provisionalSelections.map((p) => [p.slotKey, p]));

  for (const slot of input.slots) {
    const provisional = provisionalBySlotKey.get(slot.slotKey) ?? null;
    if (!provisional) continue;

    const rankingByKey = new Map(provisional.rankings.map((r) => [r.candidateKey, r]));

    for (const assignment of slot.assignments) {
      const ranking = rankingByKey.get(assignment.candidateKey);
      if (!ranking) {
        diagnostics.push(
          makeDraftDiagnostic(
            "DRAFT_CANDIDATE_NOT_IN_STRICT_OR_RELAXED",
            assignment.date,
            assignment.draftAssignmentKey
          )
        );
      } else if (assignment.origin !== ranking.rankFacts.origin) {
        diagnostics.push(
          makeDraftDiagnostic("DRAFT_ORIGIN_MISMATCH", assignment.date, assignment.draftAssignmentKey)
        );
      }

      if (assignment.strategyId !== provisional.strategyId || assignment.strategyType !== provisional.strategyType) {
        diagnostics.push(
          makeDraftDiagnostic("DRAFT_STRATEGY_MISMATCH", assignment.date, assignment.draftAssignmentKey)
        );
      }

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
