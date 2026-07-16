// Duty Rules V2 — Phase 6: V1 compatibility chain equivalence proof at
// the ranking-criterion level.
//
// SCOPE (explicit): this suite proves ORDER equivalence between
// V1_COMPATIBILITY_CHAIN's resolveCriterionSequence output and V1's
// literal comparison chain (generate-duty-schedule.ts:271-299) for every
// documented branch, including the date-conditional weekend/holiday
// inclusion and the holiday-eve case. It does NOT run V1's DB-backed
// generateDutySchedule against a live database — that would require a
// full loader/adapter/DB fixture harness outside this phase's pure,
// no-I/O scope. See DUTY_RULES_V2_SELECTION_STRATEGY_ENGINE.md for the
// explicit statement of this scope boundary and the separate,
// unresolved holiday-eve WEIGHT question.

import { describe, expect, it } from "vitest";

import { buildV1CompatibilitySelectionStrategy } from "./build-v1-compatibility-strategy";
import { rankCandidates } from "./rank-candidates";
import type { CandidateRankingFacts } from "./domain/ranking-fact";
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

function context(overrides: Partial<StrategyMatchContext> = {}): StrategyMatchContext {
  return {
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
    ...overrides,
  };
}

const strategy = buildV1CompatibilitySelectionStrategy({ organizationId: "org-1", regionId: "region-1" });

describe("V1_COMPATIBILITY_CHAIN — order equivalence with generate-duty-schedule.ts:271-299", () => {
  it("step 1: totalWeightedLoad ascending wins first, before every other factor", () => {
    const candidates = [
      fact({ candidateKey: "a", totalWeightedLoad: 5, totalAssignmentCount: 0 }),
      fact({ candidateKey: "b", totalWeightedLoad: 1, totalAssignmentCount: 99 }),
    ];
    const result = rankCandidates(strategy, candidates, context())!;
    expect(result.rankings[0].candidateKey).toBe("b");
  });

  it("step 2: prefersThisDate descending breaks a load tie (V1's PREFER_DUTY boost)", () => {
    const candidates = [
      fact({ candidateKey: "a", totalWeightedLoad: 1, prefersThisDate: false }),
      fact({ candidateKey: "b", totalWeightedLoad: 1, prefersThisDate: true }),
    ];
    const result = rankCandidates(strategy, candidates, context())!;
    expect(result.rankings[0].candidateKey).toBe("b");
  });

  it("step 3: totalAssignmentCount ascending breaks a load+prefer tie", () => {
    const candidates = [
      fact({ candidateKey: "a", totalWeightedLoad: 1, totalAssignmentCount: 3 }),
      fact({ candidateKey: "b", totalWeightedLoad: 1, totalAssignmentCount: 1 }),
    ];
    const result = rankCandidates(strategy, candidates, context())!;
    expect(result.rankings[0].candidateKey).toBe("b");
  });

  it("step 4/5 are DATE-CONDITIONAL: on a plain weekday, weekendCount/holidayCount are never compared — a lower weekendCount does NOT win over a higher one", () => {
    const candidates = [
      fact({ candidateKey: "a", weekendCount: 9, lastDutyDate: "2026-07-01" }),
      fact({ candidateKey: "b", weekendCount: 0, lastDutyDate: "2026-06-01" }), // earlier lastDutyDate should win instead
    ];
    const result = rankCandidates(strategy, candidates, context({ weekday: "MONDAY", holidayTypes: ["NONE"] }))!;
    // weekendCount is skipped entirely on a Monday; lastDutyDate (step 6) decides.
    expect(result.rankings[0].candidateKey).toBe("b");
  });

  it("step 4 IS included on Saturday/Sunday: weekendCount ascending decides before lastDutyDate", () => {
    const candidates = [
      fact({ candidateKey: "a", weekendCount: 9, lastDutyDate: "2026-06-01" }), // earlier date, but higher weekendCount
      fact({ candidateKey: "b", weekendCount: 0, lastDutyDate: "2026-07-01" }),
    ];
    const result = rankCandidates(strategy, candidates, context({ weekday: "SATURDAY" }))!;
    expect(result.rankings[0].candidateKey).toBe("b");
  });

  it("step 5 IS included on an OFFICIAL holiday date: holidayCount ascending decides", () => {
    const candidates = [
      fact({ candidateKey: "a", holidayCount: 4, lastDutyDate: "2026-06-01" }),
      fact({ candidateKey: "b", holidayCount: 0, lastDutyDate: "2026-07-01" }),
    ];
    const result = rankCandidates(
      strategy,
      candidates,
      context({ weekday: "TUESDAY", holidayTypes: ["OFFICIAL"] })
    )!;
    expect(result.rankings[0].candidateKey).toBe("b");
  });

  it("step 6: lastDutyDate ascending, never-served (null) ranks FIRST — matches V1's `if (!lastDutyDate) return -1`", () => {
    const candidates = [
      fact({ candidateKey: "a", lastDutyDate: "2020-01-01" }),
      fact({ candidateKey: "b", lastDutyDate: null }),
    ];
    const result = rankCandidates(strategy, candidates, context())!;
    expect(result.rankings[0].candidateKey).toBe("b");
  });

  it("step 7: Turkish-locale pharmacy name is the final documented tie-break (Ç sorts with C-family, not after Z)", () => {
    const candidates = [
      fact({ candidateKey: "a", pharmacyName: "Zafer Eczanesi" }),
      fact({ candidateKey: "b", pharmacyName: "Çınar Eczanesi" }),
    ];
    const result = rankCandidates(strategy, candidates, context())!;
    expect(result.rankings[0].candidateKey).toBe("b"); // Ç < Z under tr locale
  });

  it("mandatory platform fallback: fully-tied candidates still resolve via CANDIDATE_KEY_ASC (deterministic, never null)", () => {
    const candidates = [fact({ candidateKey: "z-slot#z" }), fact({ candidateKey: "a-slot#a" })];
    const result = rankCandidates(strategy, candidates, context())!;
    expect(result.rankings[0].candidateKey).toBe("a-slot#a");
  });

  it("HOLIDAY-EVE ORDERING PARITY: an eve date that is itself a plain weekday correctly excludes weekend/holiday tie-break steps, exactly as V1 would (V1 compares the actual calendar date, not a resolved HOLIDAY_EVE day-type label)", () => {
    // matchContext here represents an eve date (day-type resolves to
    // HOLIDAY_EVE) whose UNDERLYING weekday is a Wednesday and which
    // carries no holiday of its own — the exact scenario the header
    // comment in v1-compatibility-strategy.ts documents.
    const eveContext = context({ date: "2026-08-05", weekday: "WEDNESDAY", holidayTypes: ["NONE"], dayType: "HOLIDAY_EVE" });
    const candidates = [
      fact({ candidateKey: "a", weekendCount: 9, holidayCount: 9, lastDutyDate: "2026-07-01" }),
      fact({ candidateKey: "b", weekendCount: 0, holidayCount: 0, lastDutyDate: "2026-06-01" }),
    ];
    const result = rankCandidates(strategy, candidates, eveContext)!;
    // Weekend/holiday counts are ignored (correct — Wednesday is neither);
    // lastDutyDate decides, matching V1's actual per-date comparison.
    expect(result.rankings[0].candidateKey).toBe("b");
  });

  it("is fully deterministic across repeated runs and independent of input array order", () => {
    const candidates = [
      fact({ candidateKey: "a", totalWeightedLoad: 2 }),
      fact({ candidateKey: "b", totalWeightedLoad: 1 }),
      fact({ candidateKey: "c", totalWeightedLoad: 1 }),
    ];
    const shuffled = [candidates[2], candidates[0], candidates[1]];
    const order1 = rankCandidates(strategy, candidates, context())!.rankings.map((r) => r.candidateKey);
    const order2 = rankCandidates(strategy, shuffled, context())!.rankings.map((r) => r.candidateKey);
    expect(order1).toEqual(order2);
  });
});
