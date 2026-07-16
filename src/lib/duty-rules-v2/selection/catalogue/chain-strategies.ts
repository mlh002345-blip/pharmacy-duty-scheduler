// Duty Rules V2 — Phase 6 catalogue: chamber-orderable, platform-defined
// criterion chains. The chamber picks WHICH platform criteria and in
// what order — never a new comparator.

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

/** The exact 14 chamber-orderable criteria for LEXICOGRAPHIC_CHAIN
 *  (excludes strategy-internal-only codes: WEIGHTED_SCORE_ASC,
 *  CANDIDATE_KEY_ASC — the latter is the automatic final fallback, never
 *  chamber-selectable — and rotation-cursor-only codes better expressed
 *  via SEQUENTIAL_ROTATION/HYBRID_ROTATION_FAIRNESS). */
export const LEXICOGRAPHIC_ALLOWED_CRITERIA = [
  "PREFER_REQUESTED_DATE_DESC",
  "TOTAL_WEIGHTED_LOAD_ASC",
  "PROJECTED_LOAD_ASC",
  "TOTAL_ASSIGNMENT_COUNT_ASC",
  "WEEKEND_COUNT_ASC",
  "SUNDAY_COUNT_ASC",
  "HOLIDAY_COUNT_ASC",
  "LAST_DUTY_DATE_ASC",
  "DAYS_SINCE_LAST_DUTY_DESC",
  "ROTATION_DISTANCE_ASC",
  "MEMBERSHIP_SORT_INDEX_ASC",
  "MANUAL_ORDER_ASC",
  "PHARMACY_NAME_TR_ASC",
  "PHARMACY_ID_ASC",
] as const satisfies readonly RankingCriterion[];

export const LEXICOGRAPHIC_CHAIN: StrategyCatalogueEntry = {
  strategyType: "LEXICOGRAPHIC_CHAIN",
  comparatorVersion: 1,
  parameterSchema: z
    .object({
      criteria: z
        .array(z.enum(LEXICOGRAPHIC_ALLOWED_CRITERIA))
        .min(1)
        .max(20)
        .refine((chain) => new Set(chain).size === chain.length, {
          message: "duplicate criterion in chain",
        }),
    })
    .strict(),
  supportedScopeDimensions: SCOPE_DIMENSIONS,
  supportedTieBreakers: [
    "TOTAL_WEIGHTED_LOAD_ASC",
    "PHARMACY_NAME_TR_ASC",
    "PHARMACY_ID_ASC",
  ] as const,
  resolveCriterionSequence: (parameters) => {
    const { criteria } = parameters as { criteria: RankingCriterion[] };
    return [...criteria];
  },
};

function hasNoRotationFactsAnywhere(candidates: readonly CandidateRankingFacts[]): boolean {
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

export const HYBRID_ROTATION_FAIRNESS: StrategyCatalogueEntry = {
  strategyType: "HYBRID_ROTATION_FAIRNESS",
  comparatorVersion: 1,
  parameterSchema: z
    .object({
      enableRotationStage: z.boolean(),
      enableFairnessStage: z.boolean(),
      useCarriedForwardPriority: z.boolean(),
    })
    .strict()
    .refine((p) => p.enableRotationStage || p.enableFairnessStage, {
      message: "at least one stage must be enabled",
    }),
  supportedScopeDimensions: SCOPE_DIMENSIONS,
  supportedTieBreakers: [
    "TOTAL_WEIGHTED_LOAD_ASC",
    "TOTAL_ASSIGNMENT_COUNT_ASC",
    "PHARMACY_NAME_TR_ASC",
    "PHARMACY_ID_ASC",
  ] as const,
  resolveCriterionSequence: (parameters, candidates) => {
    const p = parameters as {
      enableRotationStage: boolean;
      enableFairnessStage: boolean;
      useCarriedForwardPriority: boolean;
    };
    const sequence: RankingCriterion[] = [];
    // Stage 1: rotation eligibility/facts — skipped entirely (not just
    // an empty contribution) when no rotation facts exist anywhere, so
    // a rotation-only hybrid correctly falls back rather than silently
    // degrading to an arbitrary order.
    if (p.enableRotationStage) {
      if (hasNoRotationFactsAnywhere(candidates)) {
        if (!p.enableFairnessStage) return null;
      } else {
        if (p.useCarriedForwardPriority) sequence.push("CARRIED_FORWARD_PRIORITY_DESC");
        sequence.push("ROTATION_DISTANCE_ASC", "CURRENT_ROUND_ASC", "MEMBERSHIP_SORT_INDEX_ASC");
      }
    }
    // Stage 2: fairness facts.
    if (p.enableFairnessStage) {
      sequence.push("TOTAL_WEIGHTED_LOAD_ASC", "TOTAL_ASSIGNMENT_COUNT_ASC");
    }
    return sequence.length === 0 ? null : sequence;
  },
};
