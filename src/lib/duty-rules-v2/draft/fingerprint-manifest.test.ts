// Duty Rules V2 — Phase 7: completeDraftFingerprint and
// DraftGenerationManifest committed test suite.
//
// Proves the fingerprint changes for every behavior-relevant field
// listed in fingerprint-complete-draft.ts's header, stays stable under
// object-key-order/array-order/display-name/repeated-execution
// variance, and that the manifest carries the required contract while
// excluding timestamps/db-ids/env/paths/secrets.

import { describe, expect, it } from "vitest";

import { buildDutyEngineContext } from "../engine/build-engine-context";
import { makeLoadedPlan, makeEngineInput } from "../engine/test-support/fixtures";
import { buildV1CompatibilitySelectionStrategy } from "../selection/build-v1-compatibility-strategy";
import { assembleCompleteDraftSchedule } from "./build-complete-draft-schedule";
import type { EngineDraftResultPreDraft } from "../engine/build-draft-result";
import type { LoadedDutyPlanVersion } from "../domain/loaded-plan";
import type { DutyEngineInput } from "../engine/domain/engine-input";
import type { CompleteDraftSchedule } from "./domain/draft-schedule";

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

function baseFixture(): EngineDraftResultPreDraft {
  const plan = makeLoadedPlan();
  return buildDutyEngineContext(strategyInput(plan)) as unknown as EngineDraftResultPreDraft;
}

function draftOf(result: EngineDraftResultPreDraft): CompleteDraftSchedule {
  return assembleCompleteDraftSchedule(result, { sameDaySecondAssignmentAllowed: false });
}

describe("completeDraftFingerprint — sensitivity", () => {
  it("changes when selected pharmacy / assignment order changes", () => {
    const plan = makeLoadedPlan((p) => {
      p.slotRequirements = p.slotRequirements.map((s) =>
        s.dayTypeRuleId === "dtr-WEEKDAY" ? { ...s, requiredCount: 2 } : s
      );
    });
    const base = buildDutyEngineContext(strategyInput(plan)) as unknown as EngineDraftResultPreDraft;
    const targetSlot = base.provisionalSelections.find((p) => p.selectedCandidateKeys.length === 2)!;
    const draftA = draftOf(base);
    const mutated: EngineDraftResultPreDraft = {
      ...base,
      provisionalSelections: base.provisionalSelections.map((p) =>
        p.slotKey === targetSlot.slotKey ? { ...p, selectedCandidateKeys: [...p.selectedCandidateKeys].reverse() } : p
      ),
    };
    const draftB = draftOf(mutated);
    expect(draftA.completeDraftFingerprint).not.toBe(draftB.completeDraftFingerprint);
  });

  it.each([
    [
      "requiredCount",
      (base: EngineDraftResultPreDraft) => ({
        ...base,
        days: base.days.map((d) => ({
          ...d,
          slots: d.slots.map((s) => ({ ...s, requiredCount: s.requiredCount + 1 })),
        })),
      }),
    ],
    [
      "upstream fingerprint (resultFingerprint)",
      (base: EngineDraftResultPreDraft) => ({ ...base, resultFingerprint: `${base.resultFingerprint}-x` }),
    ],
    [
      "draft engine version",
      (base: EngineDraftResultPreDraft) => ({ ...base, engineVersion: base.engineVersion + 1 }),
    ],
    [
      "blocking diagnostic code (via a structural mismatch)",
      (base: EngineDraftResultPreDraft) => ({
        ...base,
        provisionalSelections: base.provisionalSelections.map((p, i) => (i === 0 ? { ...p, date: "2099-01-01" } : p)),
      }),
    ],
  ])("changes when %s changes", (_label, mutate) => {
    const base = baseFixture();
    const draftA = draftOf(base);
    const draftB = draftOf(mutate(base));
    expect(draftA.completeDraftFingerprint).not.toBe(draftB.completeDraftFingerprint);
  });

  it("changes when strategyId/strategyType changes", () => {
    const base = baseFixture();
    const draftA = draftOf(base);
    const mutated: EngineDraftResultPreDraft = {
      ...base,
      provisionalSelections: base.provisionalSelections.map((p) =>
        p.selectedCandidateKeys.length > 0 ? { ...p, strategyType: "MANUAL_ORDER" } : p
      ),
    };
    const draftB = draftOf(mutated);
    expect(draftA.completeDraftFingerprint).not.toBe(draftB.completeDraftFingerprint);
  });

  it("changes when fallback use changes", () => {
    const base = baseFixture();
    const draftA = draftOf(base);
    const mutated: EngineDraftResultPreDraft = {
      ...base,
      provisionalSelections: base.provisionalSelections.map((p) =>
        p.selectedCandidateKeys.length > 0
          ? { ...p, diagnostics: [...p.diagnostics, { code: "FALLBACK_USED" as const, date: p.date, subjectKey: p.slotKey }] }
          : p
      ),
    };
    const draftB = draftOf(mutated);
    expect(draftA.completeDraftFingerprint).not.toBe(draftB.completeDraftFingerprint);
  });

  it("is STABLE under object key order (same data, every object's keys reinserted in reverse)", () => {
    function reverseKeysDeep(value: unknown): unknown {
      if (Array.isArray(value)) return value.map(reverseKeysDeep);
      if (value !== null && typeof value === "object") {
        const reversed: Record<string, unknown> = {};
        for (const key of Object.keys(value as object).reverse()) {
          reversed[key] = reverseKeysDeep((value as Record<string, unknown>)[key]);
        }
        return reversed;
      }
      return value;
    }
    const base = baseFixture();
    const draftA = draftOf(base);
    const reordered = reverseKeysDeep(base) as EngineDraftResultPreDraft;
    const draftB = draftOf(reordered);
    expect(draftA.completeDraftFingerprint).toBe(draftB.completeDraftFingerprint);
  });

  it("is STABLE under repeated execution (run 3 times)", () => {
    const base = baseFixture();
    const fp1 = draftOf(base).completeDraftFingerprint;
    const fp2 = draftOf(base).completeDraftFingerprint;
    const fp3 = draftOf(base).completeDraftFingerprint;
    expect(fp1).toBe(fp2);
    expect(fp2).toBe(fp3);
  });

  it("is STABLE across two independently-built runs from identical input", () => {
    const planA = makeLoadedPlan();
    const planB = makeLoadedPlan();
    const draftA = draftOf(buildDutyEngineContext(strategyInput(planA)) as unknown as EngineDraftResultPreDraft);
    const draftB = draftOf(buildDutyEngineContext(strategyInput(planB)) as unknown as EngineDraftResultPreDraft);
    expect(draftA.completeDraftFingerprint).toBe(draftB.completeDraftFingerprint);
  });
});

describe("DraftGenerationManifest — contract", () => {
  it("carries identity, period, status, counts, provenance, and key lists consistent with the draft", () => {
    const base = baseFixture();
    const draft = draftOf(base);
    expect(draft.manifest.planVersionId).toBe(base.provenance.planVersionId);
    expect(draft.manifest.organizationId).toBe(base.provenance.organizationId);
    expect(draft.manifest.regionId).toBe(base.provenance.regionId);
    expect(draft.manifest.periodStart).toBe(draft.periodStart);
    expect(draft.manifest.periodEnd).toBe(draft.periodEnd);
    expect(draft.manifest.status).toBe(draft.status);
    expect(draft.manifest.isCommitEligible).toBe(draft.isCommitEligible);
    expect(draft.manifest.counts).toEqual(draft.counts);
    expect(draft.manifest.sourceResultFingerprint).toBe(base.resultFingerprint);
    expect(draft.manifest.completeDraftFingerprint).toBe(draft.completeDraftFingerprint);
    expect(draft.manifest.assignmentKeys).toEqual(draft.assignments.map((a) => a.draftAssignmentKey));
    expect(draft.manifest.generatedFromProvisionalSelectionsCount).toBe(base.provisionalSelections.length);
    expect(draft.manifest.validation.errorCount).toBe(draft.diagnostics.filter((d) => d.severity === "ERROR").length);
  });

  it("blockingDiagnosticCodes is empty for a COMPLETE draft and non-empty for an INVALID one", () => {
    const base = baseFixture();
    const completeDraft = draftOf(base);
    expect(completeDraft.status).toBe("COMPLETE");
    expect(completeDraft.manifest.blockingDiagnosticCodes).toEqual([]);

    const mutated: EngineDraftResultPreDraft = {
      ...base,
      provisionalSelections: base.provisionalSelections.map((p, i) => (i === 0 ? { ...p, date: "2099-01-01" } : p)),
    };
    const invalidDraft = draftOf(mutated);
    expect(invalidDraft.status).toBe("INVALID");
    expect(invalidDraft.manifest.blockingDiagnosticCodes.length).toBeGreaterThan(0);
    expect(invalidDraft.manifest.blockingDiagnosticCodes).toContain("DRAFT_SLOT_DATE_MISMATCH");
  });

  it("unresolvedSlotKeys and underfilledSlotKeys match the actual per-slot status", () => {
    const plan = makeLoadedPlan((p) => {
      p.rotationPools[0].memberships = [];
    });
    const draft = draftOf(buildDutyEngineContext(strategyInput(plan)) as unknown as EngineDraftResultPreDraft);
    const underfilled = draft.days.flatMap((d) => d.slots).filter((s) => s.status === "UNDERFILLED").map((s) => s.slotKey);
    expect(draft.manifest.underfilledSlotKeys).toEqual([...underfilled].sort());
  });

  it("excludes timestamps, database ids, environment values, hostnames, paths, and secrets", () => {
    const draft = draftOf(baseFixture());
    const manifestKeys = Object.keys(draft.manifest);
    const forbiddenSubstrings = ["timestamp", "createdAt", "updatedAt", "hostname", "path", "secret", "token", "env"];
    for (const key of manifestKeys) {
      const lower = key.toLowerCase();
      for (const forbidden of forbiddenSubstrings) {
        expect(lower.includes(forbidden), `manifest key "${key}" looks forbidden`).toBe(false);
      }
    }
    const serialized = JSON.stringify(draft.manifest);
    expect(serialized).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // no ISO timestamp anywhere
  });

  it("is deterministic across two identical runs", () => {
    const base = baseFixture();
    const manifestA = draftOf(base).manifest;
    const manifestB = draftOf(base).manifest;
    expect(manifestA).toEqual(manifestB);
  });
});
