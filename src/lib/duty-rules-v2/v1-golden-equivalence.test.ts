// Duty Rules V2 — Phase 6 corrective: the full end-to-end V1 golden
// equivalence harness.
//
// Path A (unchanged V1): calls the actual, unmodified
// src/lib/scheduling/generate-duty-schedule.ts directly.
//
// Path B (V2 compatibility): the same scenario input →
// adaptV1RuleToV2Config (Phase 2, unmodified) → a LoadedDutyPlanVersion
// fixture shaped exactly like the Phase 3 loader's output → the actual
// production buildDutyEngineContext (Phase 4/5/6, unmodified) with
// buildCompatibilityRules(policy) (Phase 5) and
// buildV1CompatibilitySelectionStrategy (Phase 6) — never a second copy
// of the scheduling algorithm.
//
// Neither path touches a database, writes a schedule/assignment row, or
// advances RotationState. All fixtures are synthetic and
// chamber-independent.

import { describe, expect, it } from "vitest";

import {
  generateDutySchedule,
  type CandidatePharmacy,
  type DutyRequestInput,
  type DutyRuleWeights,
  type GenerateDutyScheduleParams,
  type GenerateDutyScheduleResult,
  type HistoricalAssignmentInput,
  type HolidayInput,
  type HolidayTypeInput,
  type UnavailabilityInput,
} from "../scheduling/generate-duty-schedule";
import { dateAtUtcMidnight, daysInMonth, toDateKey } from "../scheduling/date-tr";
import { adaptV1RuleToV2Config, type AdaptedV1PlanConfig, type V1AdapterInput } from "./v1-adapter";
import { buildDutyEngineContext } from "./engine/build-engine-context";
import type { DutyEngineDraftResult } from "./engine/build-draft-result";
import type { DutyEngineInput, EngineSchedulingPolicy } from "./engine/domain/engine-input";
import type { LoadedDutyPlanVersion } from "./domain/loaded-plan";
import { buildCompatibilityRules } from "./rules/build-compatibility-rules";
import { buildV1CompatibilitySelectionStrategy } from "./selection/build-v1-compatibility-strategy";

// ---------------------------------------------------------------------------
// Shared scenario fixture + both-path runner.
// ---------------------------------------------------------------------------

type ScenarioFixture = {
  organizationId: string;
  regionId: string;
  year: number;
  month: number;
  dailyDutyCount: number;
  dutyRule: DutyRuleWeights;
  /** Supplied in the exact order V1 receives them — order matters ONLY
   *  for the fully-tied scenario (see its test's comment). */
  pharmacies: { id: string; name: string; isActive: boolean }[];
  holidays?: { day: number; name: string; type: HolidayTypeInput }[];
  unavailabilities?: { pharmacyId: string; startDay: number; endDay: number }[];
  /** Historical duties, absolute ISO dates (typically before the period). */
  historicalAssignments?: { pharmacyId: string; date: string; weight: number }[];
  openingBalance?: Record<string, number>;
  dutyRequests?: {
    pharmacyId: string;
    requestType: DutyRequestInput["requestType"];
    status: DutyRequestInput["status"];
    startDay: number;
    endDay: number;
  }[];
  /** Phase 6 corrective (Part 4/6): explicit holiday-overlap resolution
   *  mode. Defaults to "V1_LAST_INPUT_WINS" for this harness — the whole
   *  point of the compatibility fixture is reproducing V1 byte-for-byte,
   *  including its order-dependent overlap behavior. */
  holidayOverlapResolutionMode?: "NATIVE_PRECEDENCE" | "V1_LAST_INPUT_WINS";
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isoDateOf(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function buildV1Params(f: ScenarioFixture): GenerateDutyScheduleParams {
  const holidays: HolidayInput[] = (f.holidays ?? []).map((h) => ({
    date: dateAtUtcMidnight(f.year, f.month, h.day),
    name: h.name,
    type: h.type,
  }));
  const unavailabilities: UnavailabilityInput[] = (f.unavailabilities ?? []).map((u) => ({
    pharmacyId: u.pharmacyId,
    startDate: dateAtUtcMidnight(f.year, f.month, u.startDay),
    endDate: dateAtUtcMidnight(f.year, f.month, u.endDay),
  }));
  const historicalAssignments: HistoricalAssignmentInput[] = (f.historicalAssignments ?? []).map(
    (h) => ({
      pharmacyId: h.pharmacyId,
      date: new Date(`${h.date}T00:00:00.000Z`),
      weight: h.weight,
    })
  );
  const dutyRequests: DutyRequestInput[] = (f.dutyRequests ?? []).map((r) => ({
    pharmacyId: r.pharmacyId,
    requestType: r.requestType,
    status: r.status,
    startDate: dateAtUtcMidnight(f.year, f.month, r.startDay),
    endDate: dateAtUtcMidnight(f.year, f.month, r.endDay),
  }));
  const pharmacies: CandidatePharmacy[] = f.pharmacies.map((p) => ({
    id: p.id,
    name: p.name,
    isActive: p.isActive,
    regionId: f.regionId,
  }));

  return {
    month: f.month,
    year: f.year,
    regionId: f.regionId,
    dailyDutyCount: f.dailyDutyCount,
    dutyRule: f.dutyRule,
    pharmacies,
    holidays,
    unavailabilities,
    historicalAssignments,
    openingBalance: f.openingBalance ? new Map(Object.entries(f.openingBalance)) : undefined,
    dutyRequests,
  };
}

function buildLoadedPlanFromAdapted(adapted: AdaptedV1PlanConfig): LoadedDutyPlanVersion {
  const dayTypeRuleIdOf = (dayType: string) => `dtr-${dayType}`;
  return {
    loaderVersion: 1,
    organizationId: adapted.plan.organizationId,
    regionId: adapted.plan.regionId,
    planId: adapted.plan.key,
    planName: adapted.plan.name,
    planVersionId: adapted.version.key,
    versionNumber: 1,
    status: "ACTIVE",
    validFrom: "2020-01-01",
    validTo: null,
    configurationFingerprint: "golden-harness-fixture",
    dayTypeRules: adapted.dayTypeRules.map((r) => ({
      id: dayTypeRuleIdOf(r.dayType),
      dayType: r.dayType,
      isServed: true,
      customDayCategory: null,
    })),
    shiftDefinitions: [
      {
        id: adapted.shift.key,
        name: adapted.shift.name,
        startMinute: 0,
        endMinute: 0,
        spansMidnight: false,
        defaultWeight: 1,
        sortOrder: 0,
      },
    ],
    slotRequirements: adapted.slotRequirements.map((s) => ({
      id: s.key,
      name: null,
      requiredCount: s.requiredCount,
      sortOrder: 0,
      dayTypeRuleId: dayTypeRuleIdOf(s.dayType),
      shiftDefinitionId: adapted.shift.key,
      rotationPoolId: adapted.rotationPool.key,
    })),
    rotationPools: [
      {
        id: adapted.rotationPool.key,
        name: adapted.plan.name,
        strategy: adapted.rotationPool.strategy,
        regionId: adapted.plan.regionId,
        memberships: adapted.rotationPool.memberships.map((m) => ({
          id: `m-${m.pharmacyId}`,
          pharmacyId: m.pharmacyId,
          pharmacyName: m.name,
          pharmacyIsActive: true,
          joinedOn: "2020-01-01",
          leftOn: null,
          sortIndex: null,
        })),
        rotationStates: [
          {
            id: `rs-${adapted.rotationPool.key}`,
            dayTypeScope: "ALL",
            currentRound: 1,
            lockVersion: 0,
            carriedForward: [],
            lastServedMembershipId: null,
          },
        ],
      },
    ],
    membershipSnapshots: null,
    diagnostics: [],
  };
}

function buildV2Input(f: ScenarioFixture): DutyEngineInput {
  const adapterInput: V1AdapterInput = {
    organizationId: f.organizationId,
    region: {
      id: f.regionId,
      organizationId: f.organizationId,
      name: "Test Bölgesi",
      dailyDutyCount: f.dailyDutyCount,
    },
    dutyRule: { id: `dr-${f.regionId}`, regionId: f.regionId, ...f.dutyRule },
    pharmacies: f.pharmacies.map((p) => ({
      id: p.id,
      name: p.name,
      isActive: p.isActive,
      regionId: f.regionId,
    })),
  };
  const adapted = adaptV1RuleToV2Config(adapterInput);
  const plan = buildLoadedPlanFromAdapted(adapted);

  const periodStart = isoDateOf(f.year, f.month, 1);
  const periodEnd = isoDateOf(f.year, f.month, daysInMonth(f.year, f.month));

  const policy: EngineSchedulingPolicy = {
    minDaysBetweenDuties: f.dutyRule.minDaysBetweenDuties,
    relaxMinIntervalWhenInsufficient: true,
    dayTypeWeights: [
      { dayTypeKey: "WEEKDAY", weight: f.dutyRule.weekdayWeight },
      { dayTypeKey: "SATURDAY", weight: f.dutyRule.saturdayWeight },
      { dayTypeKey: "SUNDAY", weight: f.dutyRule.sundayWeight },
      { dayTypeKey: "OFFICIAL_HOLIDAY", weight: f.dutyRule.officialHolidayWeight },
      { dayTypeKey: "RELIGIOUS_HOLIDAY", weight: f.dutyRule.religiousHolidayWeight },
      // HOLIDAY_EVE intentionally OMITTED: holidayEveWeightSource below
      // means an eve date's weight is resolved from its underlying
      // weekday and this entry is never looked up.
    ],
    sameDaySecondAssignmentAllowed: false,
    holidayEveWeightSource: "UNDERLYING_WEEKDAY",
    holidayOverlapResolutionMode: f.holidayOverlapResolutionMode ?? "V1_LAST_INPUT_WINS",
  };

  const holidays = (f.holidays ?? []).map((h) => ({
    date: isoDateOf(f.year, f.month, h.day),
    name: h.name,
    type: h.type,
  }));
  const unavailability = (f.unavailabilities ?? []).map((u) => ({
    pharmacyId: u.pharmacyId,
    startDate: isoDateOf(f.year, f.month, u.startDay),
    endDate: isoDateOf(f.year, f.month, u.endDay),
  }));
  const historicalDuties = (f.historicalAssignments ?? []).map((h) => ({
    pharmacyId: h.pharmacyId,
    date: h.date,
    weight: h.weight,
  }));
  const balanceAdjustments = Object.entries(f.openingBalance ?? {}).map(([pharmacyId, amount]) => ({
    pharmacyId,
    amount,
  }));
  const dutyRequests = (f.dutyRequests ?? []).map((r) => ({
    pharmacyId: r.pharmacyId,
    requestType: r.requestType,
    status: r.status,
    startDate: isoDateOf(f.year, f.month, r.startDay),
    endDate: isoDateOf(f.year, f.month, r.endDay),
  }));

  return {
    loadedPlan: plan,
    organizationId: f.organizationId,
    regionId: f.regionId,
    periodStart,
    periodEnd,
    generationMode: "PREVIEW",
    policy,
    holidays,
    customDayOverrides: [],
    unavailability,
    dutyRequests,
    historicalDuties,
    balanceAdjustments,
    existingAssignments: [],
    configuredRules: buildCompatibilityRules(policy),
    configuredSelectionStrategies: [
      buildV1CompatibilitySelectionStrategy({ organizationId: f.organizationId, regionId: f.regionId }),
    ],
  };
}

function runBothPaths(f: ScenarioFixture): {
  v1: GenerateDutyScheduleResult;
  v2: DutyEngineDraftResult;
} {
  const v1 = generateDutySchedule(buildV1Params(f));
  const v2 = buildDutyEngineContext(buildV2Input(f));
  return { v1, v2 };
}

// ---------------------------------------------------------------------------
// Comparison helpers.
// ---------------------------------------------------------------------------

function v1ByDate(result: GenerateDutyScheduleResult): Map<string, { pharmacyId: string; weight: number }[]> {
  const map = new Map<string, { pharmacyId: string; weight: number }[]>();
  for (const a of result.assignments) {
    const key = toDateKey(a.date);
    const list = map.get(key) ?? [];
    list.push({ pharmacyId: a.pharmacyId, weight: a.weight });
    map.set(key, list);
  }
  return map;
}

function v2ByDate(result: DutyEngineDraftResult): Map<string, { pharmacyId: string; weight: number }[]> {
  const map = new Map<string, { pharmacyId: string; weight: number }[]>();
  const selectionInputBySlotKey = new Map(result.selectionInputs.map((si) => [si.slot.slotKey, si]));
  for (const selection of result.provisionalSelections) {
    const selectionInput = selectionInputBySlotKey.get(selection.slotKey);
    const items = selection.selectedCandidateKeys.map((key) => {
      const ranking = selection.rankings.find((r) => r.candidateKey === key)!;
      const fairness = selectionInput?.fairnessFacts.find((fact) => fact.candidateKey === key);
      return { pharmacyId: ranking.rankFacts.pharmacyId, weight: fairness?.dateWeight ?? Number.NaN };
    });
    map.set(selection.date, items);
  }
  return map;
}

/** Full per-date equivalence: selected pharmacy ids AND their order,
 *  plus per-assignment weight. */
function assertSelectionEquivalence(
  v1: GenerateDutyScheduleResult,
  v2: DutyEngineDraftResult,
  expectedDates: string[]
): void {
  const v1Map = v1ByDate(v1);
  const v2Map = v2ByDate(v2);
  for (const date of expectedDates) {
    const v1List = v1Map.get(date) ?? [];
    const v2List = v2Map.get(date) ?? [];
    expect(v2List.map((x) => x.pharmacyId), `date ${date} selected ids`).toEqual(
      v1List.map((x) => x.pharmacyId)
    );
    for (let i = 0; i < v1List.length; i++) {
      expect(v2List[i]?.weight, `date ${date} weight[${i}]`).toBe(v1List[i]?.weight);
    }
  }
}

/** Underfill equivalence: the set of dates V1 warns about must equal the
 *  set of dates V2 marks underfilled. */
function assertUnderfillEquivalence(v1: GenerateDutyScheduleResult, v2: DutyEngineDraftResult): void {
  const v1Underfilled = new Set(v1.warnings.map((w) => toDateKey(w.date)));
  const v2Underfilled = new Set(v2.provisionalSelections.filter((s) => s.underfilled).map((s) => s.date));
  expect(v2Underfilled).toEqual(v1Underfilled);
}

function allDates(f: ScenarioFixture): string[] {
  const total = daysInMonth(f.year, f.month);
  return Array.from({ length: total }, (_, i) => isoDateOf(f.year, f.month, i + 1));
}

const BASE_DUTY_RULE: DutyRuleWeights = {
  minDaysBetweenDuties: 3,
  weekdayWeight: 1,
  saturdayWeight: 1.25,
  sundayWeight: 1.5,
  officialHolidayWeight: 2,
  religiousHolidayWeight: 2.5,
};

function threePharmacies(): ScenarioFixture["pharmacies"] {
  return [
    { id: "ph-a", name: "Ada Eczanesi", isActive: true },
    { id: "ph-b", name: "Barış Eczanesi", isActive: true },
    { id: "ph-c", name: "Can Eczanesi", isActive: true },
  ];
}

// ---------------------------------------------------------------------------
// Scenarios (Part 2).
// ---------------------------------------------------------------------------

describe("V1 golden equivalence — dailyDutyCount", () => {
  it("1. dailyDutyCount = 1", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule: BASE_DUTY_RULE,
      pharmacies: threePharmacies(),
    };
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, allDates(f));
    assertUnderfillEquivalence(v1, v2);
  });

  it("2. dailyDutyCount = 3 (full pool every day)", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 3,
      dutyRule: { ...BASE_DUTY_RULE, minDaysBetweenDuties: 0 },
      pharmacies: threePharmacies(),
    };
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, allDates(f));
    assertUnderfillEquivalence(v1, v2);
  });
});

describe("V1 golden equivalence — day types", () => {
  it("3. normal weekday", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9, // Tuesday 2026-09-01
      dailyDutyCount: 1,
      dutyRule: BASE_DUTY_RULE,
      pharmacies: threePharmacies(),
    };
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-01"]);
  });

  it("4. Saturday", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule: BASE_DUTY_RULE,
      pharmacies: threePharmacies(),
    };
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-05"]); // Saturday
  });

  it("5. Sunday", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule: BASE_DUTY_RULE,
      pharmacies: threePharmacies(),
    };
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-06"]); // Sunday
  });

  it("6. official holiday", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule: BASE_DUTY_RULE,
      pharmacies: threePharmacies(),
      holidays: [{ day: 15, name: "Test Resmi Tatil", type: "OFFICIAL" }], // Tuesday
    };
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-15"]);
  });

  it("7. religious holiday", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule: BASE_DUTY_RULE,
      pharmacies: threePharmacies(),
      holidays: [{ day: 15, name: "Test Dini Tatil", type: "RELIGIOUS" }],
    };
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-15"]);
  });

  it("8. OTHER holiday (weighted as OFFICIAL — documented V1 rule)", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule: BASE_DUTY_RULE,
      pharmacies: threePharmacies(),
      holidays: [{ day: 15, name: "Test Diğer Tatil", type: "OTHER" }],
    };
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-15"]);
  });
});

describe("V1 golden equivalence — holiday eve (Part 3 corrective)", () => {
  it("9. holiday eve before a WEEKDAY holiday uses the eve's actual weekday weight", () => {
    // 2026-09-15 (Tuesday) is an official holiday; its eve (2026-09-14,
    // Monday) has NO holiday of its own — V1 weights it as a plain
    // Monday (weekdayWeight); V2's resolved day type for 09-14 is
    // HOLIDAY_EVE, but holidayEveWeightSource="UNDERLYING_WEEKDAY" makes
    // it resolve to WEEKDAY's weight, matching V1 exactly.
    const dutyRule: DutyRuleWeights = { ...BASE_DUTY_RULE, weekdayWeight: 1, minDaysBetweenDuties: 0 };
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule,
      pharmacies: threePharmacies(),
      holidays: [{ day: 15, name: "Test Resmi Tatil", type: "OFFICIAL" }],
    };
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-14", "2026-09-15"]);
  });

  it("10. holiday eve before a WEEKEND holiday uses the eve's actual Saturday/Sunday weight", () => {
    // 2026-09-20 is a Sunday; make it an official holiday. Its eve
    // (2026-09-19, Saturday) has no holiday of its own — V1 weights it
    // as a plain Saturday; V2 must match via UNDERLYING_WEEKDAY.
    const dutyRule: DutyRuleWeights = { ...BASE_DUTY_RULE, saturdayWeight: 1.25, minDaysBetweenDuties: 0 };
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule,
      pharmacies: threePharmacies(),
      holidays: [{ day: 20, name: "Test Hafta Sonu Tatili", type: "OFFICIAL" }],
    };
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-19", "2026-09-20"]);
  });

  it("holiday-eve WEIGHT differs across two runs whose eve weekday differs, and every hash reflects it", () => {
    // Same dutyRule/pharmacies; only WHICH date is the holiday changes,
    // which changes the underlying weekday of its eve (Monday vs
    // Saturday) — proving compatibilityWeightDayType (and therefore the
    // dateWeight, and therefore every downstream hash) is not a
    // constant, silently-ignored field.
    const base: Omit<ScenarioFixture, "holidays"> = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule: { ...BASE_DUTY_RULE, weekdayWeight: 1, saturdayWeight: 1.25, minDaysBetweenDuties: 0 },
      pharmacies: threePharmacies(),
    };
    const weekdayEveResult = buildDutyEngineContext(
      buildV2Input({ ...base, holidays: [{ day: 15, name: "A", type: "OFFICIAL" }] })
    );
    const weekendEveResult = buildDutyEngineContext(
      buildV2Input({ ...base, holidays: [{ day: 20, name: "A", type: "OFFICIAL" }] })
    );
    const weekdayEve = weekdayEveResult.selectionInputs.find((s) => s.slot.date === "2026-09-14")!;
    const weekendEve = weekendEveResult.selectionInputs.find((s) => s.slot.date === "2026-09-19")!;
    expect(weekdayEve.fairnessFacts[0].dateWeight).toBe(1); // WEEKDAY weight
    expect(weekendEve.fairnessFacts[0].dateWeight).toBe(1.25); // SATURDAY weight
    expect(weekdayEveResult.resultFingerprint).not.toBe(weekendEveResult.resultFingerprint);
    const weekdayEveSelection = weekdayEveResult.provisionalSelections.find((s) => s.date === "2026-09-14")!;
    const weekendEveSelection = weekendEveResult.provisionalSelections.find((s) => s.date === "2026-09-19")!;
    expect(weekdayEveSelection.rankings[0]?.rankFacts.totalWeightedLoad).not.toBe(
      weekendEveSelection.rankings[0]?.rankFacts.totalWeightedLoad
    );
  });

  it("native V2 (CONFIGURED source, non-compatibility) still uses the configured HOLIDAY_EVE weight, unaffected by the underlying weekday", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule: { ...BASE_DUTY_RULE, weekdayWeight: 1, minDaysBetweenDuties: 0 },
      pharmacies: threePharmacies(),
      holidays: [{ day: 15, name: "A", type: "OFFICIAL" }],
    };
    const input = buildV2Input(f);
    input.policy.holidayEveWeightSource = "CONFIGURED";
    input.policy.dayTypeWeights = [...input.policy.dayTypeWeights, { dayTypeKey: "HOLIDAY_EVE", weight: 9 }];
    const result = buildDutyEngineContext(input);
    const eve = result.selectionInputs.find((s) => s.slot.date === "2026-09-14")!;
    expect(eve.fairnessFacts[0].dateWeight).toBe(9); // configured value, NOT the underlying Monday weight (1)
  });

  it("repeated sequential runs of the eve-weight resolution are deterministic", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule: { ...BASE_DUTY_RULE, minDaysBetweenDuties: 0 },
      pharmacies: threePharmacies(),
      holidays: [{ day: 15, name: "A", type: "OFFICIAL" }],
    };
    const results = [1, 2, 3].map(() => buildDutyEngineContext(buildV2Input(f)));
    expect(results[0].resultFingerprint).toBe(results[1].resultFingerprint);
    expect(results[1].resultFingerprint).toBe(results[2].resultFingerprint);
  });
});

describe("V1 golden equivalence — calendar and eligibility facts", () => {
  it("11. overlapping holiday metadata (same effective weight bucket: OFFICIAL + OTHER)", () => {
    // Two holiday records on the same date, both mapping to
    // officialHolidayWeight in V1 (OTHER shares OFFICIAL's weight) and
    // to OFFICIAL_HOLIDAY in V2 — the achievable equivalence case. (A
    // RELIGIOUS+OFFICIAL same-date overlap is a genuine, DOCUMENTED
    // divergence: V1's holidayByDateKey Map keeps whichever holiday was
    // LAST in the input array (an array-order artifact, not a
    // specified rule), while V2's day-type precedence deterministically
    // prefers RELIGIOUS_HOLIDAY regardless of input order — see the
    // Phase 6 corrective final report.)
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule: BASE_DUTY_RULE,
      pharmacies: threePharmacies(),
      holidays: [
        { day: 15, name: "Resmi Tatil A", type: "OFFICIAL" },
        { day: 15, name: "Diğer Tatil B", type: "OTHER" },
      ],
    };
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-15"]);
  });

  it("12. unavailability blocks a date", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule: { ...BASE_DUTY_RULE, minDaysBetweenDuties: 0 },
      pharmacies: threePharmacies(),
      unavailabilities: [{ pharmacyId: "ph-a", startDay: 1, endDay: 5 }],
    };
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-01", "2026-09-02", "2026-09-03"]);
  });

  it("13. approved CANNOT_DUTY blocks a date", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule: { ...BASE_DUTY_RULE, minDaysBetweenDuties: 0 },
      pharmacies: threePharmacies(),
      dutyRequests: [{ pharmacyId: "ph-a", requestType: "CANNOT_DUTY", status: "APPROVED", startDay: 1, endDay: 3 }],
    };
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-01", "2026-09-02"]);
  });

  it("14. approved EMERGENCY_EXCUSE blocks a date", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule: { ...BASE_DUTY_RULE, minDaysBetweenDuties: 0 },
      pharmacies: threePharmacies(),
      dutyRequests: [
        { pharmacyId: "ph-a", requestType: "EMERGENCY_EXCUSE", status: "APPROVED", startDay: 1, endDay: 3 },
      ],
    };
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-01", "2026-09-02"]);
  });

  it("15. approved PREFER_DUTY prioritizes on equal load", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule: { ...BASE_DUTY_RULE, minDaysBetweenDuties: 0 },
      pharmacies: threePharmacies(),
      dutyRequests: [{ pharmacyId: "ph-c", requestType: "PREFER_DUTY", status: "APPROVED", startDay: 1, endDay: 1 }],
    };
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-01"]);
    expect(v1ByDate(v1).get("2026-09-01")?.[0]?.pharmacyId).toBe("ph-c");
  });

  it("16. historical weighted load seeds fairness ordering", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule: { ...BASE_DUTY_RULE, minDaysBetweenDuties: 0 },
      pharmacies: threePharmacies(),
      historicalAssignments: [
        { pharmacyId: "ph-a", date: "2026-08-01", weight: 5 },
        { pharmacyId: "ph-b", date: "2026-08-01", weight: 1 },
      ],
    };
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-01"]);
    expect(v1ByDate(v1).get("2026-09-01")?.[0]?.pharmacyId).toBe("ph-c"); // zero load wins
  });

  it("17. historical last-duty interval carries into the period (sequential-relaxation-contract corrective: full period, previously narrowed to 09-01/09-02 only)", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule: { ...BASE_DUTY_RULE, minDaysBetweenDuties: 5 },
      pharmacies: threePharmacies(),
      historicalAssignments: [{ pharmacyId: "ph-a", date: "2026-08-30", weight: 1 }],
    };
    const { v1, v2 } = runBothPaths(f);
    // ph-a served 2026-08-30; minDaysBetweenDuties=5 excludes it from
    // strict eligibility through 2026-09-04. By 2026-09-03, ph-b
    // (09-01) and ph-c (09-02) have ALSO fallen inside the interval
    // window (this run's own sequential picks), so every candidate is
    // simultaneously interval-excluded — the exact confirmed
    // divergence this corrective fixes. Previously this assertion was
    // narrowed to 09-01/09-02 only because V2 selected the wrong
    // pharmacy (ph-b) on 09-03 instead of V1's ph-a. Now asserted over
    // the FULL period, not narrowed.
    assertSelectionEquivalence(v1, v2, allDates(f));
    expect(v1ByDate(v1).get("2026-09-03")?.[0]?.pharmacyId).toBe("ph-a");
    expect(v2ByDate(v2).get("2026-09-03")?.[0]?.pharmacyId).toBe("ph-a");
    expect(v1ByDate(v1).get("2026-09-01")?.[0]?.pharmacyId).not.toBe("ph-a");
  });

  it("18. balance adjustment shifts fairness ordering independent of history", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule: { ...BASE_DUTY_RULE, minDaysBetweenDuties: 0 },
      pharmacies: threePharmacies(),
      openingBalance: { "ph-a": 10, "ph-b": 10 },
    };
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-01"]);
    expect(v1ByDate(v1).get("2026-09-01")?.[0]?.pharmacyId).toBe("ph-c");
  });

  it("19. inactive pharmacy is excluded from the pool entirely", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule: { ...BASE_DUTY_RULE, minDaysBetweenDuties: 0 },
      pharmacies: [
        { id: "ph-a", name: "Ada Eczanesi", isActive: false },
        { id: "ph-b", name: "Barış Eczanesi", isActive: true },
      ],
    };
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-01"]);
    expect(v1ByDate(v1).get("2026-09-01")?.[0]?.pharmacyId).toBe("ph-b");
  });

  it("20. minimum-day-interval relaxation when strictly-eligible candidates are insufficient", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 2,
      dutyRule: { ...BASE_DUTY_RULE, minDaysBetweenDuties: 30 },
      pharmacies: threePharmacies(),
      historicalAssignments: [
        { pharmacyId: "ph-a", date: "2026-08-31", weight: 1 },
        { pharmacyId: "ph-b", date: "2026-08-31", weight: 1 },
      ],
    };
    const { v1, v2 } = runBothPaths(f);
    // Only ph-c is strictly eligible on 09-01, but dailyDutyCount=2 —
    // V1 relaxes the interval and pulls in one of ph-a/ph-b.
    assertSelectionEquivalence(v1, v2, ["2026-09-01"]);
    expect(v1ByDate(v1).get("2026-09-01")).toHaveLength(2);
  });

  it("21. quota greater than eligible candidates produces equivalent underfill", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 5,
      dutyRule: { ...BASE_DUTY_RULE, minDaysBetweenDuties: 0 },
      pharmacies: threePharmacies(),
    };
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-01"]);
    assertUnderfillEquivalence(v1, v2);
    expect(v1ByDate(v1).get("2026-09-01")).toHaveLength(3);
  });

  it("22. Turkish-locale name tie-break", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule: { ...BASE_DUTY_RULE, minDaysBetweenDuties: 0 },
      pharmacies: [
        { id: "ph-z", name: "Zafer Eczanesi", isActive: true },
        { id: "ph-c", name: "Çınar Eczanesi", isActive: true },
      ],
    };
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-01"]);
    expect(v1ByDate(v1).get("2026-09-01")?.[0]?.pharmacyId).toBe("ph-c"); // Ç < Z under tr locale
  });

  it("23. exact deterministic tie (fully tied candidates, ascending-id input order)", () => {
    // V1's ONLY tie-break beyond its documented chain is Array.sort's
    // stability, which preserves input array order for a full tie — an
    // implementation artifact, not a specified rule. V2 deliberately
    // replaces this with an explicit CANDIDATE_KEY_ASC final fallback
    // (order-independent, always pharmacyId-derived-key ascending).
    // Supplying pharmacies to V1 in ascending-id order makes both
    // resolve to the same winner — the intended, documented alignment.
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule: { ...BASE_DUTY_RULE, minDaysBetweenDuties: 0 },
      pharmacies: [
        { id: "ph-a", name: "Aynı İsim", isActive: true },
        { id: "ph-b", name: "Aynı İsim", isActive: true },
        { id: "ph-c", name: "Aynı İsim", isActive: true },
      ],
    };
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-01"]);
    expect(v1ByDate(v1).get("2026-09-01")?.[0]?.pharmacyId).toBe("ph-a");
  });

  it("24. dailyDutyCount > 1 with mixed strict and relaxed candidates across a multi-day period", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 2,
      dutyRule: { ...BASE_DUTY_RULE, minDaysBetweenDuties: 2 },
      pharmacies: [
        { id: "ph-a", name: "Ada Eczanesi", isActive: true },
        { id: "ph-b", name: "Barış Eczanesi", isActive: true },
        { id: "ph-c", name: "Can Eczanesi", isActive: true },
        { id: "ph-d", name: "Deniz Eczanesi", isActive: true },
      ],
    };
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, allDates(f).slice(0, 10));
    assertUnderfillEquivalence(v1, v2);
  });
});

describe("V1 golden equivalence — holiday overlap resolution (Part 6 corrective)", () => {
  function overlapFixture(
    holidays: ScenarioFixture["holidays"]
  ): ScenarioFixture {
    return {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule: { ...BASE_DUTY_RULE, minDaysBetweenDuties: 0 },
      pharmacies: threePharmacies(),
      holidays,
      holidayOverlapResolutionMode: "V1_LAST_INPUT_WINS",
    };
  }

  it("1. OFFICIAL then RELIGIOUS — V1's last-write wins (RELIGIOUS)", () => {
    const f = overlapFixture([
      { day: 15, name: "Resmi", type: "OFFICIAL" },
      { day: 15, name: "Dini", type: "RELIGIOUS" },
    ]);
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-15"]);
    expect(v1ByDate(v1).get("2026-09-15")?.[0]?.weight).toBe(2.5);
  });

  it("2. RELIGIOUS then OFFICIAL — V1's last-write wins (OFFICIAL)", () => {
    const f = overlapFixture([
      { day: 15, name: "Dini", type: "RELIGIOUS" },
      { day: 15, name: "Resmi", type: "OFFICIAL" },
    ]);
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-15"]);
    expect(v1ByDate(v1).get("2026-09-15")?.[0]?.weight).toBe(2);
  });

  it("3. OFFICIAL then OTHER — both weight buckets equal, trivially consistent", () => {
    const f = overlapFixture([
      { day: 15, name: "Resmi", type: "OFFICIAL" },
      { day: 15, name: "Diğer", type: "OTHER" },
    ]);
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-15"]);
    expect(v1ByDate(v1).get("2026-09-15")?.[0]?.weight).toBe(2);
  });

  it("4. OTHER then OFFICIAL — both weight buckets equal, trivially consistent", () => {
    const f = overlapFixture([
      { day: 15, name: "Diğer", type: "OTHER" },
      { day: 15, name: "Resmi", type: "OFFICIAL" },
    ]);
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-15"]);
    expect(v1ByDate(v1).get("2026-09-15")?.[0]?.weight).toBe(2);
  });

  it("5. RELIGIOUS then OTHER — V1's last-write wins (OTHER → official-bucket weight)", () => {
    const f = overlapFixture([
      { day: 15, name: "Dini", type: "RELIGIOUS" },
      { day: 15, name: "Diğer", type: "OTHER" },
    ]);
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-15"]);
    expect(v1ByDate(v1).get("2026-09-15")?.[0]?.weight).toBe(2);
  });

  it("6. duplicate same-type holiday entries — no ambiguity, weight unaffected", () => {
    const f = overlapFixture([
      { day: 15, name: "Resmi A", type: "OFFICIAL" },
      { day: 15, name: "Resmi B", type: "OFFICIAL" },
    ]);
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-15"]);
    expect(v1ByDate(v1).get("2026-09-15")?.[0]?.weight).toBe(2);
  });

  it("7. three overlapping holiday entries — last-write-wins holds regardless of count", () => {
    const f = overlapFixture([
      { day: 15, name: "Resmi", type: "OFFICIAL" },
      { day: 15, name: "Diğer", type: "OTHER" },
      { day: 15, name: "Dini", type: "RELIGIOUS" },
    ]);
    const { v1, v2 } = runBothPaths(f);
    assertSelectionEquivalence(v1, v2, ["2026-09-15"]);
    expect(v1ByDate(v1).get("2026-09-15")?.[0]?.weight).toBe(2.5); // RELIGIOUS last
  });

  it("native V2 precedence stays RELIGIOUS-first and order-independent even with 3 overlapping entries", () => {
    const orderA = overlapFixture([
      { day: 15, name: "Resmi", type: "OFFICIAL" },
      { day: 15, name: "Diğer", type: "OTHER" },
      { day: 15, name: "Dini", type: "RELIGIOUS" },
    ]);
    orderA.holidayOverlapResolutionMode = "NATIVE_PRECEDENCE";
    const orderB = overlapFixture([
      { day: 15, name: "Dini", type: "RELIGIOUS" },
      { day: 15, name: "Diğer", type: "OTHER" },
      { day: 15, name: "Resmi", type: "OFFICIAL" },
    ]);
    orderB.holidayOverlapResolutionMode = "NATIVE_PRECEDENCE";
    const a = buildDutyEngineContext(buildV2Input(orderA));
    const b = buildDutyEngineContext(buildV2Input(orderB));
    const weightOn15 = (result: DutyEngineDraftResult) =>
      result.selectionInputs.find((s) => s.slot.date === "2026-09-15")!.fairnessFacts[0].dateWeight;
    expect(weightOn15(a)).toBe(2.5);
    expect(weightOn15(b)).toBe(2.5);
    expect(a.resultFingerprint).toBe(b.resultFingerprint);
  });
});

describe("V1 golden equivalence — determinism (Part 6)", () => {
  it("25. repeated execution three times is byte-identical on both paths", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 2,
      dutyRule: BASE_DUTY_RULE,
      pharmacies: [...threePharmacies(), { id: "ph-d", name: "Deniz Eczanesi", isActive: true }],
      holidays: [{ day: 15, name: "Test Tatil", type: "OFFICIAL" }],
    };
    const runs = [1, 2, 3].map(() => runBothPaths(f));
    for (const { v1, v2 } of runs) {
      assertSelectionEquivalence(v1, v2, allDates(f));
    }
    const v2Fingerprints = runs.map((r) => r.v2.resultFingerprint);
    expect(new Set(v2Fingerprints).size).toBe(1);
    const v1Serialized = runs.map((r) => JSON.stringify(r.v1.assignments.map((a) => [toDateKey(a.date), a.pharmacyId, a.weight])));
    expect(new Set(v1Serialized).size).toBe(1);
  });
});

describe("V1 golden equivalence — provenance (Part 4)", () => {
  it("provisionalSelectionFingerprint changes when the selected pharmacy set changes", () => {
    const f: ScenarioFixture = {
      organizationId: "org-1",
      regionId: "region-1",
      year: 2026,
      month: 9,
      dailyDutyCount: 1,
      dutyRule: { ...BASE_DUTY_RULE, minDaysBetweenDuties: 0 },
      pharmacies: threePharmacies(),
    };
    const a = buildDutyEngineContext(buildV2Input(f));
    const f2: ScenarioFixture = { ...f, openingBalance: { "ph-a": 100 } };
    const b = buildDutyEngineContext(buildV2Input(f2));
    expect(a.resultFingerprint).not.toBe(b.resultFingerprint);
    expect(a.provenance.strategySetFingerprint).toBe(b.provenance.strategySetFingerprint);
  });
});
