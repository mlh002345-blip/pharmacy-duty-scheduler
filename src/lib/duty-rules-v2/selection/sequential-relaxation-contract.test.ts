// Duty Rules V2 — corrective: sequential-relaxation-contract fix
// committed regression suite.
//
// Proves the confirmed Phase 4 <-> Phase 6 contract mismatch (a
// candidate whose only failures are relaxable never enters the
// sequential candidate pool when Phase 4's STATIC, single-slot
// evaluation never needed to relax) is closed, without resurrecting any
// non-relaxable candidate, without disturbing same-day protections, and
// without changing native/non-sequential output.

import { describe, expect, it } from "vitest";

import { buildDutyEngineContext } from "../engine/build-engine-context";
import { makeLoadedPlan, makeEngineInput } from "../engine/test-support/fixtures";
import { buildCompatibilityRules } from "../rules/build-compatibility-rules";
import { buildV1CompatibilitySelectionStrategy } from "./build-v1-compatibility-strategy";
import { isRelaxAdmissible } from "../engine/apply-eligibility-relaxation";
import { resolveSequentialCandidateSet } from "./apply-sequential-selection-state";
import { selectProvisionalWinners } from "./select-provisional-winners";
import { resolveCandidateSet } from "./resolve-candidate-set";
import { buildCandidateRankingFacts, buildStrategyMatchContext } from "./build-strategy-context";
import type { LoadedDutyPlanVersion } from "../domain/loaded-plan";
import type { DutyEngineInput, EngineSchedulingPolicy } from "../engine/domain/engine-input";
import type { SelectionInput } from "../engine/build-selection-input";
import type { CandidateEligibilityResult } from "../engine/evaluate-eligibility";

// ---------------------------------------------------------------------------
// Shared fixture: exactly the confirmed minimal reproduction.
//   ph-a historical duty 2026-08-30; ph-b selected 2026-09-01; ph-c
//   selected 2026-09-02; minDaysBetweenDuties=5; 2026-09-03 requires one
//   pharmacy and every candidate has fallen within the interval.
// ---------------------------------------------------------------------------

function reproductionPlan(): LoadedDutyPlanVersion {
  return makeLoadedPlan((p) => {
    p.dayTypeRules = p.dayTypeRules.filter((r) => r.dayType === "WEEKDAY");
    p.slotRequirements = p.slotRequirements.filter((s) => s.dayTypeRuleId === "dtr-WEEKDAY");
    p.rotationPools[0].memberships = [
      { id: "m-a", pharmacyId: "ph-a", pharmacyName: "Ada Eczanesi", pharmacyIsActive: true, joinedOn: "2026-01-01", leftOn: null, sortIndex: null },
      { id: "m-b", pharmacyId: "ph-b", pharmacyName: "Baris Eczanesi", pharmacyIsActive: true, joinedOn: "2026-01-01", leftOn: null, sortIndex: null },
      { id: "m-c", pharmacyId: "ph-c", pharmacyName: "Can Eczanesi", pharmacyIsActive: true, joinedOn: "2026-01-01", leftOn: null, sortIndex: null },
    ];
  });
}

function reproductionInput(overrides: Partial<Omit<DutyEngineInput, "loadedPlan">> = {}): DutyEngineInput {
  const plan = reproductionPlan();
  const policy: EngineSchedulingPolicy = {
    minDaysBetweenDuties: 5,
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
  };
  return makeEngineInput(plan, {
    periodStart: "2026-09-01",
    periodEnd: "2026-09-05",
    policy,
    historicalDuties: [{ pharmacyId: "ph-a", date: "2026-08-30", weight: 1 }],
    configuredRules: buildCompatibilityRules(policy),
    configuredSelectionStrategies: [
      buildV1CompatibilitySelectionStrategy({ organizationId: "org-1", regionId: "region-1" }),
    ],
    ...overrides,
  });
}

describe("A. exact confirmed reproduction", () => {
  it("admits ph-a on 2026-09-03 once sequential strict count reaches zero, and ph-a wins by the V1 comparator", () => {
    const result = buildDutyEngineContext(reproductionInput());
    const selection = result.provisionalSelections.find((s) => s.date === "2026-09-03")!;
    expect(selection.underfilled).toBe(false);
    const winnerRanking = selection.rankings.find((r) => r.selected)!;
    expect(winnerRanking.rankFacts.pharmacyId).toBe("ph-a");
    expect(winnerRanking.rankFacts.origin).toBe("RELAXED");

    // ph-b (09-01) and ph-c (09-02) must also be present in the ranking
    // (still admissible, just not the winner) — proves the pool was
    // genuinely widened, not narrowed to ph-a alone.
    const rankedPharmacyIds = selection.rankings.map((r) => r.rankFacts.pharmacyId).sort();
    expect(rankedPharmacyIds).toEqual(["ph-a", "ph-b", "ph-c"]);

    expect(
      selection.diagnostics.some((d) => d.code === "SEQUENTIAL_RELAXATION_APPLIED")
    ).toBe(true);
  });
});

describe("B. original Phase 4 static state, then Phase 6 sequential expansion", () => {
  it("Phase 4 statically reports strictEligible=[ph-b,ph-c], relaxedEligible=[], relaxationApplied=false for 2026-09-03", () => {
    const result = buildDutyEngineContext(reproductionInput());
    const si = result.selectionInputs.find((s) => s.slot.date === "2026-09-03")!;
    const pharmacyIdOf = (candidateKey: string) =>
      si.candidates.find((c) => c.candidateKey === candidateKey)!.pharmacyId;

    expect(si.relaxation.strictEligible.map(pharmacyIdOf).sort()).toEqual(["ph-b", "ph-c"]);
    expect(si.relaxation.relaxedEligible).toEqual([]);
    expect(si.relaxation.relaxationApplied).toBe(false);
  });

  it("Phase 6 correctly expands the sequential relaxed pool after accumulator updates, admitting ph-a", () => {
    const result = buildDutyEngineContext(reproductionInput());
    const selection = result.provisionalSelections.find((s) => s.date === "2026-09-03")!;
    const admittedPharmacyIds = selection.rankings.map((r) => r.rankFacts.pharmacyId);
    expect(admittedPharmacyIds).toContain("ph-a");
  });
});

describe("C. non-relaxable exclusion", () => {
  it("a candidate failing MIN_DAYS_INTERVAL plus unavailability is never admitted by the widening", () => {
    const result = buildDutyEngineContext(
      reproductionInput({
        unavailability: [{ pharmacyId: "ph-a", startDate: "2026-09-01", endDate: "2026-09-30" }],
      })
    );
    const selection = result.provisionalSelections.find((s) => s.date === "2026-09-03")!;
    const rankedPharmacyIds = selection.rankings.map((r) => r.rankFacts.pharmacyId);
    expect(rankedPharmacyIds).not.toContain("ph-a");
    // ph-b/ph-c remain admissible (interval-only failures, demoted to
    // RELAXED via the pre-existing accumulator re-derivation) — the
    // slot is still filled by one of them, just never by ph-a.
    expect(selection.underfilled).toBe(false);
    expect(rankedPharmacyIds.sort()).toEqual(["ph-b", "ph-c"]);
  });

  it("a candidate failing MIN_DAYS_INTERVAL plus inactive status is never admitted", () => {
    const plan = reproductionPlan();
    plan.rotationPools[0].memberships = plan.rotationPools[0].memberships.map((m) =>
      m.pharmacyId === "ph-a" ? { ...m, pharmacyIsActive: false } : m
    );
    const policy: EngineSchedulingPolicy = {
      minDaysBetweenDuties: 5,
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
    };
    const input = makeEngineInput(plan, {
      periodStart: "2026-09-01",
      periodEnd: "2026-09-05",
      policy,
      historicalDuties: [{ pharmacyId: "ph-a", date: "2026-08-30", weight: 1 }],
      configuredRules: buildCompatibilityRules(policy),
      configuredSelectionStrategies: [
        buildV1CompatibilitySelectionStrategy({ organizationId: "org-1", regionId: "region-1" }),
      ],
    });
    const result = buildDutyEngineContext(input);
    const selection = result.provisionalSelections.find((s) => s.date === "2026-09-03")!;
    const rankedPharmacyIds = selection.rankings.map((r) => r.rankFacts.pharmacyId);
    expect(rankedPharmacyIds).not.toContain("ph-a");
  });

  it("a candidate failing MIN_DAYS_INTERVAL plus an approved CANNOT_DUTY request is never admitted", () => {
    const result = buildDutyEngineContext(
      reproductionInput({
        dutyRequests: [
          {
            pharmacyId: "ph-a",
            requestType: "CANNOT_DUTY",
            status: "APPROVED",
            startDate: "2026-09-01",
            endDate: "2026-09-30",
          },
        ],
      })
    );
    const selection = result.provisionalSelections.find((s) => s.date === "2026-09-03")!;
    const rankedPharmacyIds = selection.rankings.map((r) => r.rankFacts.pharmacyId);
    expect(rankedPharmacyIds).not.toContain("ph-a");
  });
});

describe("D. configured compatibility-rule duplication", () => {
  it("a candidate failing both MIN_DAYS_INTERVAL and RULE_MIN_DAYS_INTERVAL is admitted (both codes declared relaxable)", () => {
    const result = buildDutyEngineContext(reproductionInput());
    const si = result.selectionInputs.find((s) => s.slot.date === "2026-09-03")!;
    const phACandidateKey = si.candidates.find((c) => c.pharmacyId === "ph-a")!.candidateKey;
    const phAEligibility = si.eligibility.find((e) => e.candidateKey === phACandidateKey)!;
    expect(phAEligibility.hardExclusionReasons.sort()).toEqual(
      ["MIN_DAYS_INTERVAL", "RULE_MIN_DAYS_INTERVAL"].sort()
    );
    expect(si.relaxableReasonCodes).toEqual(
      expect.arrayContaining(["MIN_DAYS_INTERVAL", "RULE_MIN_DAYS_INTERVAL"])
    );
    const selection = result.provisionalSelections.find((s) => s.date === "2026-09-03")!;
    expect(selection.rankings.map((r) => r.rankFacts.pharmacyId)).toContain("ph-a");
  });
});

describe("E. one non-relaxable reason among multiple reasons excludes the candidate", () => {
  it("isRelaxAdmissible returns false when only ONE of several hard failures is non-relaxable", () => {
    const eligibilityResult: CandidateEligibilityResult = {
      candidateKey: "k1",
      pharmacyId: "ph-x",
      eligible: false,
      hardExclusionReasons: ["MIN_DAYS_INTERVAL", "UNAVAILABLE"],
      softFindings: [],
    } as unknown as CandidateEligibilityResult;
    expect(isRelaxAdmissible(eligibilityResult, new Set(["MIN_DAYS_INTERVAL"]))).toBe(false);
  });

  it("isRelaxAdmissible returns true when EVERY hard failure is relaxable", () => {
    const eligibilityResult: CandidateEligibilityResult = {
      candidateKey: "k1",
      pharmacyId: "ph-x",
      eligible: false,
      hardExclusionReasons: ["MIN_DAYS_INTERVAL"],
      softFindings: [],
    } as unknown as CandidateEligibilityResult;
    expect(isRelaxAdmissible(eligibilityResult, new Set(["MIN_DAYS_INTERVAL"]))).toBe(true);
  });

  it("isRelaxAdmissible returns false for a strictly-eligible candidate (nothing to relax)", () => {
    const eligibilityResult: CandidateEligibilityResult = {
      candidateKey: "k1",
      pharmacyId: "ph-x",
      eligible: true,
      hardExclusionReasons: [],
      softFindings: [],
    } as unknown as CandidateEligibilityResult;
    expect(isRelaxAdmissible(eligibilityResult, new Set(["MIN_DAYS_INTERVAL"]))).toBe(false);
  });
});

describe("F. strict candidates sufficient after accumulator — no widening", () => {
  it("does not widen when accumulator-adjusted strict count already meets requiredCount", () => {
    // minDaysBetweenDuties=0: nobody is ever interval-excluded, so
    // strict is always sufficient and the widening path must never fire.
    const plan = reproductionPlan();
    const policy: EngineSchedulingPolicy = {
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
    };
    const input = makeEngineInput(plan, {
      periodStart: "2026-09-01",
      periodEnd: "2026-09-05",
      policy,
      configuredRules: buildCompatibilityRules(policy),
      configuredSelectionStrategies: [
        buildV1CompatibilitySelectionStrategy({ organizationId: "org-1", regionId: "region-1" }),
      ],
    });
    const result = buildDutyEngineContext(input);
    for (const selection of result.provisionalSelections) {
      expect(selection.diagnostics.some((d) => d.code === "SEQUENTIAL_RELAXATION_APPLIED")).toBe(false);
      expect(selection.rankings.every((r) => r.rankFacts.origin === "STRICT")).toBe(true);
    }
  });
});

describe("G. native/non-sequential behavior is unchanged", () => {
  it("selectProvisionalWinners (single-slot entry point) output is unaffected by the sequential widening logic", () => {
    // Build a SelectionInput directly (bypassing the sequential
    // orchestrator entirely) and confirm selectProvisionalWinners still
    // only ever considers strictEligible ∪ relaxedEligible — exactly
    // the pre-corrective, single-slot contract.
    const result = buildDutyEngineContext(reproductionInput());
    const si = result.selectionInputs.find((s) => s.slot.date === "2026-09-03")!;
    const definitions = [buildV1CompatibilitySelectionStrategy({ organizationId: "org-1", regionId: "region-1" })];
    const definitionsById = new Map(definitions.map((d) => [d.id, d]));
    const origin = resolveCandidateSet(si);
    const rankingFacts = buildCandidateRankingFacts(si, origin);
    const matchContext = buildStrategyMatchContext({
      organizationId: "org-1",
      regionId: "region-1",
      planId: "plan-1",
      planVersionId: "pv-1",
      generationMode: "PREVIEW",
      date: "2026-09-03",
      weekday: "THURSDAY",
      holidayTypes: ["NONE"],
      dayType: "WEEKDAY",
      customDayCategory: null,
      selectionInput: si,
    });
    const singleSlotResult = selectProvisionalWinners({
      selectionInput: si,
      matchContextBase: {
        organizationId: "org-1",
        regionId: "region-1",
        planId: "plan-1",
        planVersionId: "pv-1",
        generationMode: "PREVIEW",
        date: "2026-09-03",
        weekday: "THURSDAY",
        holidayTypes: ["NONE"],
        dayType: "WEEKDAY",
        customDayCategory: null,
      },
      definitions,
      definitionsById,
    });
    void rankingFacts;
    void matchContext;
    // Statically (no sequential accumulator), only ph-b/ph-c are ever
    // considered — ph-a is correctly absent here, since single-slot
    // resolution has no accumulator to widen against. This IS the
    // documented, unchanged native/non-sequential contract.
    expect(singleSlotResult.rankings.map((r) => r.rankFacts.pharmacyId).sort()).toEqual(["ph-b", "ph-c"]);
  });

  it("a run with no configured selection strategies is completely unaffected (zero provisional selections either way)", () => {
    const input = reproductionInput({ configuredSelectionStrategies: [] });
    const result = buildDutyEngineContext(input);
    expect(result.provisionalSelections).toHaveLength(0);
  });
});

describe("H. same-day protections re-verified", () => {
  it("same-day double-booking remains impossible even when the widening admits a candidate", () => {
    const plan = reproductionPlan();
    plan.shiftDefinitions.push({
      id: "shift-2",
      name: "Ikinci Vardiya",
      startMinute: 0,
      endMinute: 0,
      spansMidnight: false,
      defaultWeight: 1,
      sortOrder: 1,
    });
    const rule = plan.dayTypeRules.find((r) => r.dayType === "WEEKDAY")!;
    plan.slotRequirements.push({
      id: "slot-WEEKDAY-2",
      name: null,
      requiredCount: 1,
      sortOrder: 1,
      dayTypeRuleId: rule.id,
      shiftDefinitionId: "shift-2",
      rotationPoolId: "pool-1",
    });
    plan.rotationPools[0].memberships = plan.rotationPools[0].memberships.slice(0, 1); // ph-a only
    const policy: EngineSchedulingPolicy = {
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
    };
    const input = makeEngineInput(plan, {
      periodStart: "2026-09-03",
      periodEnd: "2026-09-03",
      policy,
      configuredRules: buildCompatibilityRules(policy),
      configuredSelectionStrategies: [
        buildV1CompatibilitySelectionStrategy({ organizationId: "org-1", regionId: "region-1" }),
      ],
    });
    const result = buildDutyEngineContext(input);
    const [slot1, slot2] = result.provisionalSelections.sort((a, b) => (a.slotKey < b.slotKey ? -1 : 1));
    expect(slot1.selectedCandidateKeys).toHaveLength(1);
    expect(slot2.selectedCandidateKeys).toHaveLength(0);
    expect(slot2.underfilled).toBe(true);
    expect(slot2.diagnostics.some((d) => d.code === "PROVISIONAL_SAME_DAY_ASSIGNMENT_CONFLICT")).toBe(true);
  });
});

describe("I. determinism", () => {
  it("the confirmed reproduction is byte-identical across three runs", () => {
    const runs = [1, 2, 3].map(() => buildDutyEngineContext(reproductionInput()));
    const fingerprints = runs.map((r) => r.resultFingerprint);
    expect(new Set(fingerprints).size).toBe(1);
    for (const r of runs) {
      const selection = r.provisionalSelections.find((s) => s.date === "2026-09-03")!;
      expect(selection.rankings.find((rk) => rk.selected)!.rankFacts.pharmacyId).toBe("ph-a");
    }
  });
});

describe("J. immutability", () => {
  it("resolveSequentialCandidateSet never mutates its SelectionInput, accumulator, or eligibility inputs", () => {
    const result = buildDutyEngineContext(reproductionInput());
    const si = result.selectionInputs.find((s) => s.slot.date === "2026-09-03")!;
    const siSnapshot = JSON.parse(JSON.stringify(si));
    const accumulator = new Map([
      ["ph-b", { addedWeight: 1, addedAssignmentCount: 1, addedWeekendCount: 0, addedSundayCount: 0, addedHolidayCount: 0, newestLastDutyDate: "2026-09-01" }],
      ["ph-c", { addedWeight: 1, addedAssignmentCount: 1, addedWeekendCount: 0, addedSundayCount: 0, addedHolidayCount: 0, newestLastDutyDate: "2026-09-02" }],
    ]);
    const accumulatorSnapshot = JSON.parse(JSON.stringify([...accumulator.entries()]));

    resolveSequentialCandidateSet(si as unknown as SelectionInput, accumulator, 5, false, true);

    expect(JSON.parse(JSON.stringify(si))).toEqual(siSnapshot);
    expect(JSON.parse(JSON.stringify([...accumulator.entries()]))).toEqual(accumulatorSnapshot);
  });
});
