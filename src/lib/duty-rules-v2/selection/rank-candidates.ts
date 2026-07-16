// Duty Rules V2 — Phase 6: comparator chain + deterministic ranking.
//
// Composes: strategy primary criterion sequence -> configured
// tie-breakers -> the MANDATORY final fallback (CANDIDATE_KEY_ASC),
// which is a strict total order over unique candidateKeys, so the
// resulting order is fully deterministic regardless of input array
// order or JS engine sort stability.

import { compareByCriterion, observedValueFor } from "./compare-candidates";
import { FINAL_FALLBACK_CRITERION, type CandidateRankingFacts, type RankingCriterion } from "./domain/ranking-fact";
import type { ComparatorStep } from "./domain/selection-result";
import { getStrategyCatalogueEntry } from "./catalogue";
import type { ConfiguredSelectionStrategy } from "./domain/strategy-definition";
import type { StrategyMatchContext } from "./domain/strategy-context";

export type RankedCandidate = {
  candidateKey: string;
  rankFacts: CandidateRankingFacts;
  comparatorTrace: ComparatorStep[];
  finalStableKey: string;
  provisionalRank: number;
};

export type RankCandidatesResult = {
  criterionChain: RankingCriterion[];
  rankings: RankedCandidate[];
};

function compareChain(chain: RankingCriterion[], a: CandidateRankingFacts, b: CandidateRankingFacts): number {
  for (const criterion of chain) {
    const result = compareByCriterion(criterion, a, b);
    if (result !== 0) return result;
  }
  return 0;
}

function traceAgainst(
  chain: RankingCriterion[],
  higher: CandidateRankingFacts,
  lower: CandidateRankingFacts
): ComparatorStep[] {
  const steps: ComparatorStep[] = [];
  for (const criterion of chain) {
    const result = compareByCriterion(criterion, higher, lower);
    const clamped: -1 | 0 | 1 = result < 0 ? -1 : result > 0 ? 1 : 0;
    steps.push({
      criterion,
      leftObserved: observedValueFor(criterion, higher),
      rightObserved: observedValueFor(criterion, lower),
      result: clamped,
      tieContinued: clamped === 0,
    });
    if (clamped !== 0) break; // cascading comparator: decisive step stops evaluation
  }
  return steps;
}

/**
 * Rank one strategy's candidate set. Returns null when the strategy
 * cannot produce ANY primary ordering from the given facts — the
 * caller (apply-fallback-chain.ts) then tries the next fallback.
 */
export function rankCandidates(
  strategyDefinition: ConfiguredSelectionStrategy,
  candidates: readonly CandidateRankingFacts[],
  matchContext: StrategyMatchContext
): RankCandidatesResult | null {
  const entry = getStrategyCatalogueEntry(strategyDefinition.strategyType);
  if (!entry) return null;

  const facts: CandidateRankingFacts[] = entry.computeWeightedScore
    ? candidates.map((c) => ({
        ...c,
        weightedScore: entry.computeWeightedScore!(strategyDefinition.parameters, c),
      }))
    : [...candidates];

  const primarySequence = entry.resolveCriterionSequence(strategyDefinition.parameters, facts, matchContext);
  if (primarySequence === null) return null;

  const chain: RankingCriterion[] = [
    ...primarySequence,
    ...strategyDefinition.tieBreakers,
    FINAL_FALLBACK_CRITERION,
  ];

  const sorted = [...facts].sort((a, b) => compareChain(chain, a, b));

  const rankings: RankedCandidate[] = sorted.map((candidate, index) => ({
    candidateKey: candidate.candidateKey,
    rankFacts: candidate,
    comparatorTrace: index === 0 ? [] : traceAgainst(chain, sorted[index - 1], candidate),
    finalStableKey: candidate.candidateKey,
    provisionalRank: index + 1,
  }));

  return { criterionChain: chain, rankings };
}
