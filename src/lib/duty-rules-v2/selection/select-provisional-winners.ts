// Duty Rules V2 — Phase 6, Phase 12: provisional selection.
//
// selectProvisionalWinners(...) is the single per-slot entry point:
// resolve the candidate set (Phase 7, from already-computed Phase 4/5
// facts), resolve the applicable strategy + fallback chain, rank, and
// select AT MOST requiredCount candidates. Pure, deterministic, no
// database access, no RotationState mutation, no mutation of its input.
//
// LIMITATION (documented, not fixed here): each slot is selected
// INDEPENDENTLY using already-resolved candidate facts. There is no
// multi-slot global optimization, backtracking, or cross-slot
// constraint propagation between provisional selections in this phase.

import type { SelectionInput } from "../engine/build-selection-input";
import { applyFallbackChain, resolveApplicableStrategies, resolvePrimaryStrategy } from "./apply-fallback-chain";
import { buildCandidateRankingFacts, buildStrategyMatchContext } from "./build-strategy-context";
import { resolveCandidateSet } from "./resolve-candidate-set";
import type { ConfiguredSelectionStrategy } from "./domain/strategy-definition";
import type { StrategyMatchContext } from "./domain/strategy-context";
import type {
  CandidateRanking,
  FallbackTraceEntry,
  ProvisionalSlotSelection,
} from "./domain/selection-result";
import type { SelectionDiagnostic } from "./domain/selection-diagnostic";

export function selectProvisionalWinners(input: {
  selectionInput: SelectionInput;
  matchContextBase: Omit<
    Parameters<typeof buildStrategyMatchContext>[0],
    "selectionInput"
  >;
  definitions: ConfiguredSelectionStrategy[];
  definitionsById: ReadonlyMap<string, ConfiguredSelectionStrategy>;
}): ProvisionalSlotSelection {
  const { selectionInput } = input;
  const slotKey = selectionInput.slot.slotKey;
  const date = selectionInput.slot.date;
  const requiredCount = selectionInput.requiredCount;

  const matchContext: StrategyMatchContext = buildStrategyMatchContext({
    ...input.matchContextBase,
    selectionInput,
  });

  const origin = resolveCandidateSet(selectionInput);
  const rankingFacts = buildCandidateRankingFacts(selectionInput, origin);

  const diagnostics: SelectionDiagnostic[] = [];
  if (rankingFacts.length === 0) {
    diagnostics.push({ code: "NO_ELIGIBLE_CANDIDATES", date, subjectKey: slotKey });
  }

  const applicable = resolveApplicableStrategies(input.definitions, matchContext);
  const primaryResolution = resolvePrimaryStrategy(applicable);

  const empty = (
    strategyId: string | null,
    strategyType: string | null,
    extraDiagnostics: SelectionDiagnostic[],
    fallbackChainTrace: FallbackTraceEntry[] = []
  ): ProvisionalSlotSelection => ({
    slotKey,
    date,
    requiredCount,
    strategyId,
    strategyType,
    selectedCandidateKeys: [],
    rankings: [],
    fallbackChainTrace,
    underfilled: requiredCount > 0,
    unresolved: true,
    diagnostics: [...diagnostics, ...extraDiagnostics],
  });

  if (primaryResolution.kind === "NOT_FOUND") {
    return empty(null, null, [{ code: "STRATEGY_NOT_FOUND", date, subjectKey: slotKey }]);
  }
  if (primaryResolution.kind === "EQUAL_PRECEDENCE_CONFLICT") {
    return empty(null, null, [
      { code: "STRATEGY_EQUAL_PRECEDENCE_CONFLICT", date, subjectKey: slotKey },
    ]);
  }

  const attempt = applyFallbackChain(
    primaryResolution.primary,
    input.definitionsById,
    rankingFacts,
    matchContext
  );
  if (!attempt.succeeded || attempt.rankResult === null) {
    return empty(
      primaryResolution.primary.id,
      primaryResolution.primary.strategyType,
      [{ code: "STRATEGY_UNRESOLVED", date, subjectKey: slotKey }],
      attempt.trace
    );
  }

  const usedFallback = attempt.usedDefinition!.id !== primaryResolution.primary.id;
  if (usedFallback) {
    diagnostics.push({ code: "FALLBACK_USED", date, subjectKey: attempt.usedDefinition!.id });
  }

  const selectedCount = Math.min(requiredCount, attempt.rankResult.rankings.length);
  const selectedKeys = new Set(
    attempt.rankResult.rankings.slice(0, selectedCount).map((r) => r.candidateKey)
  );

  const rankings: CandidateRanking[] = attempt.rankResult.rankings.map((ranking) => ({
    candidateKey: ranking.candidateKey,
    strategyId: attempt.usedDefinition!.id,
    strategyType: attempt.usedDefinition!.strategyType,
    rankFacts: ranking.rankFacts,
    comparatorTrace: ranking.comparatorTrace,
    finalStableKey: ranking.finalStableKey,
    provisionalRank: ranking.provisionalRank,
    selected: selectedKeys.has(ranking.candidateKey),
    selectionOrdinal: selectedKeys.has(ranking.candidateKey) ? ranking.provisionalRank : null,
    diagnostics: [],
  }));

  const underfilled = selectedCount < requiredCount;
  if (underfilled) {
    diagnostics.push({ code: "UNDERFILLED_SELECTION", date, subjectKey: slotKey });
  }

  return {
    slotKey,
    date,
    requiredCount,
    strategyId: attempt.usedDefinition!.id,
    strategyType: attempt.usedDefinition!.strategyType,
    selectedCandidateKeys: attempt.rankResult.rankings
      .slice(0, selectedCount)
      .map((r) => r.candidateKey),
    rankings,
    fallbackChainTrace: attempt.trace,
    underfilled,
    unresolved: false,
    diagnostics,
  };
}
