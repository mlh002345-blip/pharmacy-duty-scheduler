// Duty Rules V2 — Phase 6 catalogue: rotation-based strategies.
//
// Neither strategy advances any cursor or mutates RotationState — they
// only ORDER candidates by the already-computed, read-only rotation
// facts Phase 4 attached to the SelectionInput.

import { z } from "zod";

import type { CandidateRankingFacts, RankingCriterion } from "../domain/ranking-fact";
import type { StrategyCatalogueEntry } from "../domain/strategy-catalogue";

const SCOPE_DIMENSIONS = [
  "organizationId",
  "regionId",
  "planId",
  "planVersionId",
  "poolIds",
  "dayTypes",
  "customDayCategories",
  "shiftKeys",
  "slotIds",
  "generationModes",
  "dateRange",
  "weekdays",
  "holidayTypes",
] as const;

const ROTATION_TIE_BREAKERS = [
  "TOTAL_WEIGHTED_LOAD_ASC",
  "PHARMACY_NAME_TR_ASC",
  "PHARMACY_ID_ASC",
] as const;

/** True when NO candidate in the set carries any rotation fact at all —
 *  the "required fact is unavailable" condition that triggers a
 *  fallback rather than an arbitrary order. */
function hasNoRotationFactsAnywhere(candidates: readonly CandidateRankingFacts[]): boolean {
  // An EMPTY candidate set is not "missing facts" — there is simply
  // nothing to rank; only a NON-EMPTY set where every member lacks
  // rotation facts counts as the fallback-triggering condition.
  if (candidates.length === 0) return false;
  return candidates.every(
    (c) =>
      c.distanceFromCursor === null &&
      c.currentRound === null &&
      c.sortIndex === null &&
      c.manualOrderPosition === null &&
      c.carriedForwardCount === 0
  );
}

export const SEQUENTIAL_ROTATION: StrategyCatalogueEntry = {
  strategyType: "SEQUENTIAL_ROTATION",
  comparatorVersion: 1,
  parameterSchema: z.object({ useCarriedForwardPriority: z.boolean() }).strict(),
  supportedScopeDimensions: SCOPE_DIMENSIONS,
  supportedTieBreakers: ROTATION_TIE_BREAKERS,
  resolveCriterionSequence: (parameters, candidates) => {
    if (hasNoRotationFactsAnywhere(candidates)) return null;
    const { useCarriedForwardPriority } = parameters as { useCarriedForwardPriority: boolean };
    const sequence: RankingCriterion[] = [];
    if (useCarriedForwardPriority) sequence.push("CARRIED_FORWARD_PRIORITY_DESC");
    sequence.push(
      "ROTATION_DISTANCE_ASC",
      "CURRENT_ROUND_ASC",
      "MEMBERSHIP_SORT_INDEX_ASC",
      "MANUAL_ORDER_ASC"
    );
    return sequence;
  },
};

export const MANUAL_ORDER: StrategyCatalogueEntry = {
  strategyType: "MANUAL_ORDER",
  comparatorVersion: 1,
  parameterSchema: z.object({}).strict(),
  supportedScopeDimensions: SCOPE_DIMENSIONS,
  supportedTieBreakers: ROTATION_TIE_BREAKERS,
  resolveCriterionSequence: (_parameters, candidates) => {
    const noManualData =
      candidates.length > 0 &&
      candidates.every((c) => c.sortIndex === null && c.manualOrderPosition === null);
    if (noManualData) return null;
    return ["MEMBERSHIP_SORT_INDEX_ASC", "MANUAL_ORDER_ASC"];
  },
};
