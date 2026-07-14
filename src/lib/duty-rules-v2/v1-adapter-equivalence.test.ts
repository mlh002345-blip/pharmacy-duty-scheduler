// Golden equivalence harness for the V1 compatibility adapter.
//
// LEVEL A — configuration equivalence: every V1 field maps exactly and
// nothing is silently dropped (v1-adapter.test.ts covers field-level
// detail; here the round-trip proves it wholesale).
//
// LEVEL B — round-trip semantic preservation: for 15 synthetic,
// city-independent fixtures, the ORIGINAL normalized V1 configuration
// equals the configuration reconstructed through
//   V1 input → adaptV1RuleToV2Config → projectAdaptedConfigToV1,
// and running the UNCHANGED V1 engine (generate-duty-schedule.ts) on
// both produces byte-for-byte identical assignments, warnings, and
// info. No V2 scheduler exists or is simulated here — both executions
// use the same V1 engine, which is exactly what makes this a valid
// compatibility proof.
import { describe, expect, it } from "vitest";

import {
  generateDutySchedule,
  type DutyRequestInput,
  type GenerateDutyScheduleParams,
  type HolidayInput,
  type HistoricalAssignmentInput,
  type UnavailabilityInput,
} from "@/lib/scheduling/generate-duty-schedule";
import {
  adaptV1RuleToV2Config,
  canonicalSerialize,
  projectAdaptedConfigToV1,
  validateAdaptedConfig,
  type V1AdapterInput,
} from "./v1-adapter";

// --- Synthetic, chamber-independent fixture factory ------------------------

const TURKISH_NAME_PARTS = [
  "Çınar", "Şifa", "Umut", "Işık", "Güneş", "Yıldız", "Öz Deva", "İnci",
  "Lâle", "Doğa", "Pınar", "Yağmur", "Deniz", "Gökkuşağı", "Zeytin",
];

function makePharmacies(count: number, regionId: string, inactiveIds: number[] = []) {
  return Array.from({ length: count }, (_, i) => ({
    id: `ph-${String(i + 1).padStart(3, "0")}`,
    name: `${TURKISH_NAME_PARTS[i % TURKISH_NAME_PARTS.length]} Eczanesi ${i + 1}`,
    isActive: !inactiveIds.includes(i + 1),
    regionId,
  }));
}

function makeAdapterInput(overrides: {
  pharmacyCount?: number;
  inactiveIds?: number[];
  dailyDutyCount?: number;
  minDaysBetweenDuties?: number;
  weights?: Partial<V1AdapterInput["dutyRule"]>;
} = {}): V1AdapterInput {
  const regionId = "region-eq";
  return {
    organizationId: "org-eq",
    region: {
      id: regionId,
      organizationId: "org-eq",
      name: "Eşdeğerlik Bölgesi",
      dailyDutyCount: overrides.dailyDutyCount ?? 1,
    },
    dutyRule: {
      id: "rule-eq",
      regionId,
      minDaysBetweenDuties: overrides.minDaysBetweenDuties ?? 2,
      weekdayWeight: 1,
      saturdayWeight: 1.25,
      sundayWeight: 1.5,
      officialHolidayWeight: 2,
      religiousHolidayWeight: 2.5,
      ...overrides.weights,
    },
    pharmacies: makePharmacies(overrides.pharmacyCount ?? 15, regionId, overrides.inactiveIds ?? []),
  };
}

type Runtime = {
  month: number;
  year: number;
  holidays: HolidayInput[];
  unavailabilities: UnavailabilityInput[];
  historicalAssignments: HistoricalAssignmentInput[];
  openingBalance?: Map<string, number>;
  dutyRequests?: DutyRequestInput[];
};

const BASE_RUNTIME: Runtime = {
  month: 8,
  year: 2026,
  holidays: [],
  unavailabilities: [],
  historicalAssignments: [],
};

// The V1 engine's own effective configuration view of an adapter input:
// active in-region pharmacies (the engine filters exactly this way at
// generate-duty-schedule.ts:177), sorted for comparison stability.
function normalizeV1Config(input: V1AdapterInput) {
  return {
    regionId: input.region.id,
    dailyDutyCount: input.region.dailyDutyCount,
    dutyRule: {
      minDaysBetweenDuties: input.dutyRule.minDaysBetweenDuties,
      weekdayWeight: input.dutyRule.weekdayWeight,
      saturdayWeight: input.dutyRule.saturdayWeight,
      sundayWeight: input.dutyRule.sundayWeight,
      officialHolidayWeight: input.dutyRule.officialHolidayWeight,
      religiousHolidayWeight: input.dutyRule.religiousHolidayWeight,
    },
    pharmacies: input.pharmacies
      .filter((p) => p.isActive && p.regionId === input.region.id)
      .map((p) => ({ id: p.id, name: p.name, isActive: true, regionId: p.regionId }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}

function runV1(input: V1AdapterInput, runtime: Runtime, pharmacies?: GenerateDutyScheduleParams["pharmacies"]) {
  return generateDutySchedule({
    month: runtime.month,
    year: runtime.year,
    regionId: input.region.id,
    dailyDutyCount: input.region.dailyDutyCount,
    dutyRule: {
      minDaysBetweenDuties: input.dutyRule.minDaysBetweenDuties,
      weekdayWeight: input.dutyRule.weekdayWeight,
      saturdayWeight: input.dutyRule.saturdayWeight,
      sundayWeight: input.dutyRule.sundayWeight,
      officialHolidayWeight: input.dutyRule.officialHolidayWeight,
      religiousHolidayWeight: input.dutyRule.religiousHolidayWeight,
    },
    pharmacies: pharmacies ?? input.pharmacies,
    holidays: runtime.holidays,
    unavailabilities: runtime.unavailabilities,
    historicalAssignments: runtime.historicalAssignments,
    openingBalance: runtime.openingBalance,
    dutyRequests: runtime.dutyRequests,
  });
}

// The complete round-trip assertion used by every fixture:
//   1. adapted config validates cleanly,
//   2. normalized original config === reconstructed config (semantic
//      round-trip),
//   3. the UNCHANGED V1 engine produces byte-identical output from the
//      original input and from the reconstructed configuration.
function assertRoundTrip(input: V1AdapterInput, runtime: Runtime) {
  const config = adaptV1RuleToV2Config(input);
  expect(validateAdaptedConfig(config)).toEqual([]);

  const reconstructed = projectAdaptedConfigToV1(config);
  expect(canonicalSerialize(reconstructed)).toBe(canonicalSerialize(normalizeV1Config(input)));

  const original = runV1(input, runtime);
  const viaAdapter = runV1(input, runtime, reconstructed.pharmacies);
  expect(JSON.stringify(viaAdapter)).toBe(JSON.stringify(original));
  return { config, original };
}

describe("V1 ↔ V2 adapter equivalence (golden harness)", () => {
  it("fixture 1: 15 pharmacies, dailyDutyCount = 1", () => {
    const { original } = assertRoundTrip(makeAdapterInput(), BASE_RUNTIME);
    expect(original.assignments).toHaveLength(31); // one per August day
  });

  it("fixture 2: 30 pharmacies, dailyDutyCount = 1", () => {
    assertRoundTrip(makeAdapterInput({ pharmacyCount: 30 }), BASE_RUNTIME);
  });

  it("fixture 3 & 12: 100 pharmacies, dailyDutyCount = 3 (multiple assignments per date)", () => {
    const { original } = assertRoundTrip(
      makeAdapterInput({ pharmacyCount: 100, dailyDutyCount: 3 }),
      BASE_RUNTIME
    );
    expect(original.assignments).toHaveLength(31 * 3);
    const firstDay = original.assignments.filter((a) => a.date.getUTCDate() === 1);
    expect(firstDay).toHaveLength(3);
    expect(new Set(firstDay.map((a) => a.pharmacyId)).size).toBe(3);
  });

  it("fixture 4: dailyDutyCount greater than eligible pharmacies produces identical warnings", () => {
    const input = makeAdapterInput({ pharmacyCount: 4, dailyDutyCount: 3 });
    const runtime: Runtime = {
      ...BASE_RUNTIME,
      // Two pharmacies unavailable the whole month: only 2 eligible on
      // every date, but 3 are required.
      unavailabilities: [
        { pharmacyId: "ph-001", startDate: new Date("2026-08-01"), endDate: new Date("2026-08-31") },
        { pharmacyId: "ph-002", startDate: new Date("2026-08-01"), endDate: new Date("2026-08-31") },
      ],
    };
    const { original } = assertRoundTrip(input, runtime);
    expect(original.warnings.length).toBeGreaterThan(0);
  });

  it("fixture 5: holidays of every type use their configured weights identically", () => {
    const runtime: Runtime = {
      ...BASE_RUNTIME,
      holidays: [
        { date: new Date("2026-08-05"), name: "Resmî Gün", type: "OFFICIAL" },
        { date: new Date("2026-08-10"), name: "Dinî Gün", type: "RELIGIOUS" },
        { date: new Date("2026-08-15"), name: "Diğer Gün", type: "OTHER" },
      ],
    };
    const { original } = assertRoundTrip(makeAdapterInput(), runtime);
    const w = (day: number) =>
      original.assignments.find((a) => a.date.getUTCDate() === day)!.weight;
    expect(w(5)).toBe(2); // official
    expect(w(10)).toBe(2.5); // religious
    expect(w(15)).toBe(2); // OTHER shares the official weight (V1 semantics)
  });

  it("fixture 6: Saturday and Sunday weighting preserved", () => {
    const { original } = assertRoundTrip(makeAdapterInput(), BASE_RUNTIME);
    // 2026-08-01 is a Saturday, 2026-08-02 a Sunday.
    expect(original.assignments.find((a) => a.date.getUTCDate() === 1)!.weight).toBe(1.25);
    expect(original.assignments.find((a) => a.date.getUTCDate() === 2)!.weight).toBe(1.5);
  });

  it("fixture 7: unavailability blocks dates without ejecting the pharmacy from the pool", () => {
    const input = makeAdapterInput();
    const runtime: Runtime = {
      ...BASE_RUNTIME,
      unavailabilities: [
        { pharmacyId: "ph-001", startDate: new Date("2026-08-01"), endDate: new Date("2026-08-20") },
      ],
    };
    const { config, original } = assertRoundTrip(input, runtime);
    // Still a pool member (membership ≠ date eligibility)…
    expect(config.rotationPool.memberships.some((m) => m.pharmacyId === "ph-001")).toBe(true);
    // …but never assigned inside the blocked window.
    expect(
      original.assignments.some(
        (a) => a.pharmacyId === "ph-001" && a.date.getUTCDate() <= 20
      )
    ).toBe(false);
  });

  it("fixtures 8 & 9: historical duties and balance adjustments (opening balance) preserved", () => {
    const runtime: Runtime = {
      ...BASE_RUNTIME,
      historicalAssignments: [
        { pharmacyId: "ph-001", date: new Date("2026-07-30"), weight: 2 },
        { pharmacyId: "ph-002", date: new Date("2026-07-15"), weight: 1 },
      ],
      openingBalance: new Map([
        ["ph-003", 5], // manual adjustment: heavily pre-loaded
        ["ph-004", -2],
      ]),
    };
    assertRoundTrip(makeAdapterInput(), runtime);
  });

  it("fixture 10: inactive pharmacies are excluded from membership but never silently lost", () => {
    const input = makeAdapterInput({ pharmacyCount: 15, inactiveIds: [3, 7] });
    const { config } = assertRoundTrip(input, BASE_RUNTIME);
    expect(config.rotationPool.memberships).toHaveLength(13);
    expect(config.rotationPool.excluded.map((e) => e.pharmacyId).sort()).toEqual([
      "ph-003",
      "ph-007",
    ]);
  });

  it("fixture 11: minimum-interval pressure (small pool, long interval) relaxes identically", () => {
    // 3 pharmacies, 5-day minimum interval: V1 must relax the interval
    // to fill every day — both paths must relax identically.
    assertRoundTrip(
      makeAdapterInput({ pharmacyCount: 3, minDaysBetweenDuties: 5 }),
      BASE_RUNTIME
    );
  });

  it("fixture 13: Turkish names and characters survive the round-trip byte-for-byte", () => {
    const input = makeAdapterInput();
    const config = adaptV1RuleToV2Config(input);
    const names = config.rotationPool.memberships.map((m) => m.name).join("|");
    expect(names).toContain("Çınar");
    expect(names).toContain("Işık");
    expect(names).toContain("Öz Deva");
    assertRoundTrip(input, BASE_RUNTIME);
  });

  it("fixture 14: deterministic tie scenario (identical loads) resolves identically through both paths", () => {
    // Fresh pharmacies, zero history: every candidate ties on every
    // metric, forcing the final Turkish-locale name tie-breaker.
    const input = makeAdapterInput({ pharmacyCount: 5, minDaysBetweenDuties: 0 });
    const { original } = assertRoundTrip(input, BASE_RUNTIME);
    const rerun = runV1(input, BASE_RUNTIME);
    expect(JSON.stringify(rerun)).toBe(JSON.stringify(original));
  });

  it("fixture 15: two organizations with identical region/rule names adapt independently without collision", () => {
    const inputA = makeAdapterInput();
    const inputB: V1AdapterInput = {
      organizationId: "org-two",
      region: { id: "region-two", organizationId: "org-two", name: "Eşdeğerlik Bölgesi", dailyDutyCount: 1 },
      dutyRule: { ...makeAdapterInput().dutyRule, id: "rule-two", regionId: "region-two" },
      pharmacies: makePharmacies(15, "region-two"),
    };
    const a = assertRoundTrip(inputA, BASE_RUNTIME);
    const b = assertRoundTrip(inputB, BASE_RUNTIME);
    expect(a.config.plan.key).not.toBe(b.config.plan.key);
    expect(a.config.plan.name).toBe(b.config.plan.name);
  });

  it("determinism: three consecutive adapter+engine runs are byte-identical (with requests in play)", () => {
    const input = makeAdapterInput({ pharmacyCount: 20, dailyDutyCount: 2 });
    const runtime: Runtime = {
      ...BASE_RUNTIME,
      dutyRequests: [
        {
          pharmacyId: "ph-005",
          requestType: "CANNOT_DUTY",
          status: "APPROVED",
          startDate: new Date("2026-08-10"),
          endDate: new Date("2026-08-14"),
        },
        {
          pharmacyId: "ph-006",
          requestType: "PREFER_DUTY",
          status: "APPROVED",
          startDate: new Date("2026-08-20"),
          endDate: new Date("2026-08-22"),
        },
      ],
    };
    const runs = [1, 2, 3].map(() => {
      const config = adaptV1RuleToV2Config(input);
      const reconstructed = projectAdaptedConfigToV1(config);
      return (
        canonicalSerialize(config) +
        "::" +
        JSON.stringify(runV1(input, runtime, reconstructed.pharmacies))
      );
    });
    expect(runs[0]).toBe(runs[1]);
    expect(runs[1]).toBe(runs[2]);
  });
});
