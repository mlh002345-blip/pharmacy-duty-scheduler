// Duty Rules V2 — Phase 7: dedicated validator unit tests.
//
// Exercises each validate-draft-*.ts module directly against
// hand-crafted DraftSlot/DraftAssignment doubles, so every blocking
// check can be proven in isolation without needing a full engine run to
// coincidentally produce that exact structural defect.

import { describe, expect, it } from "vitest";

import { validateDraftCapacity } from "./validate-draft-capacity";
import { validateDraftChronology } from "./validate-draft-chronology";
import { validateDraftCrossSlot } from "./validate-draft-cross-slot";
import { validateDraftDaySummaries, validateDraftPeriodSummary } from "./validate-draft-completeness";
import { validateDraftReferences } from "./validate-draft-references";
import { validateDraftEligibilityOrigin } from "./validate-draft-eligibility-origin";
import type { EngineDraftResultPreDraft } from "../engine/build-draft-result";
import type { DraftAssignment, DraftDay, DraftSlot } from "./domain/draft-schedule";

function assignment(overrides: Partial<DraftAssignment> = {}): DraftAssignment {
  return {
    draftAssignmentKey: "2026-08-03:WEEKDAY:shift-1:0#candidate-1",
    slotKey: "2026-08-03:WEEKDAY:shift-1:0",
    date: "2026-08-03",
    shiftId: "shift-1",
    shiftKey: "Tam Gün",
    poolId: "pool-1",
    candidateKey: "2026-08-03:WEEKDAY:shift-1:0#m-a",
    membershipId: "m-a",
    pharmacyId: "ph-a",
    pharmacyName: "Çınar Eczanesi",
    origin: "STRICT",
    strategyId: "strategy-1",
    strategyType: "V1_COMPATIBILITY",
    provisionalRank: 1,
    selectionOrdinal: 1,
    fallbackUsed: false,
    dutyWeight: 1,
    resolvedDayType: "WEEKDAY",
    compatibilityWeightDayType: null,
    decisiveComparatorCriterion: null,
    ruleExplanationRefs: [],
    sourceProvenance: {
      configurationFingerprint: "cfg",
      runtimeInputHash: "rih",
      ruleSetFingerprint: "rsf",
      strategySetFingerprint: "ssf",
      membershipSnapshotHash: "msh",
    },
    ...overrides,
  };
}

function slot(overrides: Partial<DraftSlot> = {}, assignments: DraftAssignment[] = [assignment()]): DraftSlot {
  return {
    slotKey: "2026-08-03:WEEKDAY:shift-1:0",
    date: "2026-08-03",
    dayTypeKey: "WEEKDAY",
    shiftId: "shift-1",
    shiftKey: "Tam Gün",
    poolId: "pool-1",
    slotId: "slot-WEEKDAY",
    slotName: null,
    sortOrder: 0,
    requiredCount: 1,
    selectedCount: assignments.length,
    missingCount: Math.max(0, 1 - assignments.length),
    status: "FILLED",
    strategyId: "strategy-1",
    strategyType: "V1_COMPATIBILITY",
    fallbackUsed: false,
    relaxation: { strictEligibleCount: 1, relaxedEligibleCount: 0, relaxationApplied: false },
    assignments,
    ruleDiagnosticRefs: [],
    strategyDiagnosticRefs: [],
    explanationRefs: [],
    diagnostics: [],
    ...overrides,
  };
}

describe("validateDraftCapacity", () => {
  it("flags DRAFT_ASSIGNMENT_COUNT_EXCEEDS_REQUIRED when assignments exceed requiredCount", () => {
    const over = slot({ requiredCount: 1 }, [assignment(), assignment({ draftAssignmentKey: "k2", candidateKey: "c2", pharmacyId: "ph-b" })]);
    const diagnostics = validateDraftCapacity({ slots: [over], hasAnyStrategyConfigured: true });
    expect(diagnostics.some((d) => d.code === "DRAFT_ASSIGNMENT_COUNT_EXCEEDS_REQUIRED")).toBe(true);
  });

  it("flags DRAFT_MISSING_COUNT_MISMATCH when missingCount disagrees with actual gap", () => {
    const s = slot({ requiredCount: 2, missingCount: 0 }, [assignment()]);
    const diagnostics = validateDraftCapacity({ slots: [s], hasAnyStrategyConfigured: true });
    expect(diagnostics.some((d) => d.code === "DRAFT_MISSING_COUNT_MISMATCH")).toBe(true);
  });

  it("flags DRAFT_NO_SELECTION_STRATEGY when no strategy is configured for a required slot", () => {
    const s = slot({ requiredCount: 1 }, []);
    const diagnostics = validateDraftCapacity({ slots: [s], hasAnyStrategyConfigured: false });
    expect(diagnostics.some((d) => d.code === "DRAFT_NO_SELECTION_STRATEGY")).toBe(true);
  });

  it("flags DRAFT_STRATEGY_MISSING_FOR_SELECTED_SLOT when assignments exist but strategyId is null", () => {
    const s = slot({ strategyId: null });
    const diagnostics = validateDraftCapacity({ slots: [s], hasAnyStrategyConfigured: true });
    expect(diagnostics.some((d) => d.code === "DRAFT_STRATEGY_MISSING_FOR_SELECTED_SLOT")).toBe(true);
  });
});

describe("validateDraftChronology", () => {
  it("flags DRAFT_DUPLICATE_SLOT_IDENTITY for two slots sharing a slotKey", () => {
    const s1 = slot();
    const s2 = slot();
    const diagnostics = validateDraftChronology({ slots: [s1, s2], periodStart: "2026-08-01", periodEnd: "2026-08-31" });
    expect(diagnostics.some((d) => d.code === "DRAFT_DUPLICATE_SLOT_IDENTITY")).toBe(true);
  });

  it("flags DRAFT_PERIOD_BOUNDARY_VIOLATION for a slot outside the period", () => {
    const s = slot({ date: "2099-01-01" }, [assignment({ date: "2099-01-01" })]);
    const diagnostics = validateDraftChronology({ slots: [s], periodStart: "2026-08-01", periodEnd: "2026-08-31" });
    expect(diagnostics.some((d) => d.code === "DRAFT_PERIOD_BOUNDARY_VIOLATION")).toBe(true);
  });

  it("flags DRAFT_DUPLICATE_CANDIDATE_KEY_IN_SLOT for repeated candidateKey", () => {
    const s = slot({ requiredCount: 2 }, [assignment(), assignment({ draftAssignmentKey: "k2" })]);
    const diagnostics = validateDraftChronology({ slots: [s], periodStart: "2026-08-01", periodEnd: "2026-08-31" });
    expect(diagnostics.some((d) => d.code === "DRAFT_DUPLICATE_CANDIDATE_KEY_IN_SLOT")).toBe(true);
  });

  it("flags DRAFT_SAME_SLOT_DUPLICATE_PHARMACY for repeated pharmacyId via different memberships", () => {
    const s = slot({ requiredCount: 2 }, [
      assignment(),
      assignment({ draftAssignmentKey: "k2", candidateKey: "c2", membershipId: "m-other" }),
    ]);
    const diagnostics = validateDraftChronology({ slots: [s], periodStart: "2026-08-01", periodEnd: "2026-08-31" });
    expect(diagnostics.some((d) => d.code === "DRAFT_SAME_SLOT_DUPLICATE_PHARMACY")).toBe(true);
  });

  it("flags DRAFT_DUPLICATE_SELECTION_ORDINAL for two assignments sharing an ordinal", () => {
    const s = slot({ requiredCount: 2 }, [
      assignment(),
      assignment({ draftAssignmentKey: "k2", candidateKey: "c2", pharmacyId: "ph-b", selectionOrdinal: 1 }),
    ]);
    const diagnostics = validateDraftChronology({ slots: [s], periodStart: "2026-08-01", periodEnd: "2026-08-31" });
    expect(diagnostics.some((d) => d.code === "DRAFT_DUPLICATE_SELECTION_ORDINAL")).toBe(true);
  });

  it("flags DRAFT_SELECTION_ORDINAL_GAP for a non-contiguous ordinal sequence", () => {
    const s = slot({ requiredCount: 2 }, [
      assignment(),
      assignment({ draftAssignmentKey: "k2", candidateKey: "c2", pharmacyId: "ph-b", selectionOrdinal: 3 }),
    ]);
    const diagnostics = validateDraftChronology({ slots: [s], periodStart: "2026-08-01", periodEnd: "2026-08-31" });
    expect(diagnostics.some((d) => d.code === "DRAFT_SELECTION_ORDINAL_GAP")).toBe(true);
  });

  it("flags DRAFT_RANK_NOT_MONOTONIC when provisionalRank decreases across ordinals", () => {
    const s = slot({ requiredCount: 2 }, [
      assignment({ provisionalRank: 2 }),
      assignment({ draftAssignmentKey: "k2", candidateKey: "c2", pharmacyId: "ph-b", selectionOrdinal: 2, provisionalRank: 1 }),
    ]);
    const diagnostics = validateDraftChronology({ slots: [s], periodStart: "2026-08-01", periodEnd: "2026-08-31" });
    expect(diagnostics.some((d) => d.code === "DRAFT_RANK_NOT_MONOTONIC")).toBe(true);
  });
});

describe("validateDraftCrossSlot", () => {
  it("flags DRAFT_DUPLICATE_ASSIGNMENT_KEY for two assignments sharing a draftAssignmentKey", () => {
    const diagnostics = validateDraftCrossSlot({
      assignments: [assignment(), assignment()],
      sameDaySecondAssignmentAllowed: true,
    });
    expect(diagnostics.some((d) => d.code === "DRAFT_DUPLICATE_ASSIGNMENT_KEY")).toBe(true);
  });

  it("flags DRAFT_SAME_DAY_PHARMACY_CONFLICT for the same pharmacy across two slots on one date when forbidden", () => {
    const a = assignment();
    const b = assignment({
      draftAssignmentKey: "2026-08-03:WEEKDAY:shift-2:0#c2",
      slotKey: "2026-08-03:WEEKDAY:shift-2:0",
      candidateKey: "c2",
    });
    const diagnostics = validateDraftCrossSlot({ assignments: [a, b], sameDaySecondAssignmentAllowed: false });
    expect(diagnostics.some((d) => d.code === "DRAFT_SAME_DAY_PHARMACY_CONFLICT")).toBe(true);
  });

  it("flags DRAFT_SAME_DAY_PHARMACY_MULTI_MEMBERSHIP_CONFLICT when the two seats use different memberships", () => {
    const a = assignment();
    const b = assignment({
      draftAssignmentKey: "2026-08-03:WEEKDAY:shift-2:0#c2",
      slotKey: "2026-08-03:WEEKDAY:shift-2:0",
      candidateKey: "c2",
      membershipId: "m-other",
    });
    const diagnostics = validateDraftCrossSlot({ assignments: [a, b], sameDaySecondAssignmentAllowed: false });
    expect(diagnostics.some((d) => d.code === "DRAFT_SAME_DAY_PHARMACY_MULTI_MEMBERSHIP_CONFLICT")).toBe(true);
  });

  it("allows the same pharmacy across two slots on one date when permitted by policy", () => {
    const a = assignment();
    const b = assignment({
      draftAssignmentKey: "2026-08-03:WEEKDAY:shift-2:0#c2",
      slotKey: "2026-08-03:WEEKDAY:shift-2:0",
      candidateKey: "c2",
    });
    const diagnostics = validateDraftCrossSlot({ assignments: [a, b], sameDaySecondAssignmentAllowed: true });
    expect(diagnostics.some((d) => d.code.startsWith("DRAFT_SAME_DAY"))).toBe(false);
  });
});

function fakeResult(overrides: Partial<EngineDraftResultPreDraft> = {}): EngineDraftResultPreDraft {
  return {
    provenance: { configurationFingerprint: "cfg", planVersionId: "pv-1", organizationId: "org-1", regionId: "region-1" } as EngineDraftResultPreDraft["provenance"],
    selectionInputs: [
      {
        slot: { slotKey: "2026-08-03:WEEKDAY:shift-1:0" },
        candidates: [{ pharmacyId: "ph-a", membershipId: "m-a" }],
        relaxation: { strictEligible: ["2026-08-03:WEEKDAY:shift-1:0#m-a"], relaxedEligible: [], relaxationApplied: false },
      } as unknown as EngineDraftResultPreDraft["selectionInputs"][number],
    ],
    provisionalSelections: [
      {
        slotKey: "2026-08-03:WEEKDAY:shift-1:0",
        date: "2026-08-03",
        strategyId: "strategy-1",
        strategyType: "V1_COMPATIBILITY",
        selectedCandidateKeys: ["2026-08-03:WEEKDAY:shift-1:0#m-a"],
        rankings: [
          {
            candidateKey: "2026-08-03:WEEKDAY:shift-1:0#m-a",
            provisionalRank: 1,
            rankFacts: { origin: "STRICT" },
          },
        ],
      } as unknown as EngineDraftResultPreDraft["provisionalSelections"][number],
    ],
    ...overrides,
  } as EngineDraftResultPreDraft;
}

describe("validateDraftReferences", () => {
  it("flags DRAFT_MEMBERSHIP_MISMATCH when a membershipId is absent from the source candidate list", () => {
    const result = fakeResult();
    const s = slot({}, [assignment({ membershipId: "m-ghost" })]);
    const diagnostics = validateDraftReferences({ result, slots: [s] });
    expect(diagnostics.some((d) => d.code === "DRAFT_MEMBERSHIP_MISMATCH")).toBe(true);
  });

  it("flags DRAFT_PLAN_VERSION_MISMATCH when sourceProvenance.configurationFingerprint disagrees with the run", () => {
    const result = fakeResult();
    const s = slot({}, [assignment({ sourceProvenance: { ...assignment().sourceProvenance, configurationFingerprint: "other-cfg" } })]);
    const diagnostics = validateDraftReferences({ result, slots: [s] });
    expect(diagnostics.some((d) => d.code === "DRAFT_PLAN_VERSION_MISMATCH")).toBe(true);
  });

  it("flags DRAFT_SHIFT_MISMATCH when an assignment's shiftId disagrees with its own slot", () => {
    const result = fakeResult();
    const s = slot({}, [assignment({ shiftId: "shift-other" })]);
    const diagnostics = validateDraftReferences({ result, slots: [s] });
    expect(diagnostics.some((d) => d.code === "DRAFT_SHIFT_MISMATCH")).toBe(true);
  });

  it("flags DRAFT_POOL_MISMATCH when an assignment's poolId disagrees with its own slot", () => {
    const result = fakeResult();
    const s = slot({}, [assignment({ poolId: "pool-other" })]);
    const diagnostics = validateDraftReferences({ result, slots: [s] });
    expect(diagnostics.some((d) => d.code === "DRAFT_POOL_MISMATCH")).toBe(true);
  });
});

describe("validateDraftEligibilityOrigin", () => {
  it("flags DRAFT_ORIGIN_MISMATCH when recorded origin disagrees with the candidate's own rankFacts.origin", () => {
    const result = fakeResult();
    const s = slot({}, [assignment({ origin: "RELAXED" })]);
    const diagnostics = validateDraftEligibilityOrigin({ result, slots: [s] });
    expect(diagnostics.some((d) => d.code === "DRAFT_ORIGIN_MISMATCH")).toBe(true);
  });

  it("flags DRAFT_CANDIDATE_NOT_IN_STRICT_OR_RELAXED when a candidateKey has no matching ranking", () => {
    const result = fakeResult();
    const s = slot({}, [assignment({ candidateKey: "2026-08-03:WEEKDAY:shift-1:0#m-ghost" })]);
    const diagnostics = validateDraftEligibilityOrigin({ result, slots: [s] });
    expect(diagnostics.some((d) => d.code === "DRAFT_CANDIDATE_NOT_IN_STRICT_OR_RELAXED")).toBe(true);
  });

  it("does not flag a RELAXED-origin assignment admitted via sequential-relaxation widening (sequential-relaxation-contract corrective)", () => {
    // Regression for the Phase 7 / PR #11 integration gap: a candidate
    // admitted only through Phase 6's sequential widening (never present
    // in Phase 4's static strictEligible/relaxedEligible sets) must
    // still validate cleanly, because rankFacts.origin — not the static
    // sets — is the authoritative source this validator checks against.
    const result = fakeResult({
      selectionInputs: [
        {
          slot: { slotKey: "2026-08-03:WEEKDAY:shift-1:0" },
          candidates: [{ pharmacyId: "ph-a", membershipId: "m-a" }],
          relaxation: { strictEligible: [], relaxedEligible: [], relaxationApplied: false },
        } as unknown as EngineDraftResultPreDraft["selectionInputs"][number],
      ],
      provisionalSelections: [
        {
          slotKey: "2026-08-03:WEEKDAY:shift-1:0",
          date: "2026-08-03",
          strategyId: "strategy-1",
          strategyType: "V1_COMPATIBILITY",
          selectedCandidateKeys: ["2026-08-03:WEEKDAY:shift-1:0#m-a"],
          rankings: [
            {
              candidateKey: "2026-08-03:WEEKDAY:shift-1:0#m-a",
              provisionalRank: 1,
              rankFacts: { origin: "RELAXED" },
            },
          ],
        } as unknown as EngineDraftResultPreDraft["provisionalSelections"][number],
      ],
    });
    const s = slot({}, [assignment({ origin: "RELAXED" })]);
    const diagnostics = validateDraftEligibilityOrigin({ result, slots: [s] });
    expect(diagnostics).toHaveLength(0);
  });

  it("flags DRAFT_STRATEGY_MISMATCH when the assignment's strategy disagrees with the provisional selection", () => {
    const result = fakeResult();
    const s = slot({}, [assignment({ strategyType: "MANUAL_ORDER" })]);
    const diagnostics = validateDraftEligibilityOrigin({ result, slots: [s] });
    expect(diagnostics.some((d) => d.code === "DRAFT_STRATEGY_MISMATCH")).toBe(true);
  });

  it("flags DRAFT_SELECTED_RANK_MISMATCH when provisionalRank disagrees with the source ranking", () => {
    const result = fakeResult();
    const s = slot({}, [assignment({ provisionalRank: 99 })]);
    const diagnostics = validateDraftEligibilityOrigin({ result, slots: [s] });
    expect(diagnostics.some((d) => d.code === "DRAFT_SELECTED_RANK_MISMATCH")).toBe(true);
  });

  it("reports no diagnostics for an internally consistent slot", () => {
    const result = fakeResult();
    const s = slot();
    expect(validateDraftEligibilityOrigin({ result, slots: [s] })).toHaveLength(0);
  });
});

describe("validateDraftCompleteness", () => {
  function day(overrides: Partial<DraftDay> = {}, slots: DraftSlot[] = [slot()]): DraftDay {
    return {
      date: "2026-08-03",
      weekdayName: "MONDAY",
      dayTypeKey: "WEEKDAY",
      compatibilityWeightDayType: null,
      isHolidayEve: false,
      holidays: [],
      served: true,
      requiredCount: slots.reduce((s, x) => s + x.requiredCount, 0),
      selectedCount: slots.reduce((s, x) => s + x.selectedCount, 0),
      missingCount: slots.reduce((s, x) => s + x.missingCount, 0),
      status: "FILLED",
      slotKeys: slots.map((s) => s.slotKey).sort(),
      assignmentKeys: slots.flatMap((s) => s.assignments.map((a) => a.draftAssignmentKey)).sort(),
      slots,
      ...overrides,
    };
  }

  it("flags DRAFT_DAY_SUMMARY_INCONSISTENT when requiredCount disagrees with the sum of its slots", () => {
    const diagnostics = validateDraftDaySummaries([day({ requiredCount: 999 })]);
    expect(diagnostics.some((d) => d.code === "DRAFT_DAY_SUMMARY_INCONSISTENT")).toBe(true);
  });

  it("flags DRAFT_PERIOD_SUMMARY_INCONSISTENT when draft.counts disagrees with the actual slot facts", () => {
    const days = [day()];
    const diagnostics = validateDraftPeriodSummary({
      days,
      counts: {
        totalSlots: 999,
        filledSlots: 1,
        underfilledSlots: 0,
        unresolvedSlots: 0,
        unscheduledSlots: 0,
        totalAssignments: 1,
      },
      assignments: [assignment()],
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
    });
    expect(diagnostics.some((d) => d.code === "DRAFT_PERIOD_SUMMARY_INCONSISTENT")).toBe(true);
  });

  it("reports no diagnostics for internally consistent day/period summaries", () => {
    const days = [day()];
    expect(validateDraftDaySummaries(days)).toHaveLength(0);
    const diagnostics = validateDraftPeriodSummary({
      days,
      counts: { totalSlots: 1, filledSlots: 1, underfilledSlots: 0, unresolvedSlots: 0, unscheduledSlots: 0, totalAssignments: 1 },
      assignments: [assignment()],
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
    });
    expect(diagnostics).toHaveLength(0);
  });
});
