// Duty Rules V2 — Phase 6: the platform-controlled strategy catalogue
// contract. Mirrors Phase 5's RuleCatalogueEntry pattern: the platform
// owns the ranking-fact-to-order translation; chambers only select and
// parameterize. NO comparator callback is ever chamber-suppliable — a
// catalogue entry resolves to a fixed, ordered list of platform
// RankingCriterion codes, which the shared compare-candidates.ts
// registry then applies generically.

import type { z } from "zod";

import type { RankingCriterion, CandidateRankingFacts } from "./ranking-fact";
import type { TieBreakerCode } from "./ranking-fact";
import type { StrategyMatchContext, StrategyScopeDimension } from "./strategy-context";

export type StrategyCatalogueEntry = {
  strategyType: string;
  /** Bumped whenever comparator BEHAVIOR changes; part of the strategy
   *  fingerprint. */
  comparatorVersion: number;
  parameterSchema: z.ZodTypeAny;
  supportedScopeDimensions: readonly StrategyScopeDimension[];
  /** Tie-breaker codes this strategy accepts in its configured chain,
   *  applied AFTER the strategy's own primary criterion sequence. */
  supportedTieBreakers: readonly TieBreakerCode[];
  /**
   * Pure: given validated parameters and the full ranking-fact set for
   * one slot, return the ORDERED primary criterion sequence to compare
   * candidates by (before configured tie-breakers and the mandatory
   * final fallback), or null when this strategy cannot produce ANY
   * primary ordering from the given facts (e.g. rotation-based
   * strategies with zero rotation state anywhere in the set) — the
   * caller then tries the fallback chain. Never returns a callback.
   *
   * matchContext is the already-computed, pure slot context (date,
   * weekday, holiday types, …) — used ONLY by V1_COMPATIBILITY_CHAIN to
   * reproduce V1's date-conditional weekend/holiday tie-break inclusion
   * exactly. It is read-only slot data, never ambient state.
   */
  resolveCriterionSequence: (
    parameters: unknown,
    candidates: readonly CandidateRankingFacts[],
    matchContext: StrategyMatchContext
  ) => RankingCriterion[] | null;
  /** WEIGHTED_FAIRNESS only: pure per-candidate score computation from
   *  bounded configured weights. Populates
   *  CandidateRankingFacts.weightedScore before ranking. Absent for
   *  every other strategy (weightedScore stays 0). */
  computeWeightedScore?: (parameters: unknown, candidate: CandidateRankingFacts) => number;
};
