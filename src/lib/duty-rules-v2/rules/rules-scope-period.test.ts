import { describe, expect, it } from "vitest";

import { matchRuleScope } from "./match-rule-scope";
import { matchRuleEffectivePeriod } from "./match-rule-effective-period";
import { evaluateRule } from "./evaluate-rule";
import { makeCandidate, makeContext, makeDefinition } from "./test-support/fixtures";

describe("scope matching (AND semantics)", () => {
  const context = makeContext();

  it("matches organization, region, pool, day type, shift, slot, pharmacy, weekday, holiday type, and generation mode", () => {
    expect(
      matchRuleScope(
        {
          organizationId: "org-1",
          regionId: "region-1",
          poolIds: ["pool-1"],
          dayTypes: ["WEEKDAY"],
          shiftKeys: ["Tam Gün"],
          slotIds: ["slot-WEEKDAY"],
          pharmacyIds: ["ph-a"],
          weekdays: ["MONDAY"],
          holidayTypes: ["NONE"],
          generationModes: ["PREVIEW"],
        },
        context
      ).kind
    ).toBe("MATCH");
  });

  it("misses on each dimension independently", () => {
    const cases = [
      { organizationId: "org-OTHER" },
      { regionId: "region-OTHER" },
      { planId: "plan-OTHER" },
      { planVersionId: "pv-OTHER" },
      { poolIds: ["pool-OTHER"] },
      { dayTypes: ["SUNDAY"] },
      { customDayCategories: ["Pazar Yeri"] },
      { shiftKeys: ["Gece"] },
      { slotIds: ["slot-OTHER"] },
      { pharmacyIds: ["ph-OTHER"] },
      { dateRange: { start: "2026-09-01", end: "2026-09-30" } },
      { weekdays: ["SUNDAY" as const] },
      { holidayTypes: ["RELIGIOUS" as const] },
      { generationModes: ["SIMULATION" as const] },
    ];
    for (const scope of cases) {
      const result = matchRuleScope(scope, context);
      expect(result.kind, JSON.stringify(scope)).toBe("NO_MATCH");
    }
  });

  it("multi-dimension AND: one mismatching dimension defeats an otherwise perfect scope", () => {
    const result = matchRuleScope(
      { organizationId: "org-1", pharmacyIds: ["ph-a"], weekdays: ["FRIDAY"] },
      context
    );
    expect(result).toEqual({ kind: "NO_MATCH", dimension: "weekdays" });
  });

  it("group and service-area scopes are controlled UNSUPPORTED results", () => {
    expect(matchRuleScope({ pharmacyGroupIds: ["grp-1"] }, context)).toEqual({
      kind: "UNSUPPORTED",
      dimension: "pharmacyGroupIds",
    });
    expect(matchRuleScope({ serviceAreaIds: ["area-1"] }, context)).toEqual({
      kind: "UNSUPPORTED",
      dimension: "serviceAreaIds",
    });
    // Through the evaluator: UNSUPPORTED_FACT, never a silent pass/fail.
    const result = evaluateRule(
      makeDefinition({ ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN", scope: { pharmacyGroupIds: ["grp-1"] } }),
      context
    );
    expect(result.outcome).toBe("UNSUPPORTED_FACT");
    expect(result.decisionEffect).toBe("UNSUPPORTED");
  });
});

describe("effective periods and exceptions", () => {
  it("validFrom and validTo are both inclusive; outside is not applicable", () => {
    const definition = makeDefinition({
      ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN",
      validFrom: "2026-08-03",
      validTo: "2026-08-05",
    });
    expect(matchRuleEffectivePeriod(definition, "2026-08-03")).toBe(true); // from inclusive
    expect(matchRuleEffectivePeriod(definition, "2026-08-05")).toBe(true); // to inclusive
    expect(matchRuleEffectivePeriod(definition, "2026-08-02")).toBe(false);
    expect(matchRuleEffectivePeriod(definition, "2026-08-06")).toBe(false);

    const outside = evaluateRule(definition, makeContext({ date: "2026-08-06" }));
    expect(outside.applicable).toBe(false);
    expect(outside.explanationCode).toBe("RULE_OUTSIDE_EFFECTIVE_PERIOD");
  });

  it("includedDates pull a date INTO applicability from outside the validity window", () => {
    const definition = makeDefinition({
      ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN",
      validFrom: "2026-09-01",
      validTo: "2026-09-30",
      exceptions: { includedDates: ["2026-08-03"] },
    });
    expect(matchRuleEffectivePeriod(definition, "2026-08-03")).toBe(true);
    const result = evaluateRule(definition, makeContext());
    expect(result.applicable).toBe(true);
    expect(result.outcome).toBe("PASS");
  });

  it("excludedDates suppress the rule (and win over inclusion overrides)", () => {
    const definition = makeDefinition({
      ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN",
      exceptions: { excludedDates: ["2026-08-03"], includedDates: ["2026-08-03"] },
    });
    const result = evaluateRule(definition, makeContext());
    expect(result.applicable).toBe(false);
    expect(result.exceptionMatch).toBe("excludedDates");
  });

  it("weekday, pharmacy, and pool exceptions suppress deterministically", () => {
    const weekday = evaluateRule(
      makeDefinition({
        ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN",
        exceptions: { excludedWeekdays: ["MONDAY"] },
      }),
      makeContext()
    );
    expect(weekday.exceptionMatch).toBe("excludedWeekdays");

    const pharmacy = evaluateRule(
      makeDefinition({
        ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN",
        exceptions: { excludedPharmacyIds: ["ph-a"] },
      }),
      makeContext()
    );
    expect(pharmacy.exceptionMatch).toBe("excludedPharmacyIds");

    const pool = evaluateRule(
      makeDefinition({
        ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN",
        exceptions: { excludedPoolIds: ["pool-1"] },
      }),
      makeContext()
    );
    expect(pool.exceptionMatch).toBe("excludedPoolIds");
  });

  it("a disabled rule never evaluates, regardless of anything else", () => {
    const result = evaluateRule(
      makeDefinition({
        ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN",
        enabled: false,
      }),
      makeContext({ candidate: makeCandidate({ assignedToThisSlot: true }) })
    );
    expect(result.applicable).toBe(false);
    expect(result.passed).toBe(true);
    expect(result.explanationCode).toBe("RULE_DISABLED");
  });

  it("precedence: disabled > period > scope > exception (each checked in order)", () => {
    const everything = makeDefinition({
      ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN",
      enabled: false,
      validFrom: "2027-01-01",
      scope: { regionId: "region-OTHER" },
      exceptions: { excludedDates: ["2026-08-03"] },
    });
    expect(evaluateRule(everything, makeContext()).explanationCode).toBe("RULE_DISABLED");
    expect(
      evaluateRule({ ...everything, enabled: true }, makeContext()).explanationCode
    ).toBe("RULE_OUTSIDE_EFFECTIVE_PERIOD");
    expect(
      evaluateRule({ ...everything, enabled: true, validFrom: null }, makeContext()).explanationCode
    ).toBe("RULE_SCOPE_MISMATCH");
    expect(
      evaluateRule(
        { ...everything, enabled: true, validFrom: null, scope: {} },
        makeContext()
      ).explanationCode
    ).toBe("RULE_EXCEPTION_MATCHED");
  });
});
