import { describe, expect, it } from "vitest";

import { applyEligibilityRelaxation } from "./apply-eligibility-relaxation";
import { evaluateConstraints } from "./evaluate-constraints";
import { evaluateEligibility } from "./evaluate-eligibility";
import { resolveCalendarContext } from "./resolve-calendar-context";
import { indexRuntimeFacts, resolveCandidates, type SlotCandidate } from "./resolve-candidates";
import { resolveDayType } from "./resolve-day-type";
import { resolvePool } from "./resolve-pool";
import { resolveShifts } from "./resolve-shifts";
import { resolveSlots, type ResolvedSlot } from "./resolve-slots";
import { makeEngineInput, makeLoadedPlan } from "./test-support/fixtures";
import type { DutyEngineInput } from "./domain/engine-input";
import type { LoadedDutyPlanVersion } from "../domain/loaded-plan";

/** Runs the pipeline up to candidates for one date. */
function candidatesFor(
  plan: LoadedDutyPlanVersion,
  input: DutyEngineInput,
  date: string
): { slot: ResolvedSlot; candidates: SlotCandidate[] } {
  const [context] = resolveCalendarContext({
    periodStart: date,
    periodEnd: date,
    holidays: input.holidays,
    customDayOverrides: input.customDayOverrides,
  });
  const dayType = resolveDayType(context, plan.dayTypeRules);
  const { shifts } = resolveShifts(dayType, plan);
  const { slots } = resolveSlots(dayType, shifts, plan);
  const slot = slots[0];
  const pool = resolvePool(slot, plan);
  if (!pool) throw new Error("fixture slot must resolve a pool");
  return { slot, candidates: resolveCandidates(slot, pool, indexRuntimeFacts(input)) };
}

function eligibilityOf(candidate: SlotCandidate, input: DutyEngineInput) {
  return evaluateEligibility(candidate, evaluateConstraints(candidate, input.policy));
}

describe("pool membership boundaries inside the engine", () => {
  it("joinedOn inclusive / leftOn exclusive / inactive exclusion propagate as candidate facts", () => {
    const plan = makeLoadedPlan((p) => {
      p.rotationPools[0].memberships = [
        { id: "m-a", pharmacyId: "ph-a", pharmacyName: "A", pharmacyIsActive: true, joinedOn: "2026-08-03", leftOn: null, sortIndex: null },
        { id: "m-b", pharmacyId: "ph-b", pharmacyName: "B", pharmacyIsActive: true, joinedOn: "2026-01-01", leftOn: "2026-08-03", sortIndex: null },
        { id: "m-c", pharmacyId: "ph-c", pharmacyName: "C", pharmacyIsActive: false, joinedOn: "2026-01-01", leftOn: null, sortIndex: null },
      ];
    });
    const input = makeEngineInput(plan);
    const { candidates } = candidatesFor(plan, input, "2026-08-03");
    const byPharmacy = new Map(candidates.map((c) => [c.pharmacyId, c]));
    expect(byPharmacy.get("ph-a")?.membershipExclusion).toBeNull(); // joined today → member
    expect(byPharmacy.get("ph-b")?.membershipExclusion).toBe("NOT_A_MEMBER"); // left today → gone
    expect(byPharmacy.get("ph-c")?.membershipExclusion).toBe("PHARMACY_INACTIVE");

    const eligibleA = eligibilityOf(byPharmacy.get("ph-a")!, input);
    const eligibleB = eligibilityOf(byPharmacy.get("ph-b")!, input);
    const eligibleC = eligibilityOf(byPharmacy.get("ph-c")!, input);
    expect(eligibleA.eligible).toBe(true);
    expect(eligibleB.hardExclusionReasons).toEqual(["NOT_A_MEMBER"]);
    expect(eligibleC.hardExclusionReasons).toEqual(["PHARMACY_INACTIVE"]);
  });

  it("org-wide and region-scoped pools resolve; empty pool diagnosed", () => {
    const orgWide = makeLoadedPlan((p) => {
      p.rotationPools[0].regionId = null;
    });
    const input = makeEngineInput(orgWide);
    expect(candidatesFor(orgWide, input, "2026-08-03").candidates).toHaveLength(3);

    const empty = makeLoadedPlan((p) => {
      p.rotationPools[0].memberships = [];
      p.rotationPools[0].rotationStates = [];
    });
    const [context] = resolveCalendarContext({ periodStart: "2026-08-03", periodEnd: "2026-08-03", holidays: [], customDayOverrides: [] });
    const dayType = resolveDayType(context, empty.dayTypeRules);
    const { shifts } = resolveShifts(dayType, empty);
    const { slots } = resolveSlots(dayType, shifts, empty);
    const pool = resolvePool(slots[0], empty);
    expect(pool?.diagnostics[0].code).toBe("EMPTY_POOL");
  });

  it("candidate ordering is stable regardless of membership input order", () => {
    const plan = makeLoadedPlan();
    const reversed = makeLoadedPlan((p) => p.rotationPools[0].memberships.reverse());
    const input = makeEngineInput(plan);
    const a = candidatesFor(plan, input, "2026-08-03").candidates.map((c) => c.candidateKey);
    const b = candidatesFor(reversed, makeEngineInput(reversed), "2026-08-03").candidates.map((c) => c.candidateKey);
    expect(a).toEqual(b);
  });
});

describe("eligibility evaluation", () => {
  const plan = makeLoadedPlan();

  it("unavailability blocks the covered dates only", () => {
    const input = makeEngineInput(plan, {
      unavailability: [{ pharmacyId: "ph-a", startDate: "2026-08-03", endDate: "2026-08-04" }],
    });
    const inside = candidatesFor(plan, input, "2026-08-04").candidates.find((c) => c.pharmacyId === "ph-a")!;
    const outside = candidatesFor(plan, input, "2026-08-05").candidates.find((c) => c.pharmacyId === "ph-a")!;
    expect(eligibilityOf(inside, input).hardExclusionReasons).toEqual(["UNAVAILABLE"]);
    expect(eligibilityOf(outside, input).eligible).toBe(true);
  });

  it("approved CANNOT_DUTY and EMERGENCY_EXCUSE block; pending/rejected do not; PREFER_DUTY never blocks", () => {
    const input = makeEngineInput(plan, {
      dutyRequests: [
        { pharmacyId: "ph-a", requestType: "CANNOT_DUTY", status: "APPROVED", startDate: "2026-08-03", endDate: "2026-08-03" },
        { pharmacyId: "ph-b", requestType: "EMERGENCY_EXCUSE", status: "APPROVED", startDate: "2026-08-03", endDate: "2026-08-03" },
        { pharmacyId: "ph-c", requestType: "CANNOT_DUTY", status: "PENDING", startDate: "2026-08-03", endDate: "2026-08-03" },
      ],
    });
    const { candidates } = candidatesFor(plan, input, "2026-08-03");
    const byPharmacy = new Map(candidates.map((c) => [c.pharmacyId, eligibilityOf(c, input)]));
    expect(byPharmacy.get("ph-a")?.hardExclusionReasons).toEqual(["CANNOT_DUTY_REQUEST"]);
    expect(byPharmacy.get("ph-b")?.hardExclusionReasons).toEqual(["EMERGENCY_EXCUSE"]);
    expect(byPharmacy.get("ph-c")?.eligible).toBe(true);

    const prefer = makeEngineInput(plan, {
      dutyRequests: [
        { pharmacyId: "ph-a", requestType: "PREFER_DUTY", status: "APPROVED", startDate: "2026-08-03", endDate: "2026-08-03" },
      ],
    });
    const preferCandidate = candidatesFor(plan, prefer, "2026-08-03").candidates.find((c) => c.pharmacyId === "ph-a")!;
    expect(preferCandidate.prefersThisDate).toBe(true); // fairness fact
    expect(eligibilityOf(preferCandidate, prefer).eligible).toBe(true); // never eligibility
  });

  it("minimum-day interval: failure is a reason, success passes, never-served passes", () => {
    const input = makeEngineInput(plan, {
      historicalDuties: [
        { pharmacyId: "ph-a", date: "2026-08-02", weight: 1 }, // 1 day gap < 2
        { pharmacyId: "ph-b", date: "2026-07-25", weight: 1 }, // 9 day gap >= 2
      ],
    });
    const { candidates } = candidatesFor(plan, input, "2026-08-03");
    const byPharmacy = new Map(candidates.map((c) => [c.pharmacyId, eligibilityOf(c, input)]));
    expect(byPharmacy.get("ph-a")?.hardExclusionReasons).toEqual(["MIN_DAYS_INTERVAL"]);
    expect(byPharmacy.get("ph-b")?.eligible).toBe(true);
    expect(byPharmacy.get("ph-c")?.eligible).toBe(true); // never served
  });

  it("same-slot duplicates and same-day conflicts (policy-controlled) are hard reasons", () => {
    const input = makeEngineInput(plan, {
      existingAssignments: [
        { pharmacyId: "ph-a", date: "2026-08-03", slotKey: "2026-08-03:WEEKDAY:Tam Gün:0", weight: 1 },
        { pharmacyId: "ph-b", date: "2026-08-03", slotKey: "2026-08-03:WEEKDAY:Başka:9", weight: 1 },
      ],
    });
    const { candidates } = candidatesFor(plan, input, "2026-08-03");
    const byPharmacy = new Map(candidates.map((c) => [c.pharmacyId, eligibilityOf(c, input)]));
    // ph-a holds THIS slot; the same-day-conflict constraint also fires
    // because policy disallows a second same-day assignment.
    expect(byPharmacy.get("ph-a")?.hardExclusionReasons).toContain("DUPLICATE_SLOT_ASSIGNMENT");
    expect(byPharmacy.get("ph-b")?.hardExclusionReasons).toEqual(["SAME_DAY_ASSIGNMENT_CONFLICT"]);

    const permissive = makeEngineInput(plan, {
      policy: { ...makeEngineInput(plan).policy, sameDaySecondAssignmentAllowed: true },
      existingAssignments: input.existingAssignments,
    });
    const relaxedCandidates = candidatesFor(plan, permissive, "2026-08-03").candidates;
    const relaxedB = relaxedCandidates.find((c) => c.pharmacyId === "ph-b")!;
    expect(eligibilityOf(relaxedB, permissive).eligible).toBe(true);
  });

  it("multiple hard exclusions are all retained", () => {
    const plan2 = makeLoadedPlan((p) => {
      p.rotationPools[0].memberships[0].pharmacyIsActive = false;
    });
    const input = makeEngineInput(plan2, {
      unavailability: [{ pharmacyId: "ph-a", startDate: "2026-08-03", endDate: "2026-08-03" }],
      historicalDuties: [{ pharmacyId: "ph-a", date: "2026-08-02", weight: 1 }],
    });
    const candidate = candidatesFor(plan2, input, "2026-08-03").candidates.find((c) => c.pharmacyId === "ph-a")!;
    const result = eligibilityOf(candidate, input);
    expect(result.hardExclusionReasons).toEqual([
      "MIN_DAYS_INTERVAL",
      "PHARMACY_INACTIVE",
      "UNAVAILABLE",
    ]);
  });
});

describe("interval relaxation (V1's exact limited semantics)", () => {
  const plan = makeLoadedPlan();

  function relaxationFor(input: DutyEngineInput, requiredCount: number, date = "2026-08-03") {
    const { slot, candidates } = candidatesFor(plan, input, date);
    const eligibility = candidates.map((c) => eligibilityOf(c, input));
    return applyEligibilityRelaxation({
      slotKey: slot.slotKey,
      date,
      requiredCount,
      eligibilityResults: eligibility,
      relaxMinIntervalWhenInsufficient: input.policy.relaxMinIntervalWhenInsufficient,
    });
  }

  it("no relaxation when strict candidates are sufficient", () => {
    const result = relaxationFor(makeEngineInput(plan), 2);
    expect(result.strictEligible).toHaveLength(3);
    expect(result.relaxationApplied).toBe(false);
    expect(result.relaxedEligible).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("relaxes ONLY the minimum-day interval when insufficient", () => {
    const input = makeEngineInput(plan, {
      historicalDuties: [
        { pharmacyId: "ph-a", date: "2026-08-02", weight: 1 },
        { pharmacyId: "ph-b", date: "2026-08-02", weight: 1 },
      ],
    });
    const result = relaxationFor(input, 2);
    expect(result.strictEligible).toHaveLength(1); // only ph-c
    expect(result.relaxationApplied).toBe(true);
    expect(result.relaxedEligible).toHaveLength(2);
    expect(result.relaxedConstraintCodes).toEqual(["MIN_DAYS_BETWEEN_DUTIES"]);
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      "INSUFFICIENT_STRICT_CANDIDATES",
      "MIN_INTERVAL_RELAXED",
    ]);
  });

  it("never relaxes unavailable, inactive, or blocking-request exclusions; may stay underfilled", () => {
    const inactivePlan = makeLoadedPlan((p) => {
      p.rotationPools[0].memberships[2].pharmacyIsActive = false; // ph-c
    });
    const input = makeEngineInput(inactivePlan, {
      unavailability: [{ pharmacyId: "ph-a", startDate: "2026-08-03", endDate: "2026-08-03" }],
      dutyRequests: [
        { pharmacyId: "ph-b", requestType: "CANNOT_DUTY", status: "APPROVED", startDate: "2026-08-03", endDate: "2026-08-03" },
      ],
    });
    const { slot, candidates } = candidatesFor(inactivePlan, input, "2026-08-03");
    const eligibility = candidates.map((c) => eligibilityOf(c, input));
    const result = applyEligibilityRelaxation({
      slotKey: slot.slotKey,
      date: "2026-08-03",
      requiredCount: 2,
      eligibilityResults: eligibility,
      relaxMinIntervalWhenInsufficient: true,
    });
    expect(result.strictEligible).toEqual([]);
    expect(result.relaxedEligible).toEqual([]); // nothing relax-admissible
    expect(result.relaxationApplied).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      "INSUFFICIENT_STRICT_CANDIDATES",
      "INSUFFICIENT_CANDIDATES_AFTER_RELAXATION",
    ]);
  });

  it("a candidate failing interval AND another hard rule is never relax-admissible", () => {
    const input = makeEngineInput(plan, {
      historicalDuties: [
        { pharmacyId: "ph-a", date: "2026-08-02", weight: 1 },
        { pharmacyId: "ph-b", date: "2026-08-02", weight: 1 },
        { pharmacyId: "ph-c", date: "2026-08-02", weight: 1 },
      ],
      unavailability: [{ pharmacyId: "ph-a", startDate: "2026-08-03", endDate: "2026-08-03" }],
    });
    const result = relaxationFor(input, 3);
    // ph-a fails interval + unavailability → excluded from relaxation.
    expect(result.strictEligible).toEqual([]);
    expect(result.relaxedEligible).toHaveLength(2);
    expect(result.diagnostics.map((d) => d.code)).toContain(
      "INSUFFICIENT_CANDIDATES_AFTER_RELAXATION"
    );
  });

  it("respects relaxMinIntervalWhenInsufficient: false", () => {
    const input = makeEngineInput(plan, {
      policy: { ...makeEngineInput(plan).policy, relaxMinIntervalWhenInsufficient: false },
      historicalDuties: [
        { pharmacyId: "ph-a", date: "2026-08-02", weight: 1 },
        { pharmacyId: "ph-b", date: "2026-08-02", weight: 1 },
        { pharmacyId: "ph-c", date: "2026-08-02", weight: 1 },
      ],
    });
    const result = relaxationFor(input, 1);
    expect(result.relaxationApplied).toBe(false);
    expect(result.relaxedEligible).toEqual([]);
  });
});
