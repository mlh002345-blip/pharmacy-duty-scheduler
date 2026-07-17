// Duty Rules V2 — Phase 7: Complete Draft Schedule committed unit tests.
//
// Exercises assembleCompleteDraftSchedule both directly (via crafted
// DutyEngineDraftResult-shaped fixtures) and end-to-end through
// buildDutyEngineContext (which now attaches completeDraftSchedule
// additively). Never re-implements V1's or the selection engine's
// algorithm — status/diagnostic assertions only.

import { describe, expect, it } from "vitest";

import { buildDutyEngineContext } from "../engine/build-engine-context";
import { makeLoadedPlan, makeEngineInput } from "../engine/test-support/fixtures";
import { buildV1CompatibilitySelectionStrategy } from "../selection/build-v1-compatibility-strategy";
import { assembleCompleteDraftSchedule } from "./build-complete-draft-schedule";
import type { EngineDraftResultPreDraft } from "../engine/build-draft-result";
import type { LoadedDutyPlanVersion } from "../domain/loaded-plan";
import type { DutyEngineInput } from "../engine/domain/engine-input";

function strategyInput(
  plan: LoadedDutyPlanVersion,
  overrides: Partial<Omit<DutyEngineInput, "loadedPlan">> = {}
): DutyEngineInput {
  return makeEngineInput(plan, {
    periodStart: "2026-08-03",
    periodEnd: "2026-08-03",
    configuredSelectionStrategies: [
      buildV1CompatibilitySelectionStrategy({ organizationId: "org-1", regionId: "region-1" }),
    ],
    ...overrides,
  });
}

describe("assembleCompleteDraftSchedule — end-to-end via buildDutyEngineContext", () => {
  it("produces a COMPLETE, commit-eligible draft when every slot is filled", () => {
    const plan = makeLoadedPlan();
    const result = buildDutyEngineContext(strategyInput(plan));

    expect(result.completeDraftSchedule.status).toBe("COMPLETE");
    expect(result.completeDraftSchedule.isCommitEligible).toBe(true);
    expect(result.completeDraftFingerprint).toBe(result.completeDraftSchedule.completeDraftFingerprint);
    expect(result.draftManifest).toEqual(result.completeDraftSchedule.manifest);
    expect(result.completeDraftSchedule.diagnostics.some((d) => d.severity === "ERROR")).toBe(false);

    const filledSlot = result.completeDraftSchedule.days
      .flatMap((d) => d.slots)
      .find((s) => s.date === "2026-08-03");
    expect(filledSlot?.status).toBe("FILLED");
    expect(filledSlot?.assignments).toHaveLength(1);
    expect(filledSlot?.assignments[0].origin).toBe("STRICT");
    expect(filledSlot?.assignments[0].selectionOrdinal).toBe(1);
  });

  it("marks a slot UNSCHEDULED (not UNDERFILLED) when it has no pool, without inventing assignments", () => {
    const plan = makeLoadedPlan((p) => {
      p.slotRequirements = p.slotRequirements.map((s) =>
        s.dayTypeRuleId === "dtr-WEEKDAY" ? { ...s, rotationPoolId: null } : s
      );
    });
    const result = buildDutyEngineContext(strategyInput(plan));
    const slot = result.completeDraftSchedule.days
      .flatMap((d) => d.slots)
      .find((s) => s.date === "2026-08-03")!;
    expect(slot.status).toBe("UNSCHEDULED");
    expect(slot.assignments).toHaveLength(0);
    expect(slot.diagnostics.some((d) => d.code === "DRAFT_SLOT_WITHOUT_POOL")).toBe(true);
    expect(result.completeDraftSchedule.status).toBe("PARTIAL");
    expect(result.completeDraftSchedule.isCommitEligible).toBe(false);
  });

  it("marks a slot UNRESOLVED_NO_STRATEGY (not UNDERFILLED) when no strategy is configured at all", () => {
    const plan = makeLoadedPlan();
    const result = buildDutyEngineContext(makeEngineInput(plan));
    expect(result.provisionalSelections).toHaveLength(0);
    const slot = result.completeDraftSchedule.days.flatMap((d) => d.slots)[0];
    expect(slot.status).toBe("UNRESOLVED");
    expect(slot.assignments).toHaveLength(0);
    expect(slot.diagnostics.some((d) => d.code === "DRAFT_SLOT_UNRESOLVED_NO_STRATEGY")).toBe(true);
    expect(result.completeDraftSchedule.status).toBe("PARTIAL");
  });

  it("marks a slot UNDERFILLED when candidates are insufficient, with an explicit diagnostic", () => {
    const plan = makeLoadedPlan((p) => {
      p.rotationPools[0].memberships = [];
    });
    const result = buildDutyEngineContext(strategyInput(plan));
    const slot = result.completeDraftSchedule.days
      .flatMap((d) => d.slots)
      .find((s) => s.date === "2026-08-03")!;
    expect(slot.status).toBe("UNDERFILLED");
    expect(slot.assignments).toHaveLength(0);
    expect(slot.diagnostics.some((d) => d.code === "DRAFT_SLOT_UNDERFILLED")).toBe(true);
    expect(result.completeDraftSchedule.status).toBe("PARTIAL");
  });

  it("preserves selectionOrdinal, origin, and strategy provenance verbatim from Phase 6", () => {
    const plan = makeLoadedPlan();
    const result = buildDutyEngineContext(strategyInput(plan));
    const provisional = result.provisionalSelections[0];
    const assignment = result.completeDraftSchedule.days
      .flatMap((d) => d.slots)
      .find((s) => s.slotKey === provisional.slotKey)!.assignments[0];
    expect(assignment.strategyId).toBe(provisional.strategyId);
    expect(assignment.strategyType).toBe(provisional.strategyType);
    expect(assignment.candidateKey).toBe(provisional.selectedCandidateKeys[0]);
  });

  it("never assembles more assignments than requiredCount, and byte-identical inputs are byte-identical fingerprints", () => {
    const plan = makeLoadedPlan();
    const resultA = buildDutyEngineContext(strategyInput(plan));
    const resultB = buildDutyEngineContext(strategyInput(makeLoadedPlan()));
    expect(resultA.completeDraftFingerprint).toBe(resultB.completeDraftFingerprint);
    for (const slot of resultA.completeDraftSchedule.days.flatMap((d) => d.slots)) {
      expect(slot.assignments.length).toBeLessThanOrEqual(slot.requiredCount);
    }
  });

  it("is unaffected (empty assignments, PARTIAL) for an empty selection-strategy set across a full week", () => {
    const plan = makeLoadedPlan();
    const result = buildDutyEngineContext(makeEngineInput(plan));
    expect(result.completeDraftSchedule.assignments).toHaveLength(0);
    expect(result.completeDraftSchedule.counts.totalAssignments).toBe(0);
    expect(result.completeDraftSchedule.status).toBe("PARTIAL");
  });

  it("flat assignments list is sorted by assignmentKey ascending", () => {
    const plan = makeLoadedPlan();
    const result = buildDutyEngineContext(
      strategyInput(plan, { periodStart: "2026-08-03", periodEnd: "2026-08-09" })
    );
    const keys = result.completeDraftSchedule.assignments.map((a) => a.assignmentKey);
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });

  it("same-day double-booking prohibition (Phase 6) leaves the draft cross-slot-clean", () => {
    const plan = makeLoadedPlan((p) => {
      p.shiftDefinitions.push({
        id: "shift-2",
        name: "İkinci Vardiya",
        startMinute: 0,
        endMinute: 0,
        spansMidnight: false,
        defaultWeight: 1,
        sortOrder: 1,
      });
      const rule = p.dayTypeRules.find((r) => r.dayType === "WEEKDAY")!;
      p.slotRequirements.push({
        id: "slot-WEEKDAY-2",
        name: null,
        requiredCount: 1,
        sortOrder: 1,
        dayTypeRuleId: rule.id,
        shiftDefinitionId: "shift-2",
        rotationPoolId: "pool-1",
      });
      p.rotationPools[0].memberships = p.rotationPools[0].memberships.slice(0, 1);
    });
    const result = buildDutyEngineContext(
      strategyInput(plan, {
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
      })
    );
    expect(
      result.completeDraftSchedule.diagnostics.some((d) => d.code === "DRAFT_SAME_DAY_PHARMACY_CONFLICT")
    ).toBe(false);
    expect(result.completeDraftSchedule.assignments).toHaveLength(1);
  });
});

describe("assembleCompleteDraftSchedule — direct fixture-level structural checks", () => {
  function preDraftFixture(overrides: Partial<EngineDraftResultPreDraft> = {}): EngineDraftResultPreDraft {
    const plan = makeLoadedPlan();
    const result = buildDutyEngineContext(strategyInput(plan)) as unknown as EngineDraftResultPreDraft;
    return { ...result, ...overrides };
  }

  it("flags DRAFT_ASSIGNMENT_REFERENCES_UNKNOWN_CANDIDATE when a selected key has no matching ranking", () => {
    const base = preDraftFixture();
    const mutated: EngineDraftResultPreDraft = {
      ...base,
      provisionalSelections: base.provisionalSelections.map((p, i) =>
        i === 0 ? { ...p, selectedCandidateKeys: [...p.selectedCandidateKeys, "ghost-candidate-key"] } : p
      ),
    };
    const draft = assembleCompleteDraftSchedule(mutated, { sameDaySecondAssignmentAllowed: false });
    expect(
      draft.diagnostics.some((d) => d.code === "DRAFT_ASSIGNMENT_REFERENCES_UNKNOWN_CANDIDATE")
    ).toBe(true);
    expect(draft.status).toBe("INVALID");
    expect(draft.isCommitEligible).toBe(false);
  });

  it("classifies INVALID whenever any ERROR diagnostic is present, overriding an otherwise COMPLETE draft", () => {
    const base = preDraftFixture();
    const mutated: EngineDraftResultPreDraft = {
      ...base,
      provisionalSelections: base.provisionalSelections.map((p, i) =>
        i === 0 ? { ...p, date: "2099-01-01" } : p
      ),
    };
    const draft = assembleCompleteDraftSchedule(mutated, { sameDaySecondAssignmentAllowed: false });
    expect(draft.diagnostics.some((d) => d.code === "DRAFT_SLOT_DATE_MISMATCH")).toBe(true);
    expect(draft.status).toBe("INVALID");
  });

  it("computeCompleteDraftFingerprint changes when an assignment's origin changes", () => {
    const base = preDraftFixture();
    const draftA = assembleCompleteDraftSchedule(base, { sameDaySecondAssignmentAllowed: false });
    const mutated: EngineDraftResultPreDraft = {
      ...base,
      selectionInputs: base.selectionInputs.map((si) => ({
        ...si,
        relaxation: { ...si.relaxation, strictEligible: [], relaxedEligible: si.relaxation.strictEligible },
      })),
    };
    const draftB = assembleCompleteDraftSchedule(mutated, { sameDaySecondAssignmentAllowed: false });
    expect(draftA.completeDraftFingerprint).not.toBe(draftB.completeDraftFingerprint);
  });

  it("does not mutate its input result", () => {
    const base = preDraftFixture();
    const snapshot = JSON.parse(JSON.stringify(base));
    assembleCompleteDraftSchedule(base, { sameDaySecondAssignmentAllowed: false });
    expect(base).toEqual(snapshot);
  });

  it("manifest.sourceResultFingerprint matches the input result's own resultFingerprint", () => {
    const base = preDraftFixture();
    const draft = assembleCompleteDraftSchedule(base, { sameDaySecondAssignmentAllowed: false });
    expect(draft.manifest.sourceResultFingerprint).toBe(base.resultFingerprint);
  });

  it("running assembly twice over the same input is byte-identical", () => {
    const base = preDraftFixture();
    const draftA = assembleCompleteDraftSchedule(base, { sameDaySecondAssignmentAllowed: false });
    const draftB = assembleCompleteDraftSchedule(base, { sameDaySecondAssignmentAllowed: false });
    expect(draftA.completeDraftFingerprint).toBe(draftB.completeDraftFingerprint);
    expect(draftA).toEqual(draftB);
  });
});
