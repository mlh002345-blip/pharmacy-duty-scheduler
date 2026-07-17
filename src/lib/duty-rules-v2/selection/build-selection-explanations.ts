// Duty Rules V2 — Phase 6, Phase 16: deterministic, code-based selection
// explanations. No Turkish prose in the engine — only stable codes, the
// same convention as Phase 5's rule explanations.

import { createHash } from "node:crypto";

import { canonicalSerialize } from "../v1-adapter";
import type { CandidateRanking, ProvisionalSlotSelection } from "./domain/selection-result";

export type SelectionExplanation = {
  candidateKey: string;
  strategyId: string | null;
  strategyType: string | null;
  rankPosition: number;
  selected: boolean;
  origin: "STRICT" | "RELAXED";
  decisiveCriterion: string | null;
  comparatorTrace: CandidateRanking["comparatorTrace"];
  fairnessFactsUsed: {
    totalWeightedLoad: number;
    projectedLoadIfAssigned: number;
    totalAssignmentCount: number;
    weekendCount: number;
    sundayCount: number;
    holidayCount: number;
    lastDutyDate: string | null;
    daysSinceLastDuty: number | null;
    prefersThisDate: boolean;
  };
  rotationFactsUsed: {
    currentRound: number | null;
    distanceFromCursor: number | null;
    isCursor: boolean;
    carriedForwardCount: number;
    sortIndex: number | null;
    manualOrderPosition: number | null;
  };
  softFindingsUsed: { failureCount: number; prioritySum: number; highestPriority: number | null };
  fallbackUsed: boolean;
  finalStableFallbackUsed: boolean;
  explanationCode: string;
};

const EXPLANATION_CODES = {
  SELECTED: "SELECTION_CANDIDATE_SELECTED",
  NOT_SELECTED: "SELECTION_CANDIDATE_NOT_SELECTED",
  NOT_APPLICABLE: "SELECTION_NO_STRATEGY_APPLICABLE",
} as const;

export function buildSelectionExplanations(
  slotSelection: ProvisionalSlotSelection
): SelectionExplanation[] {
  return slotSelection.rankings.map((ranking) => {
    const decisive = ranking.comparatorTrace.find((step) => !step.tieContinued);
    // The final stable fallback was used iff EVERY recorded step tied
    // except (possibly) the mandatory CANDIDATE_KEY_ASC step itself.
    const finalStableFallbackUsed =
      ranking.comparatorTrace.length > 0 &&
      ranking.comparatorTrace[ranking.comparatorTrace.length - 1].criterion === "CANDIDATE_KEY_ASC" &&
      ranking.comparatorTrace.slice(0, -1).every((step) => step.tieContinued);

    return {
      candidateKey: ranking.candidateKey,
      strategyId: ranking.strategyId,
      strategyType: ranking.strategyType,
      rankPosition: ranking.provisionalRank,
      selected: ranking.selected,
      origin: ranking.rankFacts.origin,
      decisiveCriterion: decisive?.criterion ?? null,
      comparatorTrace: ranking.comparatorTrace,
      fairnessFactsUsed: {
        totalWeightedLoad: ranking.rankFacts.totalWeightedLoad,
        projectedLoadIfAssigned: ranking.rankFacts.projectedLoadIfAssigned,
        totalAssignmentCount: ranking.rankFacts.totalAssignmentCount,
        weekendCount: ranking.rankFacts.weekendCount,
        sundayCount: ranking.rankFacts.sundayCount,
        holidayCount: ranking.rankFacts.holidayCount,
        lastDutyDate: ranking.rankFacts.lastDutyDate,
        daysSinceLastDuty: ranking.rankFacts.daysSinceLastDuty,
        prefersThisDate: ranking.rankFacts.prefersThisDate,
      },
      rotationFactsUsed: {
        currentRound: ranking.rankFacts.currentRound,
        distanceFromCursor: ranking.rankFacts.distanceFromCursor,
        isCursor: ranking.rankFacts.isCursor,
        carriedForwardCount: ranking.rankFacts.carriedForwardCount,
        sortIndex: ranking.rankFacts.sortIndex,
        manualOrderPosition: ranking.rankFacts.manualOrderPosition,
      },
      softFindingsUsed: {
        failureCount: ranking.rankFacts.softFailureCount,
        prioritySum: ranking.rankFacts.softPrioritySum,
        highestPriority: ranking.rankFacts.highestSoftPriority,
      },
      fallbackUsed: slotSelection.fallbackChainTrace.length > 1,
      finalStableFallbackUsed,
      explanationCode: ranking.selected ? EXPLANATION_CODES.SELECTED : EXPLANATION_CODES.NOT_SELECTED,
    };
  });
}

/** Per-slot provisional-selection fingerprint: covers the FULL selection
 *  outcome including runtime candidate facts (pharmacy names included —
 *  see canonicalize-strategy-set.ts's provenance-decision comment). */
export function provisionalSelectionFingerprint(slotSelection: ProvisionalSlotSelection): string {
  return createHash("sha256").update(canonicalSerialize(slotSelection)).digest("hex");
}
