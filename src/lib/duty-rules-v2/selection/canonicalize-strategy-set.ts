// Duty Rules V2 — Phase 6, Phase 15: strategy-set canonicalization and
// fingerprint. Mirrors Phase 5's canonicalize-rule-set.ts exactly.
//
// PHARMACY-NAME TIE-BREAK PROVENANCE DECISION (explicit, not ambiguous):
// strategySetFingerprint covers STRATEGY CONFIGURATION only — it
// correctly EXCLUDES pharmacy names, because a rename does not change
// what the strategy IS configured to do. Pharmacy-name tie-break EFFECTS
// (PHARMACY_NAME_TR_ASC decisions) are runtime candidate data, and are
// captured instead in the provisional selection's own fingerprint
// (build-selection-explanations.ts's provisionalSelectionFingerprint /
// the draft result's resultFingerprint), which embeds full
// CandidateRankingFacts including pharmacyName. See
// DUTY_RULES_V2_SELECTION_STRATEGY_ENGINE.md for the persisted
// consequence: a future committed schedule must persist the
// provisionalSelectionFingerprint (or resultFingerprint) alongside
// strategySetFingerprint, since strategySetFingerprint alone cannot
// prove which specific tie-break value decided a name-based order.

import { createHash } from "node:crypto";

import { canonicalSerialize } from "../v1-adapter";
import type { ConfiguredSelectionStrategy } from "./domain/strategy-definition";
import type { StrategyScope } from "./domain/strategy-context";

function sortedArray<T extends string>(values: T[] | undefined): T[] | undefined {
  return values === undefined ? undefined : [...values].sort();
}

function canonicalScope(scope: StrategyScope): StrategyScope {
  return {
    ...scope,
    poolIds: sortedArray(scope.poolIds),
    dayTypes: sortedArray(scope.dayTypes),
    customDayCategories: sortedArray(scope.customDayCategories),
    shiftKeys: sortedArray(scope.shiftKeys),
    slotIds: sortedArray(scope.slotIds),
    generationModes: sortedArray(scope.generationModes),
    weekdays: sortedArray(scope.weekdays),
    holidayTypes: sortedArray(scope.holidayTypes),
  };
}

function canonicalParameters(parameters: Record<string, unknown>): Record<string, unknown> {
  const canonical: Record<string, unknown> = { ...parameters };
  if (Array.isArray(canonical.criteria)) {
    // Lexicographic ORDER is behavior-relevant — never sorted.
    canonical.criteria = [...(canonical.criteria as unknown[])];
  }
  return canonical;
}

type CanonicalStrategy = {
  id: string;
  strategyType: string;
  enabled: boolean;
  priority: number;
  scope: StrategyScope;
  parameters: Record<string, unknown>;
  validFrom: string | null;
  validTo: string | null;
  source: string;
  version: number;
  fallbackStrategyIds: string[];
  tieBreakers: string[];
  comparatorVersion: number;
};

export function canonicalizeStrategySet(
  definitions: ConfiguredSelectionStrategy[],
  comparatorVersionOf: (strategyType: string) => number
): CanonicalStrategy[] {
  const canonical = definitions.map((definition) => ({
    id: definition.id,
    strategyType: definition.strategyType,
    enabled: definition.enabled,
    priority: definition.priority,
    scope: canonicalScope(definition.scope),
    parameters: canonicalParameters(definition.parameters),
    validFrom: definition.validFrom,
    validTo: definition.validTo,
    source: definition.source,
    version: definition.version,
    // Fallback CHAIN order is behavior-relevant (first-match semantics)
    // — never sorted.
    fallbackStrategyIds: [...definition.fallbackStrategyIds],
    // Tie-breaker CHAIN order is behavior-relevant — never sorted.
    tieBreakers: [...definition.tieBreakers],
    comparatorVersion: comparatorVersionOf(definition.strategyType),
  }));

  canonical.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.strategyType !== b.strategyType) return a.strategyType < b.strategyType ? -1 : 1;
    const scopeA = canonicalSerialize(a.scope);
    const scopeB = canonicalSerialize(b.scope);
    if (scopeA !== scopeB) return scopeA < scopeB ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return canonical;
}

export function strategySetFingerprint(
  definitions: ConfiguredSelectionStrategy[],
  comparatorVersionOf: (strategyType: string) => number
): string {
  return createHash("sha256")
    .update(canonicalSerialize(canonicalizeStrategySet(definitions, comparatorVersionOf)))
    .digest("hex");
}
