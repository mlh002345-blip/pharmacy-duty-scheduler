// Duty Rules V2 — Phase 6, Phase 13: primary strategy resolution and the
// controlled fallback chain.
//
// A fallback is used ONLY when the primary (or an earlier fallback)
// cannot produce a total order from available facts (rankCandidates
// returns null) — NEVER to bypass HARD exclusions, since the candidate
// SET itself (resolved once, upstream, in resolve-candidate-set.ts) is
// identical across every attempt in the chain.

import { rankCandidates, type RankCandidatesResult } from "./rank-candidates";
import type { CandidateRankingFacts } from "./domain/ranking-fact";
import type { ConfiguredSelectionStrategy } from "./domain/strategy-definition";
import type { StrategyMatchContext } from "./domain/strategy-context";
import { matchStrategyEffectivePeriod, matchStrategyScope } from "./match-strategy-scope";
import type { FallbackTraceEntry } from "./domain/selection-result";

export type ApplicableStrategy = { definition: ConfiguredSelectionStrategy };

/** Enabled, in-scope, in-period definitions, deterministically ordered
 *  by (priority asc, id asc) for inspection — NOT used to silently pick
 *  among equal-precedence primaries (see resolvePrimaryStrategy). */
export function resolveApplicableStrategies(
  definitions: ConfiguredSelectionStrategy[],
  matchContext: StrategyMatchContext
): ConfiguredSelectionStrategy[] {
  return definitions
    .filter((definition) => definition.enabled)
    .filter(
      (definition) => matchStrategyScope(definition.scope, matchContext).kind === "MATCH"
    )
    .filter((definition) =>
      matchStrategyEffectivePeriod(definition.validFrom, definition.validTo, matchContext.date)
    )
    .sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1));
}

export type PrimaryResolution =
  | { kind: "RESOLVED"; primary: ConfiguredSelectionStrategy }
  | { kind: "NOT_FOUND" }
  | { kind: "EQUAL_PRECEDENCE_CONFLICT"; conflictingIds: string[] };

export function resolvePrimaryStrategy(applicable: ConfiguredSelectionStrategy[]): PrimaryResolution {
  if (applicable.length === 0) return { kind: "NOT_FOUND" };
  const minPriority = applicable[0].priority; // already sorted ascending
  const atMinPriority = applicable.filter((definition) => definition.priority === minPriority);
  if (atMinPriority.length > 1) {
    return {
      kind: "EQUAL_PRECEDENCE_CONFLICT",
      conflictingIds: atMinPriority.map((d) => d.id).sort(),
    };
  }
  return { kind: "RESOLVED", primary: atMinPriority[0] };
}

export type FallbackAttemptResult = {
  succeeded: boolean;
  usedDefinition: ConfiguredSelectionStrategy | null;
  rankResult: RankCandidatesResult | null;
  trace: FallbackTraceEntry[];
};

/**
 * Try the primary strategy, then its fallbackStrategyIds in order
 * (resolved against the full definition set, skipping unknown/disabled
 * targets and refusing to loop on a cycle) until one produces a total
 * order, or all are exhausted.
 */
export function applyFallbackChain(
  primary: ConfiguredSelectionStrategy,
  allDefinitionsById: ReadonlyMap<string, ConfiguredSelectionStrategy>,
  candidates: readonly CandidateRankingFacts[],
  matchContext: StrategyMatchContext
): FallbackAttemptResult {
  const trace: FallbackTraceEntry[] = [];
  const visited = new Set<string>();

  let current: ConfiguredSelectionStrategy | undefined = primary;
  while (current) {
    if (visited.has(current.id)) break; // cycle guard — never re-attempt
    visited.add(current.id);

    const rankResult = rankCandidates(current, candidates, matchContext);
    trace.push({
      strategyId: current.id,
      strategyType: current.strategyType,
      attempted: true,
      reasonCode: rankResult === null ? "MISSING_REQUIRED_FACT" : null,
      succeeded: rankResult !== null,
    });
    if (rankResult !== null) {
      return { succeeded: true, usedDefinition: current, rankResult, trace };
    }

    const nextId: string | undefined = current.fallbackStrategyIds.find((id) => !visited.has(id));
    const next: ConfiguredSelectionStrategy | undefined = nextId
      ? allDefinitionsById.get(nextId)
      : undefined;
    if (nextId && !next) {
      trace.push({ strategyId: nextId, strategyType: "?", attempted: false, reasonCode: "UNKNOWN_TARGET", succeeded: false });
    } else if (next && !next.enabled) {
      trace.push({ strategyId: next.id, strategyType: next.strategyType, attempted: false, reasonCode: "DISABLED_TARGET", succeeded: false });
    }
    current = next?.enabled ? next : undefined;
  }

  return { succeeded: false, usedDefinition: null, rankResult: null, trace };
}
