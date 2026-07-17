// Duty Rules V2 — Phase 6, Phase 14: deterministic V1-compatibility
// strategy projection — the selection-side counterpart to Phase 5's
// buildCompatibilityRules(policy). NOT auto-injected anywhere; callers
// (the golden equivalence harness, or a future compatibility-mode
// caller) opt in explicitly.

import type { ConfiguredSelectionStrategy } from "./domain/strategy-definition";

export function buildV1CompatibilitySelectionStrategy(input: {
  organizationId: string;
  regionId: string;
}): ConfiguredSelectionStrategy {
  return {
    id: "v1-strategy:compatibility-chain",
    strategyType: "V1_COMPATIBILITY_CHAIN",
    name: "V1 uyumluluk sıralaması",
    enabled: true,
    priority: 100,
    scope: { organizationId: input.organizationId, regionId: input.regionId },
    parameters: {},
    validFrom: null,
    validTo: null,
    source: "COMPATIBILITY_V1",
    version: 1,
    fallbackStrategyIds: [],
    tieBreakers: [],
    metadata: {},
  };
}
