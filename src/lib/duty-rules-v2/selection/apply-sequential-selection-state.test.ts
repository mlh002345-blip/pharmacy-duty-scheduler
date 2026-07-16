// Duty Rules V2 — Phase 6 corrective: unit tests for the sequential
// provisional-selection accumulator (isolated from the full golden
// harness, which exercises it end-to-end).

import { describe, expect, it } from "vitest";

import {
  applyAccumulatorToFacts,
  updateAccumulatorWithSelection,
  type SequentialAccumulator,
} from "./apply-sequential-selection-state";
import type { CandidateRankingFacts } from "./domain/ranking-fact";
import type { ProvisionalSlotSelection } from "./domain/selection-result";

function fact(overrides: Partial<CandidateRankingFacts> & { candidateKey: string }): CandidateRankingFacts {
  return {
    pharmacyId: overrides.candidateKey,
    pharmacyName: overrides.candidateKey,
    origin: "STRICT",
    totalWeightedLoad: 0,
    projectedLoadIfAssigned: 1,
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

describe("applyAccumulatorToFacts", () => {
  it("is a no-op when the accumulator has nothing for a pharmacy", () => {
    const facts = [fact({ candidateKey: "a" })];
    const result = applyAccumulatorToFacts(facts, new Map(), "2026-09-05");
    expect(result[0]).toEqual(facts[0]);
  });

  it("folds accumulated weight/count/weekend/holiday into the fact", () => {
    const facts = [
      fact({ candidateKey: "a", totalWeightedLoad: 5, projectedLoadIfAssigned: 6, totalAssignmentCount: 2 }),
    ];
    const accumulator: SequentialAccumulator = new Map([
      [
        "a",
        { addedWeight: 3, addedAssignmentCount: 2, addedWeekendCount: 1, addedHolidayCount: 1, newestLastDutyDate: "2026-09-01" },
      ],
    ]);
    const [adjusted] = applyAccumulatorToFacts(facts, accumulator, "2026-09-05");
    expect(adjusted.totalWeightedLoad).toBe(8); // 5 + 3
    expect(adjusted.projectedLoadIfAssigned).toBe(9); // 8 + (6-5)
    expect(adjusted.totalAssignmentCount).toBe(4); // 2 + 2
    expect(adjusted.weekendCount).toBe(1);
    expect(adjusted.holidayCount).toBe(1);
    expect(adjusted.lastDutyDate).toBe("2026-09-01");
    expect(adjusted.daysSinceLastDuty).toBe(4); // 09-05 - 09-01
  });

  it("keeps the more recent lastDutyDate between Phase 4's fact and the accumulator", () => {
    const facts = [fact({ candidateKey: "a", lastDutyDate: "2026-09-03" })];
    const accumulator: SequentialAccumulator = new Map([
      ["a", { addedWeight: 1, addedAssignmentCount: 1, addedWeekendCount: 0, addedHolidayCount: 0, newestLastDutyDate: "2026-09-01" }],
    ]);
    const [adjusted] = applyAccumulatorToFacts(facts, accumulator, "2026-09-05");
    // Phase 4's OWN lastDutyDate (09-03, from history/existing
    // assignments) is more recent than the accumulator's in-run date
    // (09-01) in this constructed case — the more recent of the two wins.
    expect(adjusted.lastDutyDate).toBe("2026-09-03");
  });
});

describe("updateAccumulatorWithSelection", () => {
  const facts: CandidateRankingFacts[] = [
    fact({ candidateKey: "slot#a", pharmacyId: "ph-a", totalWeightedLoad: 0, projectedLoadIfAssigned: 1.25 }),
  ];
  const selection: ProvisionalSlotSelection = {
    slotKey: "slot",
    date: "2026-09-05",
    requiredCount: 1,
    strategyId: "s-1",
    strategyType: "FAIRNESS_LEAST_LOAD",
    selectedCandidateKeys: ["slot#a"],
    rankings: [],
    fallbackChainTrace: [],
    underfilled: false,
    unresolved: false,
    diagnostics: [],
  };

  it("does not mutate the input accumulator (pure)", () => {
    const before: SequentialAccumulator = new Map();
    const after = updateAccumulatorWithSelection(before, selection, facts, true, false);
    expect(before.size).toBe(0);
    expect(after.size).toBe(1);
  });

  it("records added weight (the slot's dateWeight), assignment count, and weekend/holiday flags", () => {
    const after = updateAccumulatorWithSelection(new Map(), selection, facts, true, false);
    const entry = after.get("ph-a")!;
    expect(entry.addedWeight).toBe(1.25);
    expect(entry.addedAssignmentCount).toBe(1);
    expect(entry.addedWeekendCount).toBe(1);
    expect(entry.addedHolidayCount).toBe(0);
    expect(entry.newestLastDutyDate).toBe("2026-09-05");
  });

  it("accumulates across repeated calls for the same pharmacy", () => {
    let acc: SequentialAccumulator = new Map();
    acc = updateAccumulatorWithSelection(acc, selection, facts, false, true);
    acc = updateAccumulatorWithSelection(
      acc,
      { ...selection, date: "2026-09-10" },
      facts,
      false,
      false
    );
    const entry = acc.get("ph-a")!;
    expect(entry.addedWeight).toBe(2.5);
    expect(entry.addedAssignmentCount).toBe(2);
    expect(entry.addedHolidayCount).toBe(1);
    expect(entry.newestLastDutyDate).toBe("2026-09-10"); // most recent call wins
  });

  it("is a no-op when nothing was selected", () => {
    const empty: SequentialAccumulator = new Map();
    const result = updateAccumulatorWithSelection(
      empty,
      { ...selection, selectedCandidateKeys: [] },
      facts,
      true,
      true
    );
    expect(result).toBe(empty); // same reference: genuinely a no-op
  });
});
