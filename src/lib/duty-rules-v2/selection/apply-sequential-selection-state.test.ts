// Duty Rules V2 — Phase 6 corrective (round 2): unit tests for the
// sequential provisional-selection accumulator (isolated from the full
// golden harness and the multi-slot regression suite, which exercise it
// end-to-end).

import { describe, expect, it } from "vitest";

import {
  applyAccumulatorToFacts,
  resolveSequentialCandidateSet,
  selectProvisionalWinnersSequential,
  updateAccumulatorWithSelection,
  type SequentialAccumulator,
  type SequentialSlotInput,
} from "./apply-sequential-selection-state";
import { buildV1CompatibilitySelectionStrategy } from "./build-v1-compatibility-strategy";
import { SelectionEngineError } from "./strategy-errors";
import type { CandidateRankingFacts } from "./domain/ranking-fact";
import type { ProvisionalSlotSelection } from "./domain/selection-result";
import type { SelectionInput } from "../engine/build-selection-input";

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

  it("folds accumulated weight/count/weekend/sunday/holiday into the fact", () => {
    const facts = [
      fact({ candidateKey: "a", totalWeightedLoad: 5, projectedLoadIfAssigned: 6, totalAssignmentCount: 2 }),
    ];
    const accumulator: SequentialAccumulator = new Map([
      [
        "a",
        {
          addedWeight: 3,
          addedAssignmentCount: 2,
          addedWeekendCount: 1,
          addedSundayCount: 1,
          addedHolidayCount: 1,
          newestLastDutyDate: "2026-09-01",
        },
      ],
    ]);
    const [adjusted] = applyAccumulatorToFacts(facts, accumulator, "2026-09-05");
    expect(adjusted.totalWeightedLoad).toBe(8); // 5 + 3
    expect(adjusted.projectedLoadIfAssigned).toBe(9); // 8 + (6-5)
    expect(adjusted.totalAssignmentCount).toBe(4); // 2 + 2
    expect(adjusted.weekendCount).toBe(1);
    expect(adjusted.sundayCount).toBe(1);
    expect(adjusted.holidayCount).toBe(1);
    expect(adjusted.lastDutyDate).toBe("2026-09-01");
    expect(adjusted.daysSinceLastDuty).toBe(4); // 09-05 - 09-01
  });

  it("keeps the more recent lastDutyDate between Phase 4's fact and the accumulator", () => {
    const facts = [fact({ candidateKey: "a", lastDutyDate: "2026-09-03" })];
    const accumulator: SequentialAccumulator = new Map([
      [
        "a",
        {
          addedWeight: 1,
          addedAssignmentCount: 1,
          addedWeekendCount: 0,
          addedSundayCount: 0,
          addedHolidayCount: 0,
          newestLastDutyDate: "2026-09-01",
        },
      ],
    ]);
    const [adjusted] = applyAccumulatorToFacts(facts, accumulator, "2026-09-05");
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
    const after = updateAccumulatorWithSelection(before, selection, facts, true, false, false);
    expect(before.size).toBe(0);
    expect(after.size).toBe(1);
  });

  it("records added weight (the slot's dateWeight), assignment count, and weekend/sunday/holiday flags", () => {
    const after = updateAccumulatorWithSelection(new Map(), selection, facts, true, true, false);
    const entry = after.get("ph-a")!;
    expect(entry.addedWeight).toBe(1.25);
    expect(entry.addedAssignmentCount).toBe(1);
    expect(entry.addedWeekendCount).toBe(1);
    expect(entry.addedSundayCount).toBe(1);
    expect(entry.addedHolidayCount).toBe(0);
    expect(entry.newestLastDutyDate).toBe("2026-09-05");
  });

  it("accumulates across repeated calls for the same pharmacy", () => {
    let acc: SequentialAccumulator = new Map();
    acc = updateAccumulatorWithSelection(acc, selection, facts, false, false, true);
    acc = updateAccumulatorWithSelection(acc, { ...selection, date: "2026-09-10" }, facts, false, false, false);
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
      false,
      true
    );
    expect(result).toBe(empty); // same reference: genuinely a no-op
  });
});

function selectionInput(overrides: Partial<SelectionInput> & { slotKey: string; date: string }): SelectionInput {
  const candidateKey = `${overrides.slotKey}#m-a`;
  return {
    slot: {
      slotKey: overrides.slotKey,
      date: overrides.date,
      dayTypeKey: "WEEKDAY",
      dayTypeRuleId: "dtr-1",
      shiftId: "shift-1",
      shiftKey: "shift-1",
      poolId: "pool-1",
      requiredCount: 1,
      sortOrder: 0,
      slotId: "slot-1",
      slotName: null,
      resolvable: true,
    } as SelectionInput["slot"],
    requiredCount: 1,
    strategy: "FAIRNESS_SCORE",
    candidates: [
      {
        candidateKey,
        pharmacyId: "ph-a",
        pharmacyName: "Ada Eczanesi",
      } as SelectionInput["candidates"][number],
    ],
    eligibility: [],
    relaxation: {
      slotKey: overrides.slotKey,
      date: overrides.date,
      requiredCount: 1,
      strictEligible: [candidateKey],
      relaxedEligible: [],
      relaxationApplied: false,
      relaxedConstraintCodes: [],
      diagnostics: [],
    },
    fairnessFacts: [{ candidateKey, pharmacyId: "ph-a", lastDutyDate: null } as SelectionInput["fairnessFacts"][number]],
    rotationFacts: [],
    ruleEvaluations: [],
    diagnostics: [],
    provenance: {} as SelectionInput["provenance"],
    relaxableReasonCodes: ["MIN_DAYS_INTERVAL"],
    ...overrides,
  };
}

describe("resolveSequentialCandidateSet — same-day exclusion (B1 fix)", () => {
  it("excludes a pharmacy already picked earlier THIS date when sameDaySecondAssignmentAllowed is false", () => {
    const input = selectionInput({ slotKey: "2026-09-05:WEEKDAY:shift-1:1", date: "2026-09-05" });
    const accumulator: SequentialAccumulator = new Map([
      [
        "ph-a",
        {
          addedWeight: 1,
          addedAssignmentCount: 1,
          addedWeekendCount: 0,
          addedSundayCount: 0,
          addedHolidayCount: 0,
          newestLastDutyDate: "2026-09-05", // picked earlier TODAY
        },
      ],
    ]);
    const { origin, sameDayExcludedPharmacyIds } = resolveSequentialCandidateSet(
      input,
      accumulator,
      0,
      false,
      true
    );
    expect(origin.size).toBe(0);
    expect(sameDayExcludedPharmacyIds).toEqual(["ph-a"]);
  });

  it("does NOT exclude when sameDaySecondAssignmentAllowed is true", () => {
    const input = selectionInput({ slotKey: "2026-09-05:WEEKDAY:shift-1:1", date: "2026-09-05" });
    const accumulator: SequentialAccumulator = new Map([
      [
        "ph-a",
        {
          addedWeight: 1,
          addedAssignmentCount: 1,
          addedWeekendCount: 0,
          addedSundayCount: 0,
          addedHolidayCount: 0,
          newestLastDutyDate: "2026-09-05",
        },
      ],
    ]);
    const { origin, sameDayExcludedPharmacyIds } = resolveSequentialCandidateSet(
      input,
      accumulator,
      0,
      true,
      true
    );
    expect(origin.size).toBe(1);
    expect(sameDayExcludedPharmacyIds).toEqual([]);
  });

  it("does NOT exclude a pharmacy picked on a DIFFERENT (earlier) date", () => {
    const input = selectionInput({ slotKey: "2026-09-06:WEEKDAY:shift-1:1", date: "2026-09-06" });
    const accumulator: SequentialAccumulator = new Map([
      [
        "ph-a",
        {
          addedWeight: 1,
          addedAssignmentCount: 1,
          addedWeekendCount: 0,
          addedSundayCount: 0,
          addedHolidayCount: 0,
          newestLastDutyDate: "2026-09-05", // yesterday, not today
        },
      ],
    ]);
    const { origin, sameDayExcludedPharmacyIds } = resolveSequentialCandidateSet(
      input,
      accumulator,
      0,
      false,
      true
    );
    expect(origin.size).toBe(1);
    expect(sameDayExcludedPharmacyIds).toEqual([]);
  });
});

describe("resolveSequentialCandidateSet — configured-relaxable-rule boundary (Part 8, Option B)", () => {
  it("a candidate Phase 4/5 placed in relaxedEligible for a NON-interval reason is never promoted to strict, even though it trivially passes the interval check", () => {
    // MIN_DAYS_BETWEEN_ASSIGNMENTS is currently the ONLY relaxable rule
    // type in the whole catalogue, so this scenario is constructed
    // directly (a candidate absent from strictEligible, present in
    // relaxedEligible, with a lastDutyDate that would trivially satisfy
    // the interval on its own) rather than via a second real relaxable
    // rule type — proving the code's SCOPE boundary holds regardless of
    // whether such a rule exists today.
    const input = selectionInput({
      slotKey: "2026-09-05:WEEKDAY:shift-1:0",
      date: "2026-09-05",
      relaxation: {
        slotKey: "2026-09-05:WEEKDAY:shift-1:0",
        date: "2026-09-05",
        requiredCount: 1,
        strictEligible: [], // Phase 4/5 did NOT consider this candidate strict
        relaxedEligible: ["2026-09-05:WEEKDAY:shift-1:0#m-a"],
        relaxationApplied: true,
        relaxedConstraintCodes: ["SOME_OTHER_CONFIGURED_RELAXABLE_RULE"],
        diagnostics: [],
      },
      fairnessFacts: [
        {
          candidateKey: "2026-09-05:WEEKDAY:shift-1:0#m-a",
          pharmacyId: "ph-a",
          lastDutyDate: null, // would trivially pass ANY interval check
        } as SelectionInput["fairnessFacts"][number],
      ],
    });
    const { origin } = resolveSequentialCandidateSet(input, new Map(), 0, true, true);
    expect(origin.get("2026-09-05:WEEKDAY:shift-1:0#m-a")).toBe("RELAXED");
  });
});

const STRATEGY = buildV1CompatibilitySelectionStrategy({ organizationId: "org-1", regionId: "region-1" });
const DEFINITIONS_BY_ID = new Map([[STRATEGY.id, STRATEGY]]);

function slotInput(slotKey: string, date: string, weekday: SequentialSlotInput["matchContextBase"]["weekday"]): SequentialSlotInput {
  return {
    selectionInput: selectionInput({ slotKey, date }),
    matchContextBase: {
      organizationId: "org-1",
      regionId: "region-1",
      planId: "plan-1",
      planVersionId: "pv-1",
      generationMode: "PREVIEW",
      date,
      weekday,
      holidayTypes: ["NONE"],
      dayType: "WEEKDAY",
      customDayCategory: null,
    },
    isWeekendDate: false,
    isSundayDate: false,
    isHolidayDate: false,
  };
}

describe("selectProvisionalWinnersSequential — chronological-order safety (Part 3)", () => {
  it("normalizes REVERSED date input to the same result as forward order", () => {
    const forward = [
      slotInput("2026-09-01:WEEKDAY:shift-1:0", "2026-09-01", "TUESDAY"),
      slotInput("2026-09-02:WEEKDAY:shift-1:0", "2026-09-02", "WEDNESDAY"),
    ];
    const reversed = [...forward].reverse();
    const a = selectProvisionalWinnersSequential({
      slots: forward,
      minDaysBetweenDuties: 0,
      sameDaySecondAssignmentAllowed: true,
      relaxMinIntervalWhenInsufficient: true,
      definitions: [STRATEGY],
      definitionsById: DEFINITIONS_BY_ID,
    });
    const b = selectProvisionalWinnersSequential({
      slots: reversed,
      minDaysBetweenDuties: 0,
      sameDaySecondAssignmentAllowed: true,
      relaxMinIntervalWhenInsufficient: true,
      definitions: [STRATEGY],
      definitionsById: DEFINITIONS_BY_ID,
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("normalizes SHUFFLED same-date slot input deterministically", () => {
    const slots = [
      slotInput("2026-09-01:WEEKDAY:shift-2:1", "2026-09-01", "TUESDAY"),
      slotInput("2026-09-01:WEEKDAY:shift-1:0", "2026-09-01", "TUESDAY"),
    ];
    const result = selectProvisionalWinnersSequential({
      slots,
      minDaysBetweenDuties: 0,
      sameDaySecondAssignmentAllowed: true,
      relaxMinIntervalWhenInsufficient: true,
      definitions: [STRATEGY],
      definitionsById: DEFINITIONS_BY_ID,
    });
    // Output order must be chronological/slotKey-ascending regardless of
    // input order.
    expect(result.map((r) => r.slotKey)).toEqual([
      "2026-09-01:WEEKDAY:shift-1:0",
      "2026-09-01:WEEKDAY:shift-2:1",
    ]);
  });

  it("rejects a DUPLICATE slotKey with a typed error rather than silently deduplicating", () => {
    const slots = [
      slotInput("2026-09-01:WEEKDAY:shift-1:0", "2026-09-01", "TUESDAY"),
      slotInput("2026-09-01:WEEKDAY:shift-1:0", "2026-09-01", "TUESDAY"),
    ];
    expect(() =>
      selectProvisionalWinnersSequential({
        slots,
        minDaysBetweenDuties: 0,
        sameDaySecondAssignmentAllowed: true,
        relaxMinIntervalWhenInsufficient: true,
        definitions: [STRATEGY],
        definitionsById: DEFINITIONS_BY_ID,
      })
    ).toThrow(SelectionEngineError);
  });
});
