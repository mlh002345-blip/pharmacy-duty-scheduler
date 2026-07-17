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
import type { CandidateRankingFacts } from "./domain/ranking-fact";
import type { ConfiguredSelectionStrategy } from "./domain/strategy-definition";
import type { StrategyMatchContext } from "./domain/strategy-context";
import type {
  CandidateRanking,
  FallbackTraceEntry,
  ProvisionalSlotSelection,
} from "./domain/selection-result";
import type { SelectionDiagnostic } from "./domain/selection-diagnostic";

/**
 * The reusable ranking/fallback/selection core, decoupled from HOW the
 * ranking facts were built — the single-slot-independent entry point
 * below builds them straight from Phase 4/5 facts; the sequential
 * compatibility orchestrator (apply-sequential-selection-state.ts)
 * instead supplies facts already folded with in-run accumulator state.
 * Pure; no database access; no RotationState mutation.
 */
export function selectProvisionalWinnersFromFacts(input: {
  slotKey: string;
  date: string;
  requiredCount: number;
  rankingFacts: CandidateRankingFacts[];
  matchContext: StrategyMatchContext;
  definitions: ConfiguredSelectionStrategy[];
  definitionsById: ReadonlyMap<string, ConfiguredSelectionStrategy>;
}): ProvisionalSlotSelection {
  const { slotKey, date, requiredCount, rankingFacts, matchContext } = input;

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

  // PROVISIONAL_SAME_SLOT_DUPLICATE guard: a slot may select AT MOST one
  // candidate per pharmacyId even when that pharmacy appears through
  // multiple distinct memberships/pools (multiple candidateKeys). Ranked
  // order is otherwise fully preserved — a later-ranked candidate is
  // simply skipped, never promoted, so this never changes WHO is
  // eligible, only prevents one pharmacy occupying two seats in one slot.
  const seenPharmacyIds = new Set<string>();
  const selectedKeys = new Set<string>();
  let sameSlotDuplicateSkipped = false;
  for (const ranking of attempt.rankResult.rankings) {
    if (selectedKeys.size >= requiredCount) break;
    if (seenPharmacyIds.has(ranking.rankFacts.pharmacyId)) {
      sameSlotDuplicateSkipped = true;
      continue;
    }
    seenPharmacyIds.add(ranking.rankFacts.pharmacyId);
    selectedKeys.add(ranking.candidateKey);
  }
  if (sameSlotDuplicateSkipped) {
    diagnostics.push({ code: "PROVISIONAL_SAME_SLOT_DUPLICATE", date, subjectKey: slotKey });
  }
  const selectedCount = selectedKeys.size;

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
      .filter((r) => selectedKeys.has(r.candidateKey))
      .map((r) => r.candidateKey),
    rankings,
    fallbackChainTrace: attempt.trace,
    underfilled,
    unresolved: false,
    diagnostics,
  };
}

/**
 * The single-slot-independent entry point (Phase 6's original design):
 * resolve the candidate set and ranking facts straight from Phase 4/5
 * facts, with NO cross-slot/cross-date state. Retained for callers that
 * legitimately want per-slot independence (e.g. a single date, or a
 * native V2 plan with no V1 sequential-compatibility requirement).
 * buildDutyEngineContext's default period-level orchestration now uses
 * selectProvisionalWinnersSequential (apply-sequential-selection-state.ts)
 * instead, which additionally carries forward in-run selections exactly
 * as V1 does — see that module's header comment for the root-cause
 * explanation.
 */
export function selectProvisionalWinners(input: {
  selectionInput: SelectionInput;
  matchContextBase: Omit<Parameters<typeof buildStrategyMatchContext>[0], "selectionInput">;
  definitions: ConfiguredSelectionStrategy[];
  definitionsById: ReadonlyMap<string, ConfiguredSelectionStrategy>;
}): ProvisionalSlotSelection {
  const { selectionInput } = input;
  const matchContext: StrategyMatchContext = buildStrategyMatchContext({
    ...input.matchContextBase,
    selectionInput,
  });
  const origin = resolveCandidateSet(selectionInput);
  const rankingFacts = buildCandidateRankingFacts(selectionInput, origin);

  return selectProvisionalWinnersFromFacts({
    slotKey: selectionInput.slot.slotKey,
    date: selectionInput.slot.date,
    requiredCount: selectionInput.requiredCount,
    rankingFacts,
    matchContext,
    definitions: input.definitions,
    definitionsById: input.definitionsById,
  });
}
