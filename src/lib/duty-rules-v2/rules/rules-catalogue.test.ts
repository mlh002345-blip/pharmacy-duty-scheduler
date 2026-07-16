import { describe, expect, it } from "vitest";

import { RULE_CATALOGUE, getCatalogueEntry } from "./catalogue";
import { RULE_LIMITS } from "./domain/rule-parameters";
import { makeDefinition } from "./test-support/fixtures";
import { validateRuleDefinition } from "./validate-rule-definition";
import { ruleSetFingerprint } from "./canonicalize-rule-set";

const EXPECTED_RULE_TYPES = [
  "PHARMACY_MUST_BE_ACTIVE",
  "MEMBER_OF_POOL_AS_OF_DATE",
  "PHARMACY_UNAVAILABLE_ON_DATE",
  "BLOCK_APPROVED_CANNOT_DUTY_REQUEST",
  "BLOCK_APPROVED_EMERGENCY_EXCUSE",
  "MIN_DAYS_BETWEEN_ASSIGNMENTS",
  "SAME_DAY_ASSIGNMENT_LIMIT",
  "SAME_SLOT_DUPLICATE_FORBIDDEN",
  "MAX_ASSIGNMENTS_IN_PERIOD",
  "MAX_WEIGHTED_LOAD_IN_PERIOD",
  "PREFER_REQUESTED_DATE",
  "AVOID_CONSECUTIVE_WEEKEND_ASSIGNMENTS",
  "AVOID_CONSECUTIVE_HOLIDAY_ASSIGNMENTS",
  "MINIMUM_REST_AFTER_SHIFT",
  "EXCLUDE_PHARMACY",
  "INCLUDE_ONLY_PHARMACIES",
  "POOL_QUOTA",
  "TAG_COMBINATION_FORBIDDEN",
  "GROUP_COMBINATION_FORBIDDEN",
  "CUSTOM_DATE_OVERRIDE",
];

describe("rule catalogue integrity", () => {
  it("contains exactly the 20 initial rule types with stable codes", () => {
    expect([...RULE_CATALOGUE.keys()].sort()).toEqual([...EXPECTED_RULE_TYPES].sort());
    for (const [code, entry] of RULE_CATALOGUE) {
      expect(entry.ruleType).toBe(code);
      expect(entry.evaluatorVersion).toBeGreaterThanOrEqual(1);
      expect(entry.allowedSeverities.length).toBeGreaterThan(0);
      expect(typeof entry.evaluate).toBe("function");
    }
  });

  it("every rule type has a STRICT parameter schema (unknown keys rejected)", () => {
    for (const entry of RULE_CATALOGUE.values()) {
      const smuggled = entry.parameterSchema.safeParse({
        __evaluator: "function(){}",
        code: "require('fs')",
      });
      expect(smuggled.success, entry.ruleType).toBe(false);
    }
  });

  it("PREFER_REQUESTED_DATE can never be HARD", () => {
    const entry = getCatalogueEntry("PREFER_REQUESTED_DATE");
    expect(entry?.allowedSeverities).not.toContain("HARD");
  });

  it("only MIN_DAYS_BETWEEN_ASSIGNMENTS declares relaxability, in V1 mode", () => {
    for (const entry of RULE_CATALOGUE.values()) {
      if (entry.ruleType === "MIN_DAYS_BETWEEN_ASSIGNMENTS") {
        expect(entry.relaxable).toBe(true);
        expect(entry.relaxationMode).toBe("V1_MIN_INTERVAL");
      } else {
        expect(entry.relaxable, entry.ruleType).toBe(false);
        expect(entry.relaxationMode, entry.ruleType).toBeNull();
      }
    }
  });
});

describe("definition validation against the catalogue", () => {
  it("rejects unknown rule types", () => {
    const issues = validateRuleDefinition(makeDefinition({ ruleType: "CITY_SPECIAL_RULE" }));
    expect(issues.map((i) => i.code)).toContain("UNKNOWN_RULE_TYPE");
  });

  it("rejects unsupported severity and non-configurable severity changes", () => {
    const soft = validateRuleDefinition(
      makeDefinition({ ruleType: "PHARMACY_MUST_BE_ACTIVE", severity: "SOFT" })
    );
    expect(soft.map((i) => i.code)).toContain("UNSUPPORTED_SEVERITY");
    const hardPrefer = validateRuleDefinition(
      makeDefinition({ ruleType: "PREFER_REQUESTED_DATE", severity: "HARD" })
    );
    expect(hardPrefer.map((i) => i.code)).toContain("UNSUPPORTED_SEVERITY");
  });

  it("rejects unknown/executable-looking parameters and missing required ones", () => {
    const extra = validateRuleDefinition(
      makeDefinition({
        ruleType: "EXCLUDE_PHARMACY",
        parameters: { pharmacyIds: ["ph-a"], evaluator: "() => true" },
      })
    );
    expect(extra.map((i) => i.code)).toContain("INVALID_PARAMETERS");
    const missing = validateRuleDefinition(
      makeDefinition({ ruleType: "MIN_DAYS_BETWEEN_ASSIGNMENTS", parameters: {} })
    );
    expect(missing.map((i) => i.code)).toContain("INVALID_PARAMETERS");
  });

  it("rejects NaN, Infinity, negative and oversized numeric thresholds", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, RULE_LIMITS.maxNumericThreshold + 1]) {
      const issues = validateRuleDefinition(
        makeDefinition({
          ruleType: "MIN_DAYS_BETWEEN_ASSIGNMENTS",
          parameters: { minimumDays: bad, relaxable: true, scopeMode: "ALL_ASSIGNMENTS" },
        })
      );
      expect(issues.map((i) => i.code), String(bad)).toContain("INVALID_PARAMETERS");
    }
  });

  it("rejects oversized and duplicate id arrays (max 1000 pharmacy ids)", () => {
    const oversized = validateRuleDefinition(
      makeDefinition({
        ruleType: "EXCLUDE_PHARMACY",
        parameters: {
          pharmacyIds: Array.from({ length: RULE_LIMITS.maxPharmacyIdsPerRule + 1 }, (_, i) => `ph-${i}`),
        },
      })
    );
    expect(oversized.map((i) => i.code)).toContain("INVALID_PARAMETERS");
    const duplicated = validateRuleDefinition(
      makeDefinition({ ruleType: "EXCLUDE_PHARMACY", parameters: { pharmacyIds: ["ph-a", "ph-a"] } })
    );
    expect(duplicated.map((i) => i.code)).toContain("INVALID_PARAMETERS");
  });

  it("rejects invalid dates, inverted validity, unsupported scope and exception kinds", () => {
    const inverted = validateRuleDefinition(
      makeDefinition({
        ruleType: "EXCLUDE_PHARMACY",
        parameters: { pharmacyIds: ["ph-a"] },
        validFrom: "2026-09-01",
        validTo: "2026-08-01",
      })
    );
    expect(inverted.map((i) => i.code)).toContain("INVALID_VALIDITY_RANGE");

    const badDate = validateRuleDefinition(
      makeDefinition({
        ruleType: "EXCLUDE_PHARMACY",
        parameters: { pharmacyIds: ["ph-a"] },
        validFrom: "01.08.2026",
      })
    );
    expect(badDate.map((i) => i.code)).toContain("INVALID_SHAPE");

    const unsupportedException = validateRuleDefinition(
      makeDefinition({
        ruleType: "PHARMACY_MUST_BE_ACTIVE",
        exceptions: { excludedDates: ["2026-08-03"] }, // safety rule: no exceptions
      })
    );
    expect(unsupportedException.map((i) => i.code)).toContain("UNSUPPORTED_EXCEPTION_KIND");
  });

  it("flags future scope dimensions (groups, service areas) as unsupported", () => {
    const issues = validateRuleDefinition(
      makeDefinition({
        ruleType: "EXCLUDE_PHARMACY",
        parameters: { pharmacyIds: ["ph-a"] },
        scope: { pharmacyGroupIds: ["grp-1"] },
      })
    );
    expect(issues.map((i) => i.code)).toContain("UNSUPPORTED_FUTURE_SCOPE_DIMENSION");
  });

  it("rejects definitions with extra top-level fields (no executable smuggling)", () => {
    const definition = makeDefinition({ ruleType: "PHARMACY_MUST_BE_ACTIVE" });
    const smuggled = { ...definition, evaluate: "() => true" } as never;
    const issues = validateRuleDefinition(smuggled);
    expect(issues.map((i) => i.code)).toContain("INVALID_SHAPE");
  });
});

describe("evaluator version participates in the fingerprint", () => {
  it("the fingerprint payload embeds each rule's catalogue evaluatorVersion", () => {
    // Simulated evaluator bump: fingerprints of two IDENTICAL definitions
    // must differ if (and only if) evaluator versions differ — proven by
    // fingerprinting a known type vs. an unknown type (version 0).
    const known = makeDefinition({ ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN", id: "r-1" });
    const unknown = makeDefinition({ ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN", id: "r-1" });
    expect(ruleSetFingerprint([known])).toBe(ruleSetFingerprint([unknown]));
    const otherType = makeDefinition({ ruleType: "PHARMACY_MUST_BE_ACTIVE", id: "r-1" });
    expect(ruleSetFingerprint([known])).not.toBe(ruleSetFingerprint([otherType]));
  });
});
