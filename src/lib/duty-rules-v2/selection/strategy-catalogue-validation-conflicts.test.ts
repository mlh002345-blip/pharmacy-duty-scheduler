// Duty Rules V2 — Phase 6: catalogue, validation, conflict-analysis, and
// security-boundary unit tests for the remaining strategy types
// (FAIRNESS_LEAST_LOAD, WEIGHTED_FAIRNESS, SEQUENTIAL_ROTATION,
// MANUAL_ORDER, LEXICOGRAPHIC_CHAIN, HYBRID_ROTATION_FAIRNESS) plus the
// platform-wide security invariants (RANDOMIZED prohibition, unknown
// strategy rejection, bounded limits, fingerprint determinism).

import { describe, expect, it } from "vitest";

import { rankCandidates } from "./rank-candidates";
import { validateStrategyDefinition } from "./validate-strategy-definition";
import { analyzeStrategyConflicts } from "./analyze-strategy-conflicts";
import { canonicalizeStrategySet, strategySetFingerprint } from "./canonicalize-strategy-set";
import { getStrategyCatalogueEntry, STRATEGY_CATALOGUE, PROHIBITED_STRATEGY_TYPES } from "./catalogue";
import { STRATEGY_LIMITS } from "./domain/strategy-parameters";
import type { CandidateRankingFacts } from "./domain/ranking-fact";
import type { ConfiguredSelectionStrategy } from "./domain/strategy-definition";
import type { StrategyMatchContext } from "./domain/strategy-context";

function fact(overrides: Partial<CandidateRankingFacts> & { candidateKey: string }): CandidateRankingFacts {
  return {
    pharmacyId: overrides.candidateKey,
    pharmacyName: overrides.candidateKey,
    origin: "STRICT",
    totalWeightedLoad: 0,
    projectedLoadIfAssigned: 0,
    totalAssignmentCount: 0,
    weekendCount: 0,
    sundayCount: 0,
    holidayCount: 0,
    lastDutyDate: null,
    daysSinceLastDuty: null,
    prefersThisDate: false,
    currentRound: null,
    distanceFromCursor: null,
    isCursor: false,
    carriedForwardCount: 0,
    sortIndex: null,
    manualOrderPosition: null,
    softFailureCount: 0,
    softPrioritySum: 0,
    highestSoftPriority: null,
    softPenaltyScore: 0,
    softFailuresByRuleType: {},
    weightedScore: 0,
    ...overrides,
  };
}

const ctx: StrategyMatchContext = {
  organizationId: "org-1",
  regionId: "region-1",
  planId: "plan-1",
  planVersionId: "pv-1",
  generationMode: "PREVIEW",
  date: "2026-08-03",
  weekday: "MONDAY",
  holidayTypes: ["NONE"],
  dayType: "WEEKDAY",
  customDayCategory: null,
  poolId: "pool-1",
  shiftKey: "shift-1",
  slotId: "slot-1",
};

function baseDefinition(overrides: Partial<ConfiguredSelectionStrategy>): ConfiguredSelectionStrategy {
  return {
    id: "s-1",
    strategyType: "FAIRNESS_LEAST_LOAD",
    name: "Test Strateji",
    enabled: true,
    priority: 1,
    scope: {},
    parameters: {},
    validFrom: null,
    validTo: null,
    source: "ORGANIZATION_CONFIGURED",
    version: 1,
    fallbackStrategyIds: [],
    tieBreakers: [],
    metadata: {},
    ...overrides,
  };
}

describe("catalogue security boundary", () => {
  it("RANDOMIZED (and its known aliases) are never registered and never resolvable", () => {
    expect(getStrategyCatalogueEntry("RANDOMIZED")).toBeNull();
    expect(getStrategyCatalogueEntry("RANDOM")).toBeNull();
    expect(getStrategyCatalogueEntry("RANDOM_ORDER")).toBeNull();
    expect(PROHIBITED_STRATEGY_TYPES.has("RANDOMIZED")).toBe(true);
  });

  it("validateStrategyDefinition rejects RANDOMIZED with a dedicated code before generic unknown-type handling", () => {
    const issues = validateStrategyDefinition(baseDefinition({ strategyType: "RANDOMIZED" }));
    expect(issues.some((i) => i.code === "RANDOM_STRATEGY_REJECTED")).toBe(true);
  });

  it("validateStrategyDefinition rejects a made-up strategy type as UNKNOWN_STRATEGY_TYPE (no arbitrary-code path exists)", () => {
    const issues = validateStrategyDefinition(baseDefinition({ strategyType: "CUSTOM_JS_COMPARATOR" }));
    expect(issues.some((i) => i.code === "UNKNOWN_STRATEGY_TYPE")).toBe(true);
  });

  it("the catalogue exposes exactly the 7 platform-registered strategy types", () => {
    expect([...STRATEGY_CATALOGUE.keys()].sort()).toEqual(
      [
        "FAIRNESS_LEAST_LOAD",
        "HYBRID_ROTATION_FAIRNESS",
        "LEXICOGRAPHIC_CHAIN",
        "MANUAL_ORDER",
        "SEQUENTIAL_ROTATION",
        "V1_COMPATIBILITY_CHAIN",
        "WEIGHTED_FAIRNESS",
      ].sort()
    );
  });
});

describe("FAIRNESS_LEAST_LOAD", () => {
  it("always starts with TOTAL_WEIGHTED_LOAD_ASC and never returns null", () => {
    const strategy = baseDefinition({
      strategyType: "FAIRNESS_LEAST_LOAD",
      parameters: {
        includeProjectedLoad: false,
        includeAssignmentCount: false,
        includeWeekendCount: false,
        includeHolidayCount: false,
        includeLastDutyDate: false,
      },
    });
    const result = rankCandidates(strategy, [fact({ candidateKey: "a", totalWeightedLoad: 3 }), fact({ candidateKey: "b", totalWeightedLoad: 1 })], ctx);
    expect(result).not.toBeNull();
    expect(result!.rankings[0].candidateKey).toBe("b");
  });

  it("rejects invalid parameters (missing boolean flags) via the strict zod schema", () => {
    const issues = validateStrategyDefinition(
      baseDefinition({ strategyType: "FAIRNESS_LEAST_LOAD", parameters: { includeProjectedLoad: true } })
    );
    expect(issues.some((i) => i.code === "INVALID_PARAMETERS")).toBe(true);
  });
});

describe("WEIGHTED_FAIRNESS", () => {
  const weightedParams = {
    weightTotalWeightedLoad: 1,
    weightProjectedLoad: 0,
    weightAssignmentCount: 0,
    weightWeekendCount: 0,
    weightHolidayCount: 0,
    weightDaysSinceLastDuty: 1,
    weightRotationDistance: 0,
    preferDutyBonus: 0,
    softRulePenaltyWeights: {},
  };

  it("never-served candidates get a fixed sentinel (100000), never random or clock-derived", () => {
    const strategy = baseDefinition({ strategyType: "WEIGHTED_FAIRNESS", parameters: weightedParams });
    const a = rankCandidates(strategy, [fact({ candidateKey: "a", daysSinceLastDuty: null })], ctx)!;
    const b = rankCandidates(strategy, [fact({ candidateKey: "a", daysSinceLastDuty: null })], ctx)!;
    expect(a.rankings[0].rankFacts.weightedScore).toBe(b.rankings[0].rankFacts.weightedScore);
    expect(a.rankings[0].rankFacts.weightedScore).toBe(-100000);
  });

  it("all-zero weights (including soft weights) is flagged ALL_ZERO_WEIGHTS by conflict analysis", () => {
    const strategy = baseDefinition({
      strategyType: "WEIGHTED_FAIRNESS",
      parameters: { ...weightedParams, weightTotalWeightedLoad: 0, weightDaysSinceLastDuty: 0 },
    });
    const conflicts = analyzeStrategyConflicts([strategy], { organizationId: "org-1", regionId: "region-1" });
    expect(conflicts.some((c) => c.code === "ALL_ZERO_WEIGHTS")).toBe(true);
  });

  it("bounds weights to [-1000, 1000] and rejects out-of-range values", () => {
    const issues = validateStrategyDefinition(
      baseDefinition({
        strategyType: "WEIGHTED_FAIRNESS",
        parameters: { ...weightedParams, weightTotalWeightedLoad: 5000 },
      })
    );
    expect(issues.some((i) => i.code === "INVALID_PARAMETERS")).toBe(true);
  });

  it("caps softRulePenaltyWeights at 50 entries", () => {
    const tooMany = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`RULE_${i}`, 1]));
    const issues = validateStrategyDefinition(
      baseDefinition({
        strategyType: "WEIGHTED_FAIRNESS",
        parameters: { ...weightedParams, softRulePenaltyWeights: tooMany },
      })
    );
    expect(issues.some((i) => i.code === "INVALID_PARAMETERS")).toBe(true);
  });
});

describe("SEQUENTIAL_ROTATION / MANUAL_ORDER — fallback-triggering null handling", () => {
  it("SEQUENTIAL_ROTATION returns null (triggers fallback) when NO candidate has any rotation fact", () => {
    const strategy = baseDefinition({
      strategyType: "SEQUENTIAL_ROTATION",
      parameters: { useCarriedForwardPriority: false },
    });
    const result = rankCandidates(strategy, [fact({ candidateKey: "a" })], ctx);
    expect(result).toBeNull();
  });

  it("SEQUENTIAL_ROTATION does NOT return null for an EMPTY candidate set (nothing to rank is not 'missing facts')", () => {
    const strategy = baseDefinition({
      strategyType: "SEQUENTIAL_ROTATION",
      parameters: { useCarriedForwardPriority: false },
    });
    const result = rankCandidates(strategy, [], ctx);
    expect(result).not.toBeNull();
    expect(result!.rankings).toEqual([]);
  });

  it("MANUAL_ORDER returns null when no candidate carries manual/sort data, but ranks correctly when they do", () => {
    const strategy = baseDefinition({ strategyType: "MANUAL_ORDER", parameters: {} });
    expect(rankCandidates(strategy, [fact({ candidateKey: "a" })], ctx)).toBeNull();
    const ranked = rankCandidates(
      strategy,
      [fact({ candidateKey: "a", sortIndex: 2 }), fact({ candidateKey: "b", sortIndex: 1 })],
      ctx
    );
    expect(ranked!.rankings[0].candidateKey).toBe("b");
  });
});

describe("LEXICOGRAPHIC_CHAIN — restricted allowed-criteria set", () => {
  it("rejects a criterion outside the 14-item allowed set (e.g. the internal WEIGHTED_SCORE_ASC)", () => {
    const issues = validateStrategyDefinition(
      baseDefinition({ strategyType: "LEXICOGRAPHIC_CHAIN", parameters: { criteria: ["WEIGHTED_SCORE_ASC"] } })
    );
    expect(issues.some((i) => i.code === "INVALID_PARAMETERS")).toBe(true);
  });

  it("rejects duplicate criteria in the chain", () => {
    const issues = validateStrategyDefinition(
      baseDefinition({
        strategyType: "LEXICOGRAPHIC_CHAIN",
        parameters: { criteria: ["TOTAL_WEIGHTED_LOAD_ASC", "TOTAL_WEIGHTED_LOAD_ASC"] },
      })
    );
    expect(issues.some((i) => i.code === "INVALID_PARAMETERS")).toBe(true);
  });

  it("an empty criteria array is flagged EMPTY_LEXICOGRAPHIC_CHAIN by conflict analysis", () => {
    const strategy = baseDefinition({ strategyType: "LEXICOGRAPHIC_CHAIN", parameters: { criteria: [] } });
    const conflicts = analyzeStrategyConflicts([strategy], { organizationId: "org-1", regionId: "region-1" });
    expect(conflicts.some((c) => c.code === "EMPTY_LEXICOGRAPHIC_CHAIN")).toBe(true);
  });

  it("ranks candidates using chamber-chosen criteria in the chamber-chosen order", () => {
    const strategy = baseDefinition({
      strategyType: "LEXICOGRAPHIC_CHAIN",
      parameters: { criteria: ["PHARMACY_NAME_TR_ASC"] },
    });
    const result = rankCandidates(
      strategy,
      [fact({ candidateKey: "a", pharmacyName: "Z" }), fact({ candidateKey: "b", pharmacyName: "A" })],
      ctx
    )!;
    expect(result.rankings[0].candidateKey).toBe("b");
  });
});

describe("HYBRID_ROTATION_FAIRNESS", () => {
  it("rejects a definition with both stages disabled", () => {
    const issues = validateStrategyDefinition(
      baseDefinition({
        strategyType: "HYBRID_ROTATION_FAIRNESS",
        parameters: { enableRotationStage: false, enableFairnessStage: false, useCarriedForwardPriority: false },
      })
    );
    expect(issues.some((i) => i.code === "INVALID_PARAMETERS")).toBe(true);
  });

  it("falls through to the fairness stage when rotation facts are absent and fairness is enabled", () => {
    const strategy = baseDefinition({
      strategyType: "HYBRID_ROTATION_FAIRNESS",
      parameters: { enableRotationStage: true, enableFairnessStage: true, useCarriedForwardPriority: false },
    });
    const result = rankCandidates(
      strategy,
      [fact({ candidateKey: "a", totalWeightedLoad: 3 }), fact({ candidateKey: "b", totalWeightedLoad: 1 })],
      ctx
    );
    expect(result).not.toBeNull();
    expect(result!.rankings[0].candidateKey).toBe("b");
  });
});

describe("bounded limits (security: no unbounded chamber input)", () => {
  it("rejects a strategy set larger than maxStrategiesPerSet", () => {
    const many = Array.from({ length: STRATEGY_LIMITS.maxStrategiesPerSet + 1 }, (_, i) =>
      baseDefinition({ id: `s-${i}` })
    );
    const conflicts = analyzeStrategyConflicts(many, { organizationId: "org-1", regionId: "region-1" });
    expect(conflicts).toEqual([
      expect.objectContaining({ code: "STRATEGY_SET_TOO_LARGE", level: "ERROR" }),
    ]);
  });

  it("rejects more than maxFallbackLevels fallback ids (caught by the strict shape schema's bound)", () => {
    const tooMany = Array.from({ length: STRATEGY_LIMITS.maxFallbackLevels + 1 }, (_, i) => `f-${i}`);
    const issues = validateStrategyDefinition(baseDefinition({ fallbackStrategyIds: tooMany }));
    expect(issues.some((i) => i.code === "INVALID_SHAPE")).toBe(true);
  });

  it("rejects self-fallback", () => {
    const issues = validateStrategyDefinition(baseDefinition({ id: "s-x", fallbackStrategyIds: ["s-x"] }));
    expect(issues.some((i) => i.code === "SELF_FALLBACK")).toBe(true);
  });

  it("rejects a scope referencing a foreign organizationId/regionId (tenant safety)", () => {
    const strategy = baseDefinition({ scope: { organizationId: "org-EVIL" } });
    const conflicts = analyzeStrategyConflicts([strategy], { organizationId: "org-1", regionId: "region-1" });
    expect(conflicts.some((c) => c.code === "TENANT_INCONSISTENT_ID")).toBe(true);
  });
});

describe("determinism and fingerprint provenance", () => {
  it("strategySetFingerprint is stable across input array reordering (order-insensitive at the SET level)", () => {
    const a = baseDefinition({ id: "s-a" });
    const b = baseDefinition({ id: "s-b" });
    const f1 = strategySetFingerprint([a, b], () => 1);
    const f2 = strategySetFingerprint([b, a], () => 1);
    expect(f1).toBe(f2);
  });

  it("strategySetFingerprint changes when comparatorVersion changes (platform code change is provenance-visible)", () => {
    const a = baseDefinition({ id: "s-a" });
    const f1 = strategySetFingerprint([a], () => 1);
    const f2 = strategySetFingerprint([a], () => 2);
    expect(f1).not.toBe(f2);
  });

  it("canonicalizeStrategySet does NOT sort fallbackStrategyIds or tieBreakers (order is behavior-relevant)", () => {
    const a = baseDefinition({ id: "s-a", fallbackStrategyIds: ["z", "a"], tieBreakers: ["PHARMACY_ID_ASC"] });
    const [canonical] = canonicalizeStrategySet([a], () => 1);
    expect(canonical.fallbackStrategyIds).toEqual(["z", "a"]);
  });

  it("empty-set fingerprint is a fixed constant, not zero-length", () => {
    expect(strategySetFingerprint([], () => 0)).toMatch(/^[0-9a-f]{64}$/);
  });
});
