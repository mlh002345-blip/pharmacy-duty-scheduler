import { describe, expect, it } from "vitest";

import { canonicalSerialize } from "../v1-adapter";
import { buildDutyEngineContext } from "../engine/build-engine-context";
import { makeEngineInput, makeLoadedPlan } from "../engine/test-support/fixtures";
import { buildCompatibilityRules } from "./build-compatibility-rules";
import { ruleSetFingerprint } from "./canonicalize-rule-set";
import { makeDefinition } from "./test-support/fixtures";
import type { ConfiguredRuleDefinition } from "./domain/rule-definition";

const plan = makeLoadedPlan();

function withRules(rules: ConfiguredRuleDefinition[], extra: Parameters<typeof makeEngineInput>[1] = {}) {
  return makeEngineInput(plan, {
    periodStart: "2026-08-03",
    periodEnd: "2026-08-04",
    configuredRules: rules,
    ...extra,
  });
}

describe("Phase 4 integration", () => {
  it("an empty rule set preserves Phase 4 behavior byte-for-byte (except the constant empty-set fingerprint)", () => {
    const withoutField = buildDutyEngineContext(
      makeEngineInput(plan, { periodStart: "2026-08-03", periodEnd: "2026-08-04" })
    );
    const withEmpty = buildDutyEngineContext(withRules([]));
    expect(canonicalSerialize(withEmpty)).toBe(canonicalSerialize(withoutField));
    expect(withEmpty.provenance.ruleSetFingerprint).toBe(ruleSetFingerprint([]));
    expect(withEmpty.ruleConflicts).toEqual([]);
    expect(withEmpty.ruleExplanations).toEqual([]);
  });

  it("a HARD rule removes candidates from strict eligibility; SOFT and ADVISORY do not", () => {
    const hard = buildDutyEngineContext(
      withRules([
        makeDefinition({
          ruleType: "EXCLUDE_PHARMACY",
          id: "r-hard",
          parameters: { pharmacyIds: ["ph-a"] },
        }),
      ])
    );
    const hardSelection = hard.selectionInputs[0];
    expect(hardSelection.relaxation.strictEligible).toHaveLength(2); // ph-b, ph-c
    const excluded = hardSelection.eligibility.find((e) => e.pharmacyId === "ph-a");
    expect(excluded?.eligible).toBe(false);
    expect(excluded?.hardExclusionReasons).toContain("RULE_PHARMACY_EXPLICITLY_EXCLUDED");

    const soft = buildDutyEngineContext(
      withRules([
        makeDefinition({
          ruleType: "EXCLUDE_PHARMACY",
          id: "r-soft",
          severity: "SOFT",
          parameters: { pharmacyIds: ["ph-a"] },
        }),
      ])
    );
    const softSelection = soft.selectionInputs[0];
    expect(softSelection.relaxation.strictEligible).toHaveLength(3);
    const penalized = softSelection.eligibility.find((e) => e.pharmacyId === "ph-a");
    expect(penalized?.eligible).toBe(true); // soft failure keeps eligibility
    expect(penalized?.softConcerns).toContain("RULE_PHARMACY_EXPLICITLY_EXCLUDED");

    const advisory = buildDutyEngineContext(
      withRules([
        makeDefinition({
          ruleType: "PREFER_REQUESTED_DATE",
          id: "r-advisory",
          severity: "ADVISORY",
        }),
      ])
    );
    expect(advisory.selectionInputs[0].relaxation.strictEligible).toHaveLength(3);
  });

  it("rule results, fingerprint, and explanations surface in SelectionInput and the draft result", () => {
    const rules = [
      makeDefinition({
        ruleType: "EXCLUDE_PHARMACY",
        id: "r-hard",
        parameters: { pharmacyIds: ["ph-a"] },
      }),
    ];
    const result = buildDutyEngineContext(withRules(rules));
    const selection = result.selectionInputs[0];
    expect(selection.ruleEvaluations.length).toBeGreaterThan(0);
    expect(selection.provenance.ruleSetFingerprint).toBe(ruleSetFingerprint(rules));
    expect(result.provenance.ruleSetFingerprint).toBe(ruleSetFingerprint(rules));
    // Preserved alongside the existing provenance values.
    expect(selection.provenance.configurationFingerprint).toBe("cfg-fingerprint-test");
    expect(selection.provenance.membershipSnapshotHash).toMatch(/^[0-9a-f]{64}$/);
    expect(selection.provenance.runtimeInputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.resultFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.ruleExplanations.some((e) => e.ruleId === "r-hard")).toBe(true);
  });

  it("resultFingerprint changes when rule behavior changes", () => {
    const a = buildDutyEngineContext(
      withRules([
        makeDefinition({
          ruleType: "MIN_DAYS_BETWEEN_ASSIGNMENTS",
          id: "r-min",
          parameters: { minimumDays: 2, relaxable: true, scopeMode: "ALL_ASSIGNMENTS" },
        }),
      ])
    );
    const b = buildDutyEngineContext(
      withRules([
        makeDefinition({
          ruleType: "MIN_DAYS_BETWEEN_ASSIGNMENTS",
          id: "r-min",
          parameters: { minimumDays: 5, relaxable: true, scopeMode: "ALL_ASSIGNMENTS" },
        }),
      ])
    );
    expect(a.resultFingerprint).not.toBe(b.resultFingerprint);
  });

  it("ERROR conflicts reject the run with a typed error before evaluation", () => {
    expect(() =>
      buildDutyEngineContext(
        withRules([
          makeDefinition({
            ruleType: "EXCLUDE_PHARMACY",
            id: "r-foreign",
            parameters: { pharmacyIds: ["ph-FOREIGN"] },
          }),
        ])
      )
    ).toThrowError(expect.objectContaining({ code: "RULE_SET_CONFLICTS" }) as unknown as Error);
  });

  it("configured relaxable MIN_DAYS rule participates in V1-style relaxation; non-relaxable rules never relax", () => {
    // All three candidates fail the configured interval rule; quota 1.
    const historicalDuties = [
      { pharmacyId: "ph-a", date: "2026-08-02", weight: 1 },
      { pharmacyId: "ph-b", date: "2026-08-02", weight: 1 },
      { pharmacyId: "ph-c", date: "2026-08-02", weight: 1 },
    ];
    const relaxable = buildDutyEngineContext(
      withRules(
        [
          makeDefinition({
            ruleType: "MIN_DAYS_BETWEEN_ASSIGNMENTS",
            id: "r-min",
            parameters: { minimumDays: 5, relaxable: true, scopeMode: "ALL_ASSIGNMENTS" },
          }),
        ],
        {
          historicalDuties,
          // Disable the BUILT-IN interval so only the rule governs.
          policy: {
            ...makeEngineInput(plan).policy,
            minDaysBetweenDuties: 0,
            relaxMinIntervalWhenInsufficient: true,
          },
        }
      )
    );
    const relaxedSelection = relaxable.selectionInputs[0];
    expect(relaxedSelection.relaxation.strictEligible).toHaveLength(0);
    expect(relaxedSelection.relaxation.relaxedEligible).toHaveLength(3);
    expect(relaxedSelection.relaxation.relaxationApplied).toBe(true);

    // The same shortage with a NON-relaxable exclusion rule stays empty.
    const strict = buildDutyEngineContext(
      withRules(
        [
          makeDefinition({
            ruleType: "EXCLUDE_PHARMACY",
            id: "r-exc",
            parameters: { pharmacyIds: ["ph-a", "ph-b", "ph-c"] },
          }),
        ],
        {
          policy: {
            ...makeEngineInput(plan).policy,
            minDaysBetweenDuties: 0,
          },
        }
      )
    );
    const strictSelection = strict.selectionInputs[0];
    expect(strictSelection.relaxation.strictEligible).toHaveLength(0);
    expect(strictSelection.relaxation.relaxedEligible).toHaveLength(0);
    expect(strictSelection.relaxation.relaxationApplied).toBe(false);
  });

  it("underfill caused by rules is explicit in unresolved slots", () => {
    const result = buildDutyEngineContext(
      withRules(
        [
          makeDefinition({
            ruleType: "EXCLUDE_PHARMACY",
            id: "r-exc",
            parameters: { pharmacyIds: ["ph-a", "ph-b", "ph-c"] },
          }),
        ],
        { periodStart: "2026-08-03", periodEnd: "2026-08-03" }
      )
    );
    expect(result.unresolvedSlots[0]?.reasonCode).toBe("INSUFFICIENT_CANDIDATES_AFTER_RELAXATION");
  });

  it("multiple slots evaluate independently under scoped rules", () => {
    const twoSlotPlan = makeLoadedPlan((p) => {
      p.slotRequirements.push({
        id: "slot-WEEKDAY-2",
        name: null,
        requiredCount: 1,
        sortOrder: 1,
        dayTypeRuleId: "dtr-WEEKDAY",
        shiftDefinitionId: "shift-1",
        rotationPoolId: "pool-1",
      });
    });
    const result = buildDutyEngineContext(
      makeEngineInput(twoSlotPlan, {
        periodStart: "2026-08-03",
        periodEnd: "2026-08-03",
        configuredRules: [
          makeDefinition({
            ruleType: "EXCLUDE_PHARMACY",
            id: "r-slot-scoped",
            scope: { slotIds: ["slot-WEEKDAY-2"] },
            parameters: { pharmacyIds: ["ph-a"] },
          }),
        ],
      })
    );
    const [first, second] = result.selectionInputs;
    expect(first.relaxation.strictEligible).toHaveLength(3); // out of scope
    expect(second.relaxation.strictEligible).toHaveLength(2); // rule applied
  });

  it("configured rules and the engine input are never mutated", () => {
    const rules = [
      makeDefinition({
        ruleType: "CUSTOM_DATE_OVERRIDE",
        id: "r-override",
        severity: "ADVISORY",
        parameters: {
          targetRuleIds: ["r-min"],
          dates: ["2026-08-03"],
          action: "DISABLE",
        },
      }),
      makeDefinition({
        ruleType: "MIN_DAYS_BETWEEN_ASSIGNMENTS",
        id: "r-min",
        parameters: { minimumDays: 2, relaxable: true, scopeMode: "ALL_ASSIGNMENTS" },
      }),
    ];
    const input = withRules(rules);
    const frozen = canonicalSerialize(input);
    buildDutyEngineContext(input);
    expect(canonicalSerialize(input)).toBe(frozen);
  });

  it("V1 compatibility projection derives deterministic rules from the explicit policy and preserves built-in facts", () => {
    const policy = makeEngineInput(plan).policy;
    const projected = buildCompatibilityRules(policy);
    expect(projected.map((r) => r.ruleType).sort()).toEqual([
      "MIN_DAYS_BETWEEN_ASSIGNMENTS",
      "SAME_DAY_ASSIGNMENT_LIMIT",
      "SAME_SLOT_DUPLICATE_FORBIDDEN",
    ]);
    expect(projected.every((r) => r.source === "COMPATIBILITY_V1")).toBe(true);
    // Deterministic: repeated projection is byte-identical.
    expect(canonicalSerialize(buildCompatibilityRules(policy))).toBe(
      canonicalSerialize(projected)
    );

    // Running WITH the projected rules must not change strict/relaxed
    // MEMBERSHIP of any slot vs. the built-in constraints alone (the
    // rules restate the same semantics; reasons gain RULE_* codes).
    const historicalDuties = [{ pharmacyId: "ph-a", date: "2026-08-02", weight: 1 }];
    const builtinOnly = buildDutyEngineContext(
      makeEngineInput(plan, { periodStart: "2026-08-03", periodEnd: "2026-08-04", historicalDuties })
    );
    const withProjection = buildDutyEngineContext(
      makeEngineInput(plan, {
        periodStart: "2026-08-03",
        periodEnd: "2026-08-04",
        historicalDuties,
        configuredRules: projected,
      })
    );
    for (const [index, selection] of withProjection.selectionInputs.entries()) {
      expect(selection.relaxation.strictEligible).toEqual(
        builtinOnly.selectionInputs[index].relaxation.strictEligible
      );
      expect(selection.relaxation.relaxedEligible).toEqual(
        builtinOnly.selectionInputs[index].relaxation.relaxedEligible
      );
    }
  });

  it("no winner selection exists anywhere in the draft result", () => {
    const result = buildDutyEngineContext(withRules([]));
    const serialized = canonicalSerialize(result);
    expect(serialized).not.toMatch(/"selected|"winner/i);
  });
});

describe("security boundaries", () => {
  it("rejects oversized malicious payloads via conflict gating", () => {
    expect(() =>
      buildDutyEngineContext(
        withRules([
          makeDefinition({
            ruleType: "EXCLUDE_PHARMACY",
            id: "r-big",
            parameters: {
              pharmacyIds: Array.from({ length: 1001 }, (_, i) => `ph-${i}`),
            },
          }),
        ])
      )
    ).toThrowError(expect.objectContaining({ code: "RULE_SET_CONFLICTS" }) as unknown as Error);
  });

  it("rejects foreign tenant ids in rule scope", () => {
    expect(() =>
      buildDutyEngineContext(
        withRules([
          makeDefinition({
            ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN",
            id: "r-cross",
            scope: { regionId: "region-OTHER" },
          }),
        ])
      )
    ).toThrowError(expect.objectContaining({ code: "RULE_SET_CONFLICTS" }) as unknown as Error);
  });

  it("definitions carrying executable-looking content are rejected wholesale", () => {
    expect(() =>
      buildDutyEngineContext(
        withRules([
          makeDefinition({
            ruleType: "EXCLUDE_PHARMACY",
            id: "r-code",
            parameters: { pharmacyIds: ["ph-a"], onEvaluate: "require('child_process')" },
          }),
        ])
      )
    ).toThrowError(expect.objectContaining({ code: "RULE_SET_CONFLICTS" }) as unknown as Error);
  });
});
