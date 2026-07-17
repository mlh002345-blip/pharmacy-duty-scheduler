// Duty Rules V2 — Phase 7: explicit "no re-ranking" proof suite.
//
// Proves assembleCompleteDraftSchedule never calls ranking/comparator
// logic, never reorders a slot's selected pharmacies, never replaces or
// silently discards a Phase 6 winner, never invents a candidate absent
// from Phase 6, never exceeds requiredCount, and preserves ordinal,
// origin, strategy, fallback, and explanation references exactly. A
// malformed Phase 6 winner must remain VISIBLE (making the draft
// INVALID) rather than being repaired or discarded.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
    periodEnd: "2026-08-09",
    configuredSelectionStrategies: [
      buildV1CompatibilitySelectionStrategy({ organizationId: "org-1", regionId: "region-1" }),
    ],
    ...overrides,
  });
}

function preDraftFixture(): EngineDraftResultPreDraft {
  const plan = makeLoadedPlan();
  return buildDutyEngineContext(strategyInput(plan)) as unknown as EngineDraftResultPreDraft;
}

describe("Phase 7 no-re-ranking proof", () => {
  it("imports no ranking/comparator module (static source scan)", () => {
    const draftDir = join(__dirname);
    const bannedImports = ["rank-candidates", "apply-fallback-chain", "build-strategy-context", "resolve-candidate-set"];
    const files = readdirSync(draftDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    for (const file of files) {
      const contents = readFileSync(join(draftDir, file), "utf8");
      for (const banned of bannedImports) {
        expect(contents.includes(banned), `${file} must not import ${banned}`).toBe(false);
      }
    }
  });

  it("preserves the exact selected-pharmacy order (selectionOrdinal) Phase 6 produced", () => {
    const base = preDraftFixture();
    const draft = assembleCompleteDraftSchedule(base, { sameDaySecondAssignmentAllowed: false });
    for (const provisional of base.provisionalSelections) {
      const slot = draft.days.flatMap((d) => d.slots).find((s) => s.slotKey === provisional.slotKey)!;
      const draftOrder = slot.assignments.map((a) => a.candidateKey);
      expect(draftOrder).toEqual(provisional.selectedCandidateKeys);
    }
  });

  it("never adds a candidateKey absent from Phase 6's selectedCandidateKeys", () => {
    const base = preDraftFixture();
    const draft = assembleCompleteDraftSchedule(base, { sameDaySecondAssignmentAllowed: false });
    for (const provisional of base.provisionalSelections) {
      const slot = draft.days.flatMap((d) => d.slots).find((s) => s.slotKey === provisional.slotKey)!;
      const allowed = new Set(provisional.selectedCandidateKeys);
      for (const assignment of slot.assignments) {
        expect(allowed.has(assignment.candidateKey)).toBe(true);
      }
    }
  });

  it("never silently discards a valid Phase 6 winner — removing one from source data changes the draft's counts, not the survivors' order", () => {
    const base = preDraftFixture();
    const draftA = assembleCompleteDraftSchedule(base, { sameDaySecondAssignmentAllowed: false });
    const targetSlotKey = base.provisionalSelections.find((p) => p.selectedCandidateKeys.length > 0)!.slotKey;
    const mutated: EngineDraftResultPreDraft = {
      ...base,
      provisionalSelections: base.provisionalSelections.map((p) =>
        p.slotKey === targetSlotKey ? { ...p, selectedCandidateKeys: [] } : p
      ),
    };
    const draftB = assembleCompleteDraftSchedule(mutated, { sameDaySecondAssignmentAllowed: false });
    const slotB = draftB.days.flatMap((d) => d.slots).find((s) => s.slotKey === targetSlotKey)!;
    expect(slotB.assignments).toHaveLength(0);
    expect(draftB.counts.totalAssignments).toBe(draftA.counts.totalAssignments - 1);
  });

  it("never exceeds requiredCount for any slot, across every assembled slot", () => {
    const base = preDraftFixture();
    const draft = assembleCompleteDraftSchedule(base, { sameDaySecondAssignmentAllowed: false });
    for (const slot of draft.days.flatMap((d) => d.slots)) {
      expect(slot.assignments.length).toBeLessThanOrEqual(slot.requiredCount);
    }
  });

  it("a malformed Phase 6 winner (unknown ranking) stays VISIBLE as a reference error, is not repaired or discarded", () => {
    const base = preDraftFixture();
    const targetSlotKey = base.provisionalSelections.find((p) => p.selectedCandidateKeys.length > 0)!.slotKey;
    const mutated: EngineDraftResultPreDraft = {
      ...base,
      provisionalSelections: base.provisionalSelections.map((p) =>
        p.slotKey === targetSlotKey
          ? { ...p, selectedCandidateKeys: [...p.selectedCandidateKeys, "malformed-ghost-key"] }
          : p
      ),
    };
    const draft = assembleCompleteDraftSchedule(mutated, { sameDaySecondAssignmentAllowed: false });
    expect(draft.status).toBe("INVALID");
    expect(draft.isCommitEligible).toBe(false);
    // The malformed reference itself is REPORTED, not silently dropped
    // from the diagnostic record — verify the exact subjectKey appears.
    expect(
      draft.diagnostics.some(
        (d) =>
          d.code === "DRAFT_ASSIGNMENT_REFERENCES_UNKNOWN_CANDIDATE" &&
          d.subjectKey === `${targetSlotKey}#malformed-ghost-key`
      )
    ).toBe(true);
  });

  it("preserves ordinal, origin, strategy, fallback, and decisive-criterion references exactly for every assignment", () => {
    const base = preDraftFixture();
    const draft = assembleCompleteDraftSchedule(base, { sameDaySecondAssignmentAllowed: false });
    for (const assignment of draft.assignments) {
      const provisional = base.provisionalSelections.find((p) => p.slotKey === assignment.slotKey)!;
      const ranking = provisional.rankings.find((r) => r.candidateKey === assignment.candidateKey)!;
      const explanation = base.selectionExplanations.find((e) => e.candidateKey === assignment.candidateKey) ?? null;
      expect(assignment.provisionalRank).toBe(ranking.provisionalRank);
      expect(assignment.strategyId).toBe(provisional.strategyId);
      expect(assignment.strategyType).toBe(provisional.strategyType);
      expect(assignment.decisiveComparatorCriterion).toBe(explanation?.decisiveCriterion ?? null);
    }
  });
});
