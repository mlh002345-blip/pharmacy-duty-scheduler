import { describe, expect, it } from "vitest";

import { canonicalSerialize } from "../v1-adapter";
import { adaptV1RuleToV2Config } from "../v1-adapter";
import { buildDutyEngineContext, runtimeInputHash, ENGINE_DOMAIN_VERSION } from "./build-engine-context";
import { calculateFairnessFacts, resolveDateWeight } from "./calculate-fairness-facts";
import { membershipSnapshotHash } from "./build-selection-input";
import { resolveCalendarContext } from "./resolve-calendar-context";
import { indexRuntimeFacts, resolveCandidates } from "./resolve-candidates";
import { resolveDayType } from "./resolve-day-type";
import { resolvePool } from "./resolve-pool";
import { resolveRotationFacts } from "./resolve-rotation-facts";
import { resolveShifts } from "./resolve-shifts";
import { resolveSlots } from "./resolve-slots";
import { DutyEngineError, type DutyEngineInput } from "./domain/engine-input";
import { makeEngineInput, makeLoadedPlan } from "./test-support/fixtures";
import type { LoadedDutyPlanVersion } from "../domain/loaded-plan";

function poolFor(plan: LoadedDutyPlanVersion, input: DutyEngineInput, date: string) {
  const [context] = resolveCalendarContext({ periodStart: date, periodEnd: date, holidays: input.holidays, customDayOverrides: [] });
  const dayType = resolveDayType(context, plan.dayTypeRules);
  const { shifts } = resolveShifts(dayType, plan);
  const { slots } = resolveSlots(dayType, shifts, plan);
  const pool = resolvePool(slots[0], plan);
  if (!pool) throw new Error("fixture must resolve");
  return { slot: slots[0], pool, candidates: resolveCandidates(slots[0], pool, indexRuntimeFacts(input)) };
}

describe("fairness facts", () => {
  const plan = makeLoadedPlan();

  it("derives every load component from its documented source", () => {
    const input = makeEngineInput(plan, {
      periodStart: "2026-08-03",
      periodEnd: "2026-08-09",
      historicalDuties: [
        { pharmacyId: "ph-a", date: "2026-07-04", weight: 1.25 }, // a Saturday
        { pharmacyId: "ph-a", date: "2026-07-10", weight: 1 },
      ],
      balanceAdjustments: [{ pharmacyId: "ph-a", amount: 2 }],
      existingAssignments: [
        { pharmacyId: "ph-a", date: "2026-08-04", slotKey: null, weight: 2 }, // holiday date below
      ],
      holidays: [{ date: "2026-08-04", name: "Resmî", type: "OFFICIAL" }],
      dutyRequests: [
        { pharmacyId: "ph-a", requestType: "PREFER_DUTY", status: "APPROVED", startDate: "2026-08-05", endDate: "2026-08-05" },
      ],
    });
    const { candidates } = poolFor(plan, input, "2026-08-05");
    const candidate = candidates.find((c) => c.pharmacyId === "ph-a")!;
    const facts = calculateFairnessFacts({
      candidate,
      dayTypeKey: "WEEKDAY",
      shift: { defaultWeight: 1 },
      policy: input.policy,
      holidayDates: new Set(["2026-08-04"]),
    });
    expect(facts.historicalWeightedLoad).toBe(2.25); // persisted history
    expect(facts.historicalDutyCount).toBe(2);
    expect(facts.balanceAdjustment).toBe(2); // adjustments
    expect(facts.currentPeriodWeightedLoad).toBe(2); // period assignments
    expect(facts.totalWeightedLoad).toBe(6.25);
    expect(facts.dateWeight).toBe(1); // plan config via policy
    expect(facts.projectedLoadIfAssigned).toBe(7.25);
    expect(facts.totalAssignmentCount).toBe(3);
    expect(facts.weekendCount).toBe(1); // history Saturday; period Tue is not
    expect(facts.sundayCount).toBe(0);
    expect(facts.holidayCount).toBe(1); // the period assignment on 08-04
    expect(facts.lastDutyDate).toBe("2026-08-04");
    expect(facts.daysSinceLastDuty).toBe(1);
    expect(facts.prefersThisDate).toBe(true);
    expect(facts.nameTieBreakValue).toBe("Çınar Eczanesi"); // Turkish tie value
  });

  it("weights: Saturday/Sunday/holiday day types multiply the shift defaultWeight; missing weight is a typed error", () => {
    const policy = makeEngineInput(plan).policy;
    expect(resolveDateWeight("SATURDAY", { defaultWeight: 1 }, policy)).toBe(1.25);
    expect(resolveDateWeight("SUNDAY", { defaultWeight: 2 }, policy)).toBe(3);
    expect(resolveDateWeight("RELIGIOUS_HOLIDAY", { defaultWeight: 1 }, policy)).toBe(2.5);
    expect(() => resolveDateWeight("WEEKDAY|Bilinmez", { defaultWeight: 1 }, policy)).toThrowError(
      expect.objectContaining({ code: "UNKNOWN_DAY_TYPE_WEIGHT" }) as unknown as Error
    );
  });
});

describe("rotation facts", () => {
  it("provides cursor, distance, position, and carried-forward facts for every strategy — without mutating state", () => {
    for (const strategy of ["SEQUENTIAL", "FAIRNESS_SCORE", "WEIGHTED", "MANUAL_ORDER"] as const) {
      const plan = makeLoadedPlan((p) => {
        p.rotationPools[0].strategy = strategy;
        p.rotationPools[0].memberships[0].sortIndex = 2; // m-a
        p.rotationPools[0].memberships[1].sortIndex = 0; // m-b
        p.rotationPools[0].memberships[2].sortIndex = 1; // m-c
        p.rotationPools[0].rotationStates = [
          {
            id: "rs-1",
            dayTypeScope: "ALL",
            currentRound: 3,
            lockVersion: 5,
            carriedForward: [
              { membershipId: "m-c", reason: "UNAVAILABLE", periodKey: "2026-07" },
            ],
            lastServedMembershipId: "m-b",
          },
        ];
      });
      const input = makeEngineInput(plan);
      const frozen = canonicalSerialize(plan);
      const { pool, candidates } = poolFor(plan, input, "2026-08-03");

      const facts = candidates.map((c) => resolveRotationFacts(c, pool, "WEEKDAY"));
      const byMembership = new Map(facts.map((f) => [f.membershipId, f]));
      // Snapshot ordering: sortIndex asc → m-b(0), m-c(1), m-a(2).
      expect(byMembership.get("m-b")).toMatchObject({
        strategy,
        stateScope: "ALL",
        currentRound: 3,
        isCursor: true,
        manualOrderPosition: 0,
        distanceFromCursor: 3, // just served → a full round away
      });
      expect(byMembership.get("m-c")).toMatchObject({
        isCursor: false,
        manualOrderPosition: 1,
        distanceFromCursor: 1, // next in order
        carriedForward: [{ reason: "UNAVAILABLE", periodKey: "2026-07" }],
      });
      expect(byMembership.get("m-a")?.distanceFromCursor).toBe(2);
      // No state mutation anywhere in the pipeline.
      expect(canonicalSerialize(plan)).toBe(frozen);
    }
  });

  it("prefers an exact day-type-scope state and reports null facts without any state", () => {
    const plan = makeLoadedPlan((p) => {
      p.rotationPools[0].rotationStates = [
        { id: "rs-all", dayTypeScope: "ALL", currentRound: 1, lockVersion: 0, carriedForward: [], lastServedMembershipId: null },
        { id: "rs-sunday", dayTypeScope: "SUNDAY", currentRound: 9, lockVersion: 0, carriedForward: [], lastServedMembershipId: "m-a" },
      ];
    });
    const input = makeEngineInput(plan);
    const { pool, candidates } = poolFor(plan, input, "2026-08-03");
    expect(resolveRotationFacts(candidates[0], pool, "SUNDAY").currentRound).toBe(9);
    expect(resolveRotationFacts(candidates[0], pool, "WEEKDAY").currentRound).toBe(1);
    // Missing cursor → null distance.
    expect(resolveRotationFacts(candidates[0], pool, "WEEKDAY").distanceFromCursor).toBeNull();

    const stateless = makeLoadedPlan((p) => {
      p.rotationPools[0].rotationStates = [];
    });
    const bare = poolFor(stateless, makeEngineInput(stateless), "2026-08-03");
    const facts = resolveRotationFacts(bare.candidates[0], bare.pool, "WEEKDAY");
    expect(facts).toMatchObject({ stateScope: null, currentRound: null, cursorMembershipId: null, distanceFromCursor: null });
  });
});

describe("orchestrator: provenance and determinism", () => {
  const plan = makeLoadedPlan();

  it("carries mandatory snapshot provenance on every SelectionInput and the run", () => {
    const input = makeEngineInput(plan);
    const result = buildDutyEngineContext(input);
    expect(result.provenance).toMatchObject({
      configurationFingerprint: "cfg-fingerprint-test",
      loaderVersion: 1,
      engineVersion: ENGINE_DOMAIN_VERSION,
      planVersionId: "pv-1",
      organizationId: "org-1",
      regionId: "region-1",
    });
    expect(result.provenance.runtimeInputHash).toMatch(/^[0-9a-f]{64}$/);
    for (const selection of result.selectionInputs) {
      expect(selection.provenance.configurationFingerprint).toBe("cfg-fingerprint-test");
      expect(selection.provenance.membershipSnapshotHash).toMatch(/^[0-9a-f]{64}$/);
      expect(selection.provenance.effectiveDate).toBe(selection.slot.date);
      expect(selection.provenance.runtimeInputHash).toBe(result.provenance.runtimeInputHash);
    }
  });

  it("membershipSnapshotHash changes when pharmacy active state OR membership changes", () => {
    const input = makeEngineInput(plan);
    const base = poolFor(plan, input, "2026-08-03").pool;

    const inactivePlan = makeLoadedPlan((p) => {
      p.rotationPools[0].memberships[0].pharmacyIsActive = false;
    });
    const inactive = poolFor(inactivePlan, makeEngineInput(inactivePlan), "2026-08-03").pool;
    expect(membershipSnapshotHash(inactive)).not.toBe(membershipSnapshotHash(base));

    const leftPlan = makeLoadedPlan((p) => {
      p.rotationPools[0].memberships[1].leftOn = "2026-08-01";
    });
    const left = poolFor(leftPlan, makeEngineInput(leftPlan), "2026-08-03").pool;
    expect(membershipSnapshotHash(left)).not.toBe(membershipSnapshotHash(base));
  });

  it("runtimeInputHash changes when unavailability changes; result fingerprint follows", () => {
    const base = makeEngineInput(plan);
    const withUnavailability = makeEngineInput(plan, {
      unavailability: [{ pharmacyId: "ph-a", startDate: "2026-08-03", endDate: "2026-08-03" }],
    });
    expect(runtimeInputHash(withUnavailability)).not.toBe(runtimeInputHash(base));
    expect(buildDutyEngineContext(withUnavailability).resultFingerprint).not.toBe(
      buildDutyEngineContext(base).resultFingerprint
    );
  });

  it("shuffled equivalent input yields byte-identical output, ×3 runs", () => {
    const input = makeEngineInput(plan, {
      holidays: [
        { date: "2026-08-04", name: "Resmî", type: "OFFICIAL" },
        { date: "2026-08-05", name: "Dinî", type: "RELIGIOUS" },
      ],
      unavailability: [
        { pharmacyId: "ph-a", startDate: "2026-08-03", endDate: "2026-08-03" },
        { pharmacyId: "ph-b", startDate: "2026-08-04", endDate: "2026-08-05" },
      ],
      historicalDuties: [
        { pharmacyId: "ph-a", date: "2026-07-01", weight: 1 },
        { pharmacyId: "ph-b", date: "2026-07-15", weight: 2 },
      ],
    });
    const shuffled: DutyEngineInput = {
      ...input,
      loadedPlan: makeLoadedPlan((p) => {
        p.rotationPools[0].memberships.reverse();
        p.slotRequirements.reverse();
        p.dayTypeRules.reverse();
      }),
      holidays: [...input.holidays].reverse(),
      unavailability: [...input.unavailability].reverse(),
      historicalDuties: [...input.historicalDuties].reverse(),
    };
    const expected = canonicalSerialize(buildDutyEngineContext(input));
    for (let run = 0; run < 3; run++) {
      expect(canonicalSerialize(buildDutyEngineContext(shuffled))).toBe(expected);
    }
  });

  it("audit-only differences (plan status, version number) do not change the result fingerprint", () => {
    const base = buildDutyEngineContext(makeEngineInput(plan)).resultFingerprint;
    const noisy = makeLoadedPlan((p) => {
      p.status = "RETIRED";
      p.versionNumber = 42;
    });
    // status/versionNumber are not scheduling inputs to any stage; the
    // provenance carries fingerprints, not lifecycle fields.
    expect(buildDutyEngineContext(makeEngineInput(noisy)).resultFingerprint).toBe(base);
  });

  it("does not mutate its input objects", () => {
    const input = makeEngineInput(plan, {
      holidays: [{ date: "2026-08-04", name: "Resmî", type: "OFFICIAL" }],
      unavailability: [{ pharmacyId: "ph-a", startDate: "2026-08-03", endDate: "2026-08-03" }],
    });
    const frozen = canonicalSerialize(input);
    buildDutyEngineContext(input);
    expect(canonicalSerialize(input)).toBe(frozen);
  });

  it("validates tenant consistency, period, foreign pharmacies, and duplicates with typed errors", () => {
    expect(() =>
      buildDutyEngineContext({ ...makeEngineInput(plan), organizationId: "org-OTHER" })
    ).toThrowError(expect.objectContaining({ code: "ORGANIZATION_MISMATCH" }) as unknown as Error);
    expect(() =>
      buildDutyEngineContext({ ...makeEngineInput(plan), regionId: "region-OTHER" })
    ).toThrowError(expect.objectContaining({ code: "REGION_MISMATCH" }) as unknown as Error);
    expect(() =>
      buildDutyEngineContext(makeEngineInput(plan, { periodStart: "2026-09-01", periodEnd: "2026-08-01" }))
    ).toThrowError(expect.objectContaining({ code: "INVALID_PERIOD" }) as unknown as Error);
    expect(() =>
      buildDutyEngineContext(
        makeEngineInput(plan, {
          unavailability: [{ pharmacyId: "ph-foreign", startDate: "2026-08-03", endDate: "2026-08-03" }],
        })
      )
    ).toThrowError(expect.objectContaining({ code: "FOREIGN_PHARMACY" }) as unknown as Error);
    expect(() =>
      buildDutyEngineContext(
        makeEngineInput(plan, {
          holidays: [
            { date: "2026-08-04", name: "Aynı", type: "OFFICIAL" },
            { date: "2026-08-04", name: "Aynı", type: "OFFICIAL" },
          ],
        })
      )
    ).toThrowError(expect.objectContaining({ code: "DUPLICATE_RUNTIME_RECORD" }) as unknown as Error);
    expect(DutyEngineError.name).toBe("DutyEngineError");
  });

  it("reports unresolved and underfilled slots explicitly", () => {
    const noPool = makeLoadedPlan((p) => {
      p.slotRequirements = p.slotRequirements.map((s) =>
        s.dayTypeRuleId === "dtr-WEEKDAY" ? { ...s, rotationPoolId: null } : s
      );
    });
    const result = buildDutyEngineContext(
      makeEngineInput(noPool, { periodStart: "2026-08-03", periodEnd: "2026-08-03" })
    );
    expect(result.unresolvedSlots).toHaveLength(1);
    expect(result.unresolvedSlots[0].reasonCode).toBe("SLOT_WITHOUT_POOL");
    expect(result.warnings.some((w) => w.code === "UNRESOLVED_SLOT")).toBe(true);

    const bigQuota = makeLoadedPlan((p) => {
      p.slotRequirements = p.slotRequirements.map((s) => ({ ...s, requiredCount: 9 }));
    });
    const underfilled = buildDutyEngineContext(
      makeEngineInput(bigQuota, { periodStart: "2026-08-03", periodEnd: "2026-08-03" })
    );
    expect(underfilled.unresolvedSlots[0].reasonCode).toBe(
      "INSUFFICIENT_CANDIDATES_AFTER_RELAXATION"
    );
    expect(underfilled.counts.strictEligible).toBe(3);
  });
});

describe("V1 compatibility architecture", () => {
  it("a V1-adapted configuration maps onto the engine input and produces one null-time shift with uniform slots (dailyDutyCount > 1 preserved)", () => {
    const adapted = adaptV1RuleToV2Config({
      organizationId: "org-1",
      region: { id: "region-1", organizationId: "org-1", name: "Birinci Bölge", dailyDutyCount: 2 },
      dutyRule: {
        id: "rule-1",
        regionId: "region-1",
        minDaysBetweenDuties: 2,
        weekdayWeight: 1,
        saturdayWeight: 1.25,
        sundayWeight: 1.5,
        officialHolidayWeight: 2,
        religiousHolidayWeight: 2.5,
      },
      pharmacies: [
        { id: "ph-a", name: "Çınar Eczanesi", isActive: true, regionId: "region-1" },
        { id: "ph-b", name: "Işık Eczanesi", isActive: true, regionId: "region-1" },
        { id: "ph-c", name: "Kapalı Eczanesi", isActive: false, regionId: "region-1" },
      ],
    });

    // Express the adapted config as a loaded plan + explicit policy —
    // the exact mapping the future compatibility materialization uses.
    const plan = makeLoadedPlan((p) => {
      p.slotRequirements = p.slotRequirements.map((s) => ({
        ...s,
        requiredCount: adapted.slotRequirements[0].requiredCount,
      }));
      p.rotationPools[0].strategy = adapted.rotationPool.strategy;
      p.rotationPools[0].memberships = [
        ...adapted.rotationPool.memberships.map((m, i) => ({
          id: `m-${i}`,
          pharmacyId: m.pharmacyId,
          pharmacyName: m.name,
          pharmacyIsActive: true,
          joinedOn: "2026-01-01",
          leftOn: null,
          sortIndex: null,
        })),
        // V1's inactive pharmacy: present but inactive, never dropped.
        ...adapted.rotationPool.excluded.map((e, i) => ({
          id: `m-x-${i}`,
          pharmacyId: e.pharmacyId,
          pharmacyName: "Kapalı Eczanesi",
          pharmacyIsActive: false,
          joinedOn: "2026-01-01",
          leftOn: null,
          sortIndex: null,
        })),
      ];
      p.rotationPools[0].rotationStates = [];
    });
    const weightOf = (dayType: string) =>
      adapted.dayTypeRules.find((r) => r.dayType === dayType)?.weight ?? 1;
    const input = makeEngineInput(plan, {
      periodStart: "2026-08-03",
      periodEnd: "2026-08-04",
      policy: {
        minDaysBetweenDuties: adapted.fairness.minDaysBetweenDuties,
        relaxMinIntervalWhenInsufficient: adapted.fairness.relaxMinIntervalWhenInsufficient,
        dayTypeWeights: [
          { dayTypeKey: "WEEKDAY", weight: weightOf("WEEKDAY") },
          { dayTypeKey: "SATURDAY", weight: weightOf("SATURDAY") },
          { dayTypeKey: "SUNDAY", weight: weightOf("SUNDAY") },
          { dayTypeKey: "OFFICIAL_HOLIDAY", weight: weightOf("OFFICIAL_HOLIDAY") },
          { dayTypeKey: "RELIGIOUS_HOLIDAY", weight: weightOf("RELIGIOUS_HOLIDAY") },
          // V1 has no eve distinction; compatibility supplies the weekday
          // weight (see the documented Phase 5 boundary).
          { dayTypeKey: "HOLIDAY_EVE", weight: weightOf("WEEKDAY") },
        ],
        sameDaySecondAssignmentAllowed: false,
      },
      holidays: [{ date: "2026-08-04", name: "Yerel Gün", type: "OTHER" }],
    });

    const result = buildDutyEngineContext(input);
    const monday = result.days[0];
    expect(monday.shifts).toHaveLength(1);
    expect(monday.shifts[0]).toMatchObject({ startMinute: null, endMinute: null });
    expect(monday.slots).toHaveLength(1);
    expect(monday.slots[0].requiredCount).toBe(2); // dailyDutyCount > 1

    // OTHER holiday resolves as OFFICIAL_HOLIDAY → official weight (V1 rule).
    const tuesday = result.days[1];
    expect(tuesday.dayType.dayType).toBe("OFFICIAL_HOLIDAY");
    const tuesdaySelection = result.selectionInputs.find((s) => s.slot.date === "2026-08-04")!;
    expect(tuesdaySelection.fairnessFacts[0].dateWeight).toBe(2);

    // Inactive pharmacy is a candidate with a PHARMACY_INACTIVE exclusion,
    // never silently dropped; Turkish tie values preserved.
    const mondaySelection = result.selectionInputs.find((s) => s.slot.date === "2026-08-03")!;
    expect(mondaySelection.candidates).toHaveLength(3);
    const inactive = mondaySelection.eligibility.find((e) =>
      e.hardExclusionReasons.includes("PHARMACY_INACTIVE")
    );
    expect(inactive).toBeDefined();
    expect(mondaySelection.fairnessFacts.map((f) => f.nameTieBreakValue)).toContain(
      "Çınar Eczanesi"
    );
  });
});
