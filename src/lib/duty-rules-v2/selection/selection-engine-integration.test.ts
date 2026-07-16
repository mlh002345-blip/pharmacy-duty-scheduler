// Duty Rules V2 — Phase 6: end-to-end integration test proving the
// selection engine is correctly wired into buildDutyEngineContext
// (loader-shaped fixture → Phase 4 → Phase 5 (empty) → Phase 6),
// deterministic, provenance-complete, and writes nothing.

import { describe, expect, it } from "vitest";

import { canonicalSerialize } from "../v1-adapter";
import { buildDutyEngineContext } from "../engine/build-engine-context";
import { makeEngineInput, makeLoadedPlan } from "../engine/test-support/fixtures";
import { strategySetFingerprint } from "./canonicalize-strategy-set";
import { SelectionEngineError } from "./strategy-errors";
import type { ConfiguredSelectionStrategy } from "./domain/strategy-definition";

const plan = makeLoadedPlan();

function withStrategies(
  strategies: ConfiguredSelectionStrategy[],
  extra: Parameters<typeof makeEngineInput>[1] = {}
) {
  return makeEngineInput(plan, {
    periodStart: "2026-08-03",
    periodEnd: "2026-08-03",
    configuredSelectionStrategies: strategies,
    ...extra,
  });
}

function fairnessStrategy(id = "s-fairness"): ConfiguredSelectionStrategy {
  return {
    id,
    strategyType: "FAIRNESS_LEAST_LOAD",
    name: "Adalet",
    enabled: true,
    priority: 10,
    scope: {},
    parameters: {
      includeProjectedLoad: false,
      includeAssignmentCount: true,
      includeWeekendCount: false,
      includeHolidayCount: false,
      includeLastDutyDate: true,
    },
    validFrom: null,
    validTo: null,
    source: "ORGANIZATION_CONFIGURED",
    version: 1,
    fallbackStrategyIds: [],
    tieBreakers: [],
    metadata: {},
  };
}

describe("Phase 6 selection engine wiring", () => {
  it("an empty strategy set preserves Phase 4/5 behavior byte-for-byte (except the constant empty-set fingerprint)", () => {
    const withoutField = buildDutyEngineContext(
      makeEngineInput(plan, { periodStart: "2026-08-03", periodEnd: "2026-08-03" })
    );
    const withEmpty = buildDutyEngineContext(withStrategies([]));
    expect(canonicalSerialize(withEmpty)).toBe(canonicalSerialize(withoutField));
    expect(withEmpty.provenance.strategySetFingerprint).toBe(strategySetFingerprint([], () => 0));
    expect(withEmpty.provisionalSelections).toEqual([]);
    expect(withEmpty.strategyConflicts).toEqual([]);
    expect(withEmpty.selectionExplanations).toEqual([]);
  });

  it("writes no schedule/assignment models and never mutates RotationState — it only returns a plain draft object", () => {
    const result = buildDutyEngineContext(withStrategies([fairnessStrategy()]));
    expect(result.provisionalSelections.length).toBeGreaterThan(0);
    // The loaded plan input object is untouched: same rotation state as fixture.
    expect(plan.rotationPools[0].rotationStates[0].currentRound).toBe(1);
    expect(plan.rotationPools[0].rotationStates[0].lastServedMembershipId).toBe("m-a");
  });

  it("selects exactly requiredCount candidates ranked by lowest fairness load, with full comparator trace", () => {
    const result = buildDutyEngineContext(
      withStrategies([fairnessStrategy()], {
        historicalDuties: [
          { pharmacyId: "ph-a", date: "2026-07-01", weight: 5 },
          { pharmacyId: "ph-b", date: "2026-07-01", weight: 1 },
        ],
      })
    );
    const slot = result.provisionalSelections[0];
    expect(slot.selectedCandidateKeys).toHaveLength(1);
    expect(slot.underfilled).toBe(false);
    expect(slot.unresolved).toBe(false);
    // ph-c has zero historical load, so it must win over ph-a (5) and ph-b (1).
    const winnerRanking = slot.rankings.find((r) => r.selected);
    expect(winnerRanking?.rankFacts.pharmacyId).toBe("ph-c");
    // Rank 0 has no predecessor to compare against (empty trace by
    // design); the runner-up's trace documents why it lost.
    const runnerUp = slot.rankings.find((r) => r.provisionalRank === 2);
    expect(runnerUp?.comparatorTrace.length).toBeGreaterThan(0);
  });

  it("provisionalSelectionFingerprint changes when candidate facts change; strategySetFingerprint does not", () => {
    const a = buildDutyEngineContext(withStrategies([fairnessStrategy()]));
    const b = buildDutyEngineContext(
      withStrategies([fairnessStrategy()], {
        historicalDuties: [{ pharmacyId: "ph-a", date: "2026-07-01", weight: 9 }],
      })
    );
    expect(a.provenance.strategySetFingerprint).toBe(b.provenance.strategySetFingerprint);
    expect(a.resultFingerprint).not.toBe(b.resultFingerprint);
  });

  it("rejects an ERROR-level conflicting strategy set (all-zero WEIGHTED_FAIRNESS weights) before any ranking", () => {
    const zeroWeighted: ConfiguredSelectionStrategy = {
      id: "s-zero",
      strategyType: "WEIGHTED_FAIRNESS",
      name: "Sıfır Ağırlık",
      enabled: true,
      priority: 1,
      scope: {},
      parameters: {
        weightTotalWeightedLoad: 0,
        weightProjectedLoad: 0,
        weightAssignmentCount: 0,
        weightWeekendCount: 0,
        weightHolidayCount: 0,
        weightDaysSinceLastDuty: 0,
        weightRotationDistance: 0,
        preferDutyBonus: 0,
        softRulePenaltyWeights: {},
      },
      validFrom: null,
      validTo: null,
      source: "ORGANIZATION_CONFIGURED",
      version: 1,
      fallbackStrategyIds: [],
      tieBreakers: [],
      metadata: {},
    };
    expect(() => buildDutyEngineContext(withStrategies([zeroWeighted]))).toThrow(SelectionEngineError);
  });

  it("rejects the explicitly prohibited RANDOMIZED strategy type", () => {
    const randomized: ConfiguredSelectionStrategy = {
      ...fairnessStrategy("s-random"),
      strategyType: "RANDOMIZED",
    };
    expect(() => buildDutyEngineContext(withStrategies([randomized]))).toThrow(SelectionEngineError);
  });

  it("falls back to a working strategy when the primary cannot produce an order (missing rotation facts)", () => {
    const rotation: ConfiguredSelectionStrategy = {
      id: "s-rotation",
      strategyType: "SEQUENTIAL_ROTATION",
      name: "Sıra",
      enabled: true,
      priority: 1,
      scope: {},
      parameters: { useCarriedForwardPriority: false },
      validFrom: null,
      validTo: null,
      source: "ORGANIZATION_CONFIGURED",
      version: 1,
      fallbackStrategyIds: [fairnessStrategy("s-fairness-fallback").id],
      tieBreakers: [],
      metadata: {},
    };
    const result = buildDutyEngineContext(
      withStrategies([rotation, fairnessStrategy("s-fairness-fallback")])
    );
    const slot = result.provisionalSelections[0];
    expect(slot.unresolved).toBe(false);
    expect(slot.selectedCandidateKeys.length).toBe(1);
  });

  it("two runs with identical input produce byte-identical draft results (determinism)", () => {
    const a = buildDutyEngineContext(withStrategies([fairnessStrategy()]));
    const b = buildDutyEngineContext(withStrategies([fairnessStrategy()]));
    expect(canonicalSerialize(a)).toBe(canonicalSerialize(b));
  });
});
