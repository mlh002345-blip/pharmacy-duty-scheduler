// Duty Rules V2 — Phase 6: the configured selection-strategy contract.
//
// A ConfiguredSelectionStrategy is what a CHAMBER configures: which
// platform-catalogue strategy is enabled, with what priority, scope,
// parameters, validity, fallback chain, and tie-breakers. Like Phase 5's
// ConfiguredRuleDefinition, it is a PLAIN, strictly-validated value that
// can never carry executable content — no comparator callbacks, code
// strings, expressions, SQL, regex, or dynamic module paths.

import type { StrategyScope } from "./strategy-context";
import type { TieBreakerCode } from "./ranking-fact";

export const STRATEGY_SOURCES = [
  "PLATFORM_DEFAULT",
  "ORGANIZATION_CONFIGURED",
  "REGION_CONFIGURED",
  "PLAN_VERSION_CONFIGURED",
  "COMPATIBILITY_V1",
] as const;
export type StrategySource = (typeof STRATEGY_SOURCES)[number];

export type ConfiguredSelectionStrategy = {
  id: string;
  strategyType: string;
  name: string;
  enabled: boolean;
  /** Lower number = higher precedence when resolving the primary
   *  strategy for a scope. Ties with overlapping scope are a conflict. */
  priority: number;
  scope: StrategyScope;
  parameters: Record<string, unknown>;
  validFrom: string | null;
  validTo: string | null;
  source: StrategySource;
  version: number;
  /** Ordered strategy ids tried, in order, when this strategy is not
   *  applicable or produces no total order. Never used to bypass HARD
   *  exclusions — only to pick a different ranking method. */
  fallbackStrategyIds: string[];
  /** Ordered tie-breaker chain, evaluated after the strategy's own
   *  ranking facts are exhausted. The mandatory final fallback
   *  (candidateKey ascending) is always appended by the platform. */
  tieBreakers: TieBreakerCode[];
  /** Display-only, non-executable, excluded from the fingerprint. */
  metadata: { description?: string };
};
