import { describe, expect, it } from "vitest";

import { analyzeRuleConflicts } from "./analyze-rule-conflicts";
import { ruleSetFingerprint } from "./canonicalize-rule-set";
import { makeDefinition } from "./test-support/fixtures";

const context = {
  organizationId: "org-1",
  regionId: "region-1",
  knownPharmacyIds: new Set(["ph-a", "ph-b", "ph-c"]),
  knownPoolIds: new Set(["pool-1"]),
};

describe("conflict analysis", () => {
  it("detects duplicate active definitions with identical type and scope", () => {
    const conflicts = analyzeRuleConflicts(
      [
        makeDefinition({ ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN", id: "r-1" }),
        makeDefinition({ ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN", id: "r-2" }),
      ],
      context
    );
    expect(conflicts).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_RULE_DEFINITION", level: "ERROR", ruleIds: ["r-1", "r-2"] })
    );
  });

  it("detects include/exclude contradiction (warning) and provably impossible sets (error)", () => {
    const partial = analyzeRuleConflicts(
      [
        makeDefinition({
          ruleType: "INCLUDE_ONLY_PHARMACIES",
          id: "r-inc",
          priority: 1,
          parameters: { pharmacyIds: ["ph-a", "ph-b"] },
        }),
        makeDefinition({
          ruleType: "EXCLUDE_PHARMACY",
          id: "r-exc",
          priority: 2,
          parameters: { pharmacyIds: ["ph-a"] },
        }),
      ],
      context
    );
    expect(partial).toContainEqual(
      expect.objectContaining({ code: "INCLUDE_EXCLUDE_CONTRADICTION", level: "WARNING" })
    );
    expect(partial.some((c) => c.code === "IMPOSSIBLE_PHARMACY_SET")).toBe(false);

    const impossible = analyzeRuleConflicts(
      [
        makeDefinition({
          ruleType: "INCLUDE_ONLY_PHARMACIES",
          id: "r-inc",
          priority: 1,
          parameters: { pharmacyIds: ["ph-a"] },
        }),
        makeDefinition({
          ruleType: "EXCLUDE_PHARMACY",
          id: "r-exc",
          priority: 2,
          parameters: { pharmacyIds: ["ph-a"] },
        }),
      ],
      context
    );
    expect(impossible).toContainEqual(
      expect.objectContaining({ code: "IMPOSSIBLE_PHARMACY_SET", level: "ERROR" })
    );
  });

  it("detects impossible quota, invalid severity, unknown type, and tenant-inconsistent ids", () => {
    const conflicts = analyzeRuleConflicts(
      [
        makeDefinition({
          ruleType: "POOL_QUOTA",
          id: "r-quota",
          parameters: { requiredCount: 5, maximumCount: 2 },
        }),
        makeDefinition({ ruleType: "PHARMACY_MUST_BE_ACTIVE", id: "r-sev", severity: "SOFT" }),
        makeDefinition({ ruleType: "NAMED_HOSPITAL_RULE", id: "r-unknown" }),
        makeDefinition({
          ruleType: "EXCLUDE_PHARMACY",
          id: "r-foreign",
          parameters: { pharmacyIds: ["ph-FOREIGN"] },
        }),
        makeDefinition({
          ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN",
          id: "r-wrong-org",
          scope: { organizationId: "org-OTHER" },
        }),
      ],
      context
    );
    const codes = conflicts.map((c) => c.code);
    expect(codes).toContain("IMPOSSIBLE_QUOTA");
    expect(codes).toContain("UNSUPPORTED_SEVERITY");
    expect(codes).toContain("UNKNOWN_RULE_TYPE");
    expect(codes).toContain("TENANT_INCONSISTENT_ID");
    expect(
      conflicts.filter((c) => c.code === "TENANT_INCONSISTENT_ID").map((c) => c.detail)
    ).toEqual(expect.arrayContaining(["pharmacy:ph-FOREIGN", "organizationId"]));
  });

  it("detects a validity period fully excluded by exceptions, and exceptions outside validity (info)", () => {
    const fullyExcluded = analyzeRuleConflicts(
      [
        makeDefinition({
          ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN",
          id: "r-dead",
          validFrom: "2026-08-01",
          validTo: "2026-08-03",
          exceptions: { excludedDates: ["2026-08-01", "2026-08-02", "2026-08-03"] },
        }),
      ],
      context
    );
    expect(fullyExcluded).toContainEqual(
      expect.objectContaining({ code: "VALIDITY_FULLY_EXCLUDED", level: "ERROR" })
    );

    const outside = analyzeRuleConflicts(
      [
        makeDefinition({
          ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN",
          id: "r-info",
          validFrom: "2026-08-01",
          validTo: "2026-08-31",
          exceptions: { excludedDates: ["2026-09-15"] },
        }),
      ],
      context
    );
    expect(outside).toContainEqual(
      expect.objectContaining({ code: "EXCEPTION_OUTSIDE_VALIDITY", level: "INFO" })
    );
  });

  it("detects equal-priority hard contradictions and overlapping equal-precedence overrides", () => {
    const conflicts = analyzeRuleConflicts(
      [
        makeDefinition({
          ruleType: "INCLUDE_ONLY_PHARMACIES",
          id: "r-inc",
          priority: 5,
          parameters: { pharmacyIds: ["ph-a", "ph-b"] },
        }),
        makeDefinition({
          ruleType: "EXCLUDE_PHARMACY",
          id: "r-exc",
          priority: 5,
          parameters: { pharmacyIds: ["ph-b", "ph-c"] },
        }),
        makeDefinition({
          ruleType: "CUSTOM_DATE_OVERRIDE",
          id: "r-o1",
          severity: "ADVISORY",
          priority: 9,
          parameters: { targetRuleIds: ["r-inc"], dates: ["2026-08-03"], action: "DISABLE" },
        }),
        makeDefinition({
          ruleType: "CUSTOM_DATE_OVERRIDE",
          id: "r-o2",
          severity: "ADVISORY",
          priority: 9,
          parameters: {
            targetRuleIds: ["r-inc"],
            dates: ["2026-08-03"],
            action: "SET_SEVERITY",
            severity: "SOFT",
          },
        }),
      ],
      context
    );
    const codes = conflicts.map((c) => c.code);
    expect(codes).toContain("EQUAL_PRIORITY_HARD_CONTRADICTION");
    expect(codes).toContain("OVERLAPPING_EQUAL_PRECEDENCE_OVERRIDE");
  });

  it("conflict output is deterministically ordered regardless of input order", () => {
    const definitions = [
      makeDefinition({ ruleType: "NAMED_HOSPITAL_RULE", id: "r-z" }),
      makeDefinition({
        ruleType: "POOL_QUOTA",
        id: "r-a",
        parameters: { requiredCount: 5, maximumCount: 2 },
      }),
      makeDefinition({
        ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN",
        id: "r-info",
        validFrom: "2026-08-01",
        validTo: "2026-08-31",
        exceptions: { excludedDates: ["2026-09-15"] },
      }),
    ];
    const forward = analyzeRuleConflicts(definitions, context);
    const reversed = analyzeRuleConflicts([...definitions].reverse(), context);
    expect(forward).toEqual(reversed);
    // ERROR entries sort before WARNING before INFO.
    const levels = forward.map((c) => c.level);
    expect(levels).toEqual([...levels].sort((a, b) => ({ ERROR: 0, WARNING: 1, INFO: 2 })[a] - ({ ERROR: 0, WARNING: 1, INFO: 2 })[b]));
  });
});

describe("rule-set fingerprint", () => {
  const base = () => [
    makeDefinition({
      ruleType: "MIN_DAYS_BETWEEN_ASSIGNMENTS",
      id: "r-min",
      priority: 2,
      parameters: { minimumDays: 2, relaxable: true, scopeMode: "ALL_ASSIGNMENTS" },
    }),
    makeDefinition({
      ruleType: "EXCLUDE_PHARMACY",
      id: "r-exc",
      priority: 1,
      parameters: { pharmacyIds: ["ph-b", "ph-a"] },
      exceptions: { excludedDates: ["2026-08-05", "2026-08-04"] },
    }),
  ];

  it("is independent of rule order, set-like array order, and parameter key order", () => {
    const a = ruleSetFingerprint(base());
    const reordered = ruleSetFingerprint([...base()].reverse());
    expect(reordered).toBe(a);
    const shuffledArrays = base();
    shuffledArrays[1].parameters = { pharmacyIds: ["ph-a", "ph-b"] };
    shuffledArrays[1].exceptions = { excludedDates: ["2026-08-04", "2026-08-05"] };
    expect(ruleSetFingerprint(shuffledArrays)).toBe(a);
    const keyOrder = base();
    keyOrder[0].parameters = { scopeMode: "ALL_ASSIGNMENTS", relaxable: true, minimumDays: 2 };
    expect(ruleSetFingerprint(keyOrder)).toBe(a);
  });

  it("flips on severity, priority, enabled state, parameters, validity, exceptions, and scope", () => {
    const a = ruleSetFingerprint(base());
    const variants: ((defs: ReturnType<typeof base>) => void)[] = [
      (defs) => (defs[0].severity = "SOFT"),
      (defs) => (defs[0].priority = 99),
      (defs) => (defs[0].enabled = false),
      (defs) => (defs[0].parameters = { minimumDays: 3, relaxable: true, scopeMode: "ALL_ASSIGNMENTS" }),
      (defs) => (defs[0].validFrom = "2026-08-01"),
      (defs) => (defs[1].exceptions = { excludedDates: ["2026-08-06"] }),
      (defs) => (defs[1].scope = { poolIds: ["pool-1"] }),
      (defs) => (defs[1].version = 2),
    ];
    const prints = variants.map((mutate) => {
      const defs = base();
      mutate(defs);
      return ruleSetFingerprint(defs);
    });
    for (const [i, p] of prints.entries()) expect(p, `variant ${i}`).not.toBe(a);
    expect(new Set(prints).size).toBe(prints.length);
  });

  it("does NOT flip on display-only name/description", () => {
    const a = ruleSetFingerprint(base());
    const renamed = base();
    renamed[0].name = "Bambaşka Görünen Ad";
    renamed[0].metadata = { description: "Sadece açıklama" };
    expect(ruleSetFingerprint(renamed)).toBe(a);
  });

  it("is byte-identical across three repeated runs", () => {
    const prints = [1, 2, 3].map(() => ruleSetFingerprint(base()));
    expect(new Set(prints).size).toBe(1);
  });
});
