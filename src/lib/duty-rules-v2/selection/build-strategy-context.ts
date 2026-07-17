// Duty Rules V2 — Phase 6: pure projection from Phase 4 SelectionInput +
// Phase 5 rule evaluations into the selection engine's own flat facts.
// This module NEVER re-evaluates eligibility or rules — it only
// reshapes already-computed facts (Core Principle: the Rule Engine
// decides who MAY be selected; this module only reshapes facts about
// who remains, for the Selection Strategy Engine to order).

import type { SelectionInput } from "../engine/build-selection-input";
import type { CandidateRankingFacts } from "./domain/ranking-fact";
import type { StrategyMatchContext } from "./domain/strategy-context";

/** SOFT-rule facts for one candidate, derived from the already-computed
 *  Phase 5 ruleEvaluations — no re-evaluation. */
function buildSoftFacts(
  candidateKey: string,
  ruleEvaluations: SelectionInput["ruleEvaluations"]
): Pick<
  CandidateRankingFacts,
  "softFailureCount" | "softPrioritySum" | "highestSoftPriority" | "softPenaltyScore" | "softFailuresByRuleType"
> {
  const softFailures = ruleEvaluations.filter(
    (r) => r.candidateKey === candidateKey && r.severity === "SOFT" && r.outcome === "FAIL"
  );
  const byType: Record<string, number> = {};
  for (const failure of softFailures) {
    byType[failure.ruleType] = (byType[failure.ruleType] ?? 0) + 1;
  }
  const priorities = softFailures.map((f) => f.priority);
  return {
    softFailureCount: softFailures.length,
    softPrioritySum: priorities.reduce((sum, p) => sum + p, 0),
    highestSoftPriority: priorities.length === 0 ? null : Math.min(...priorities),
    softPenaltyScore: softFailures.length,
    softFailuresByRuleType: byType,
  };
}

/** Build the ranking-fact set for every candidate in strict ∪ relaxed
 *  eligibility — the exact candidate set policy Phase 7 (below)
 *  resolves. This function itself is a pure per-candidate projection;
 *  origin (STRICT/RELAXED) is supplied by the caller. */
export function buildCandidateRankingFacts(
  selectionInput: SelectionInput,
  origin: Map<string, "STRICT" | "RELAXED">
): CandidateRankingFacts[] {
  const fairnessByKey = new Map(selectionInput.fairnessFacts.map((f) => [f.candidateKey, f]));
  const rotationByKey = new Map(selectionInput.rotationFacts.map((r) => [r.candidateKey, r]));

  const facts: CandidateRankingFacts[] = [];
  for (const [candidateKey, candidateOrigin] of origin) {
    const candidate = selectionInput.candidates.find((c) => c.candidateKey === candidateKey);
    const fairness = fairnessByKey.get(candidateKey);
    const rotation = rotationByKey.get(candidateKey);
    if (!candidate || !fairness || !rotation) continue; // defensive; cannot happen for a validated SelectionInput
    const soft = buildSoftFacts(candidateKey, selectionInput.ruleEvaluations);
    facts.push({
      candidateKey,
      pharmacyId: candidate.pharmacyId,
      pharmacyName: candidate.pharmacyName,
      origin: candidateOrigin,
      totalWeightedLoad: fairness.totalWeightedLoad,
      projectedLoadIfAssigned: fairness.projectedLoadIfAssigned,
      totalAssignmentCount: fairness.totalAssignmentCount,
      weekendCount: fairness.weekendCount,
      sundayCount: fairness.sundayCount,
      holidayCount: fairness.holidayCount,
      lastDutyDate: fairness.lastDutyDate,
      daysSinceLastDuty: fairness.daysSinceLastDuty,
      prefersThisDate: fairness.prefersThisDate,
      currentRound: rotation.currentRound,
      distanceFromCursor: rotation.distanceFromCursor,
      isCursor: rotation.isCursor,
      carriedForwardCount: rotation.carriedForward.length,
      sortIndex: rotation.sortIndex,
      manualOrderPosition: rotation.manualOrderPosition,
      ...soft,
      weightedScore: 0,
    });
  }
  facts.sort((a, b) => (a.candidateKey < b.candidateKey ? -1 : a.candidateKey > b.candidateKey ? 1 : 0));
  return facts;
}

export function buildStrategyMatchContext(input: {
  organizationId: string;
  regionId: string;
  planId: string;
  planVersionId: string;
  generationMode: "PREVIEW" | "SIMULATION";
  date: string;
  weekday: StrategyMatchContext["weekday"];
  holidayTypes: StrategyMatchContext["holidayTypes"];
  dayType: string;
  customDayCategory: string | null;
  selectionInput: SelectionInput;
}): StrategyMatchContext {
  return {
    organizationId: input.organizationId,
    regionId: input.regionId,
    planId: input.planId,
    planVersionId: input.planVersionId,
    generationMode: input.generationMode,
    date: input.date,
    weekday: input.weekday,
    holidayTypes: input.holidayTypes,
    dayType: input.dayType,
    customDayCategory: input.customDayCategory,
    poolId: input.selectionInput.slot.poolId,
    shiftKey: input.selectionInput.slot.shiftKey,
    slotId: input.selectionInput.slot.slotId,
  };
}
