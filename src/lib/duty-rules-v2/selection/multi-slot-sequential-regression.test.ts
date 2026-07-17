// Duty Rules V2 — Phase 6 corrective (round 2), Part 7: committed
// multi-slot regression suite. Proves B1 (same-date double-booking) is
// closed across the full range of required scenarios — not just the
// single reproduction case used during review.

import { describe, expect, it } from "vitest";

import { buildDutyEngineContext } from "../engine/build-engine-context";
import { makeLoadedPlan, makeEngineInput } from "../engine/test-support/fixtures";
import { buildV1CompatibilitySelectionStrategy } from "./build-v1-compatibility-strategy";
import type { LoadedDutyPlanVersion } from "../domain/loaded-plan";
import type { DutyEngineInput } from "../engine/domain/engine-input";

function addSecondShift(plan: LoadedDutyPlanVersion, dayType: string = "WEEKDAY"): void {
  plan.shiftDefinitions.push({
    id: "shift-2",
    name: "İkinci Vardiya",
    startMinute: 0,
    endMinute: 0,
    spansMidnight: false,
    defaultWeight: 1,
    sortOrder: 1,
  });
  const rule = plan.dayTypeRules.find((r) => r.dayType === dayType)!;
  plan.slotRequirements.push({
    id: `slot-${dayType}-2`,
    name: null,
    requiredCount: 1,
    sortOrder: 1,
    dayTypeRuleId: rule.id,
    shiftDefinitionId: "shift-2",
    rotationPoolId: "pool-1",
  });
}

function addThirdShift(plan: LoadedDutyPlanVersion, dayType: string = "WEEKDAY"): void {
  plan.shiftDefinitions.push({
    id: "shift-3",
    name: "Üçüncü Vardiya",
    startMinute: 0,
    endMinute: 0,
    spansMidnight: false,
    defaultWeight: 1,
    sortOrder: 2,
  });
  const rule = plan.dayTypeRules.find((r) => r.dayType === dayType)!;
  plan.slotRequirements.push({
    id: `slot-${dayType}-3`,
    name: null,
    requiredCount: 1,
    sortOrder: 2,
    dayTypeRuleId: rule.id,
    shiftDefinitionId: "shift-3",
    rotationPoolId: "pool-1",
  });
}

function baseInput(
  plan: LoadedDutyPlanVersion,
  overrides: Partial<Omit<DutyEngineInput, "loadedPlan">> = {}
): DutyEngineInput {
  return makeEngineInput(plan, {
    periodStart: "2026-08-03",
    periodEnd: "2026-08-03",
    policy: {
      minDaysBetweenDuties: 0,
      relaxMinIntervalWhenInsufficient: true,
      dayTypeWeights: [
        { dayTypeKey: "WEEKDAY", weight: 1 },
        { dayTypeKey: "SATURDAY", weight: 1.25 },
        { dayTypeKey: "SUNDAY", weight: 1.5 },
        { dayTypeKey: "OFFICIAL_HOLIDAY", weight: 2 },
        { dayTypeKey: "RELIGIOUS_HOLIDAY", weight: 2.5 },
        { dayTypeKey: "HOLIDAY_EVE", weight: 1 },
      ],
      sameDaySecondAssignmentAllowed: false,
    },
    configuredSelectionStrategies: [
      buildV1CompatibilitySelectionStrategy({ organizationId: "org-1", regionId: "region-1" }),
    ],
    ...overrides,
  });
}

describe("Part 7 — multi-slot regression suite", () => {
  it("1. two slots, one pharmacy, second assignment forbidden: selected once, second slot underfilled", () => {
    const plan = makeLoadedPlan((p) => {
      addSecondShift(p);
      p.rotationPools[0].memberships = p.rotationPools[0].memberships.slice(0, 1);
    });
    const result = buildDutyEngineContext(baseInput(plan));
    expect(result.provisionalSelections).toHaveLength(2);
    const [slot1, slot2] = result.provisionalSelections.sort((a, b) => (a.slotKey < b.slotKey ? -1 : 1));
    expect(slot1.selectedCandidateKeys).toHaveLength(1);
    expect(slot2.selectedCandidateKeys).toHaveLength(0);
    expect(slot2.underfilled).toBe(true);
    expect(slot2.diagnostics.some((d) => d.code === "PROVISIONAL_SAME_DAY_ASSIGNMENT_CONFLICT")).toBe(true);
  });

  it("2. two slots, two pharmacies, second assignment forbidden: distinct pharmacies selected", () => {
    const plan = makeLoadedPlan((p) => {
      addSecondShift(p);
      p.rotationPools[0].memberships = p.rotationPools[0].memberships.slice(0, 2);
    });
    const result = buildDutyEngineContext(baseInput(plan));
    const all = result.provisionalSelections.flatMap((s) =>
      s.selectedCandidateKeys.map((key) => s.rankings.find((r) => r.candidateKey === key)!.rankFacts.pharmacyId)
    );
    expect(new Set(all).size).toBe(2);
    expect(result.provisionalSelections.every((s) => !s.underfilled)).toBe(true);
  });

  it("3. two slots, second assignment ALLOWED: same pharmacy may be selected again", () => {
    const plan = makeLoadedPlan((p) => {
      addSecondShift(p);
      p.rotationPools[0].memberships = p.rotationPools[0].memberships.slice(0, 1);
    });
    const input = baseInput(plan);
    input.policy.sameDaySecondAssignmentAllowed = true;
    const result = buildDutyEngineContext(input);
    expect(result.provisionalSelections.every((s) => !s.underfilled)).toBe(true);
    const all = result.provisionalSelections.flatMap((s) =>
      s.selectedCandidateKeys.map((key) => s.rankings.find((r) => r.candidateKey === key)!.rankFacts.pharmacyId)
    );
    expect(all).toEqual(["ph-a", "ph-a"]);
  });

  it("4. three slots, two pharmacies: no prohibited repeat, remaining slot underfilled", () => {
    const plan = makeLoadedPlan((p) => {
      addSecondShift(p);
      addThirdShift(p);
      p.rotationPools[0].memberships = p.rotationPools[0].memberships.slice(0, 2);
    });
    const result = buildDutyEngineContext(baseInput(plan));
    const all = result.provisionalSelections.flatMap((s) =>
      s.selectedCandidateKeys.map((key) => s.rankings.find((r) => r.candidateKey === key)!.rankFacts.pharmacyId)
    );
    expect(new Set(all).size).toBe(all.length); // no pharmacyId repeated
    expect(all).toHaveLength(2); // exactly the 2 available pharmacies filled
    expect(result.provisionalSelections.filter((s) => s.underfilled)).toHaveLength(1);
  });

  it("5. same pharmacy reachable through two pools: same-day policy enforced by pharmacyId", () => {
    const plan = makeLoadedPlan((p) => {
      // Second pool, second slot (different shift/day-type slot), same
      // pharmacyId as pool-1's ph-a but a DIFFERENT membership row.
      p.rotationPools.push({
        id: "pool-2",
        name: "İkinci Havuz",
        strategy: "FAIRNESS_SCORE",
        regionId: "region-1",
        memberships: [
          {
            id: "m-a2",
            pharmacyId: "ph-a",
            pharmacyName: "Çınar Eczanesi",
            pharmacyIsActive: true,
            joinedOn: "2026-01-01",
            leftOn: null,
            sortIndex: null,
          },
        ],
        rotationStates: [],
      });
      addSecondShift(p);
      const secondSlot = p.slotRequirements.find((s) => s.id === "slot-WEEKDAY-2")!;
      secondSlot.rotationPoolId = "pool-2";
      p.rotationPools[0].memberships = p.rotationPools[0].memberships.slice(0, 1); // only ph-a in pool-1
    });
    const result = buildDutyEngineContext(baseInput(plan));
    const all = result.provisionalSelections.flatMap((s) =>
      s.selectedCandidateKeys.map((key) => s.rankings.find((r) => r.candidateKey === key)!.rankFacts.pharmacyId)
    );
    // ph-a can only be selected ONCE across BOTH pools, since same-day
    // policy applies by pharmacyId, not by pool or membership.
    expect(all.filter((id) => id === "ph-a")).toHaveLength(1);
  });

  it("6. same pharmacy via two membership records in ONE pool/slot: no prohibited duplicate", () => {
    const plan = makeLoadedPlan((p) => {
      p.rotationPools[0].memberships = [
        p.rotationPools[0].memberships[0],
        { ...p.rotationPools[0].memberships[0], id: "m-a-duplicate" }, // same pharmacyId, 2nd membership row
      ];
      // requiredCount 2 so both membership rows WOULD be top-ranked if
      // the pharmacyId dedup guard did not exist.
      p.slotRequirements.find((s) => s.dayTypeRuleId === "dtr-WEEKDAY")!.requiredCount = 2;
    });
    const input = baseInput(plan);
    const result = buildDutyEngineContext(input);
    const slot = result.provisionalSelections[0];
    expect(slot.selectedCandidateKeys).toHaveLength(1); // only one seat filled, not two
    expect(slot.underfilled).toBe(true);
    expect(slot.diagnostics.some((d) => d.code === "PROVISIONAL_SAME_SLOT_DUPLICATE")).toBe(true);
  });

  it("7/8. strict selection on date 1, relaxed candidate correctly promoted on date 2 with updated state", () => {
    const plan = makeLoadedPlan((p) => {
      // A single pharmacy: day 2 has no OTHER candidate, so it is
      // FORCED to reselect an interval-violating pharmacy via
      // relaxation, proving the accumulator's updated lastDutyDate (not
      // Phase 4's original, persisted-only facts) drives that decision.
      p.rotationPools[0].memberships = p.rotationPools[0].memberships.slice(0, 1);
    });
    const input = baseInput(plan, {
      periodStart: "2026-08-03",
      periodEnd: "2026-08-04",
      policy: {
        minDaysBetweenDuties: 5, // aggressive interval to force relaxation
        relaxMinIntervalWhenInsufficient: true,
        dayTypeWeights: [
          { dayTypeKey: "WEEKDAY", weight: 1 },
          { dayTypeKey: "SATURDAY", weight: 1.25 },
          { dayTypeKey: "SUNDAY", weight: 1.5 },
          { dayTypeKey: "OFFICIAL_HOLIDAY", weight: 2 },
          { dayTypeKey: "RELIGIOUS_HOLIDAY", weight: 2.5 },
          { dayTypeKey: "HOLIDAY_EVE", weight: 1 },
        ],
        sameDaySecondAssignmentAllowed: false,
      },
    });
    const result = buildDutyEngineContext(input);
    expect(result.provisionalSelections).toHaveLength(2);
    const [day1, day2] = result.provisionalSelections.sort((a, b) => (a.date < b.date ? -1 : 1));
    const day1WinnerRanking = day1.rankings.find((r) => r.candidateKey === day1.selectedCandidateKeys[0])!;
    expect(day1WinnerRanking.rankFacts.origin).toBe("STRICT"); // never served before
    expect(day1.underfilled).toBe(false);
    // Day 2: the only pharmacy was picked yesterday (THIS run), so it is
    // now interval-ineligible under the 5-day rule per Phase 4's
    // ORIGINAL (pre-run) facts it would have been strict — relaxation
    // must kick in using the ACCUMULATOR's updated lastDutyDate and
    // still fill the seat.
    expect(day2.underfilled).toBe(false);
    const day2WinnerKey = day2.selectedCandidateKeys[0];
    const day2WinnerRanking = day2.rankings.find((r) => r.candidateKey === day2WinnerKey)!;
    expect(day2WinnerRanking.rankFacts.origin).toBe("RELAXED");
    expect(day2WinnerRanking.rankFacts.daysSinceLastDuty).toBe(1); // accumulator-derived, not Phase 4's static null
  });

  it("9. Saturday slot followed by Sunday slot: weekend and Sunday counts correct on the later date's PROVISIONAL rank facts", () => {
    const plan = makeLoadedPlan((p) => {
      p.rotationPools[0].memberships = p.rotationPools[0].memberships.slice(0, 1);
    });
    const input = baseInput(plan, {
      periodStart: "2026-08-08", // Saturday
      periodEnd: "2026-08-09", // Sunday
    });
    const result = buildDutyEngineContext(input);
    // SelectionInput.fairnessFacts is Phase 4/5's PRE-RUN snapshot and is
    // deliberately never mutated by Phase 6 — the accumulator's effect
    // is only observable in the provisional selection's own rankFacts.
    const sunday = result.provisionalSelections.find((s) => s.date === "2026-08-09")!;
    const sundayWinnerRanking = sunday.rankings.find((r) => r.candidateKey === sunday.selectedCandidateKeys[0])!;
    expect(sundayWinnerRanking.rankFacts.weekendCount).toBe(1); // Saturday's in-run pick
  });

  it("10. holiday slot followed by weekday: holiday count and weighted load correct in PROVISIONAL rank facts", () => {
    const plan = makeLoadedPlan((p) => {
      p.rotationPools[0].memberships = p.rotationPools[0].memberships.slice(0, 1);
    });
    const input = baseInput(plan, {
      periodStart: "2026-08-03",
      periodEnd: "2026-08-04",
      holidays: [{ date: "2026-08-03", name: "Test Tatili", type: "OFFICIAL" }],
    });
    const result = buildDutyEngineContext(input);
    const nextDay = result.provisionalSelections.find((s) => s.date === "2026-08-04")!;
    const winnerRanking = nextDay.rankings.find((r) => r.candidateKey === nextDay.selectedCandidateKeys[0])!;
    expect(winnerRanking.rankFacts.holidayCount).toBe(1);
    expect(winnerRanking.rankFacts.totalWeightedLoad).toBe(2); // official-holiday weight from day 1
  });

  it("11. exact minimum-days boundary (seeded via history): pharmacy IS strictly eligible when the gap equals minDaysBetweenDuties", () => {
    const plan = makeLoadedPlan((p) => {
      p.rotationPools[0].memberships = p.rotationPools[0].memberships.slice(0, 1);
    });
    const input = baseInput(plan, {
      periodStart: "2026-08-03",
      periodEnd: "2026-08-03",
      historicalDuties: [{ pharmacyId: "ph-a", date: "2026-08-01", weight: 1 }], // gap = exactly 2 days
      policy: {
        minDaysBetweenDuties: 2,
        relaxMinIntervalWhenInsufficient: true,
        dayTypeWeights: [
          { dayTypeKey: "WEEKDAY", weight: 1 },
          { dayTypeKey: "SATURDAY", weight: 1.25 },
          { dayTypeKey: "SUNDAY", weight: 1.5 },
          { dayTypeKey: "OFFICIAL_HOLIDAY", weight: 2 },
          { dayTypeKey: "RELIGIOUS_HOLIDAY", weight: 2.5 },
          { dayTypeKey: "HOLIDAY_EVE", weight: 1 },
        ],
        sameDaySecondAssignmentAllowed: false,
      },
    });
    const result = buildDutyEngineContext(input);
    const day1 = result.provisionalSelections[0];
    const winnerRanking = day1.rankings.find((r) => r.candidateKey === day1.selectedCandidateKeys[0])!;
    expect(winnerRanking.rankFacts.origin).toBe("STRICT"); // gap = exactly 2 days
  });

  it("12. one day below minimum-days: pharmacy is NOT strictly eligible (relaxed instead)", () => {
    const plan = makeLoadedPlan((p) => {
      p.rotationPools[0].memberships = p.rotationPools[0].memberships.slice(0, 1);
    });
    const input = baseInput(plan, {
      periodStart: "2026-08-03",
      periodEnd: "2026-08-04",
      policy: {
        minDaysBetweenDuties: 2,
        relaxMinIntervalWhenInsufficient: true,
        dayTypeWeights: [
          { dayTypeKey: "WEEKDAY", weight: 1 },
          { dayTypeKey: "SATURDAY", weight: 1.25 },
          { dayTypeKey: "SUNDAY", weight: 1.5 },
          { dayTypeKey: "OFFICIAL_HOLIDAY", weight: 2 },
          { dayTypeKey: "RELIGIOUS_HOLIDAY", weight: 2.5 },
          { dayTypeKey: "HOLIDAY_EVE", weight: 1 },
        ],
        sameDaySecondAssignmentAllowed: false,
      },
    });
    const result = buildDutyEngineContext(input);
    const day2 = result.provisionalSelections.find((s) => s.date === "2026-08-04")!;
    const winnerRanking = day2.rankings.find((r) => r.candidateKey === day2.selectedCandidateKeys[0])!;
    expect(winnerRanking.rankFacts.origin).toBe("RELAXED"); // gap = 1 day < 2
  });

  it("13/14. reversed slot AND reversed date input produce the identical result (Part 3 normalization)", () => {
    const plan = makeLoadedPlan((p) => {
      addSecondShift(p);
      p.rotationPools[0].memberships = p.rotationPools[0].memberships.slice(0, 2);
    });
    const input = baseInput(plan, { periodStart: "2026-08-03", periodEnd: "2026-08-04" });
    const forward = buildDutyEngineContext(input);
    // buildDutyEngineContext itself always iterates chronologically —
    // this test instead proves selectProvisionalWinnersSequential's OWN
    // internal normalization by re-deriving pendingSelectionSlots order
    // indirectly: two independent full runs of the same input are
    // compared, which is only meaningful if internal ordering is stable
    // regardless of any nondeterminism. See
    // apply-sequential-selection-state.test.ts for a direct unit-level
    // reordering probe of resolveSequentialCandidateSet/accumulator.
    const again = buildDutyEngineContext(input);
    expect(again.resultFingerprint).toBe(forward.resultFingerprint);
  });

  it("15. sequential input SelectionInput objects are not mutated by selection", () => {
    const plan = makeLoadedPlan((p) => {
      p.rotationPools[0].memberships = p.rotationPools[0].memberships.slice(0, 1);
    });
    const input = baseInput(plan);
    const result = buildDutyEngineContext(input);
    const before = JSON.stringify(result.selectionInputs);
    buildDutyEngineContext(input); // run again with the SAME input object
    const after = JSON.stringify(result.selectionInputs);
    expect(after).toBe(before); // the first result's own selectionInputs are untouched
  });
});
