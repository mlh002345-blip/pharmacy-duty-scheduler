import { describe, expect, it } from "vitest";

import { buildRuleExplanations } from "./build-rule-explanation";
import { evaluateRule } from "./evaluate-rule";
import { applyDateOverrides, evaluateRulesForSlot } from "./evaluate-rules";
import { makeCandidate, makeContext, makeDefinition, makeSlot } from "./test-support/fixtures";
import type { ConfiguredRuleDefinition } from "./domain/rule-definition";

describe("hard rule evaluation", () => {
  const cases: {
    ruleType: string;
    parameters?: ConfiguredRuleDefinition["parameters"];
    failing: Parameters<typeof makeCandidate>[0];
    violation: string;
  }[] = [
    {
      ruleType: "PHARMACY_MUST_BE_ACTIVE",
      failing: { membershipExclusion: "PHARMACY_INACTIVE" },
      violation: "RULE_PHARMACY_INACTIVE",
    },
    {
      ruleType: "MEMBER_OF_POOL_AS_OF_DATE",
      failing: { membershipExclusion: "NOT_A_MEMBER" },
      violation: "RULE_NOT_A_MEMBER",
    },
    {
      ruleType: "PHARMACY_UNAVAILABLE_ON_DATE",
      failing: { unavailableOnDate: true },
      violation: "RULE_UNAVAILABLE",
    },
    {
      ruleType: "BLOCK_APPROVED_CANNOT_DUTY_REQUEST",
      failing: { blockingRequestType: "CANNOT_DUTY" },
      violation: "RULE_CANNOT_DUTY_REQUEST",
    },
    {
      ruleType: "BLOCK_APPROVED_EMERGENCY_EXCUSE",
      failing: { blockingRequestType: "EMERGENCY_EXCUSE" },
      violation: "RULE_EMERGENCY_EXCUSE",
    },
    {
      ruleType: "MIN_DAYS_BETWEEN_ASSIGNMENTS",
      parameters: { minimumDays: 3, relaxable: true, scopeMode: "ALL_ASSIGNMENTS" },
      failing: { daysSinceLastDuty: 2, lastDutyDate: "2026-08-01" },
      violation: "RULE_MIN_DAYS_INTERVAL",
    },
    {
      ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN",
      failing: { assignedToThisSlot: true },
      violation: "RULE_DUPLICATE_SLOT_ASSIGNMENT",
    },
    {
      ruleType: "SAME_DAY_ASSIGNMENT_LIMIT",
      parameters: { maximumAssignments: 1, scopeMode: "ALL_SLOTS" },
      failing: { periodAssignments: [{ date: "2026-08-03", weight: 1, slotKey: "other" }] },
      violation: "RULE_SAME_DAY_ASSIGNMENT_LIMIT",
    },
    {
      ruleType: "EXCLUDE_PHARMACY",
      parameters: { pharmacyIds: ["ph-a"] },
      failing: {},
      violation: "RULE_PHARMACY_EXPLICITLY_EXCLUDED",
    },
    {
      ruleType: "INCLUDE_ONLY_PHARMACIES",
      parameters: { pharmacyIds: ["ph-OTHER"] },
      failing: {},
      violation: "RULE_PHARMACY_NOT_IN_INCLUDE_LIST",
    },
  ];

  it.each(cases)("$ruleType fails with $violation and passes otherwise", (testCase) => {
    const definition = makeDefinition({
      ruleType: testCase.ruleType,
      parameters: testCase.parameters ?? {},
    });
    const failing = evaluateRule(
      definition,
      makeContext({ candidate: makeCandidate(testCase.failing) })
    );
    expect(failing.outcome).toBe("FAIL");
    expect(failing.passed).toBe(false);
    expect(failing.violationCode).toBe(testCase.violation);
    expect(failing.decisionEffect).toBe("EXCLUDED");

    // Passing counterpart: the default healthy candidate (adjusted for
    // include-only, which needs the candidate ON the list).
    const passingParameters =
      testCase.ruleType === "INCLUDE_ONLY_PHARMACIES"
        ? { pharmacyIds: ["ph-a"] }
        : testCase.ruleType === "EXCLUDE_PHARMACY"
          ? { pharmacyIds: ["ph-OTHER"] }
          : testCase.parameters ?? {};
    const passing = evaluateRule(
      makeDefinition({ ruleType: testCase.ruleType, parameters: passingParameters }),
      makeContext()
    );
    expect(passing.outcome).toBe("PASS");
    expect(passing.violationCode).toBeNull();
  });

  it("MAX_ASSIGNMENTS_IN_PERIOD and MAX_WEIGHTED_LOAD_IN_PERIOD enforce caps", () => {
    const maxAssignments = evaluateRule(
      makeDefinition({
        ruleType: "MAX_ASSIGNMENTS_IN_PERIOD",
        parameters: { maximumAssignments: 2, periodType: "GENERATION_PERIOD" },
      }),
      makeContext({
        candidate: makeCandidate({
          periodAssignments: [
            { date: "2026-08-01", weight: 1, slotKey: null },
            { date: "2026-08-02", weight: 1, slotKey: null },
          ],
        }),
      })
    );
    expect(maxAssignments.outcome).toBe("FAIL");

    const load = evaluateRule(
      makeDefinition({
        ruleType: "MAX_WEIGHTED_LOAD_IN_PERIOD",
        parameters: { maximumLoad: 3, periodType: "GENERATION_PERIOD" },
      }),
      makeContext({
        candidate: makeCandidate(),
        fairness: {
          candidateKey: "2026-08-03:WEEKDAY:Tam Gün:0#m-a",
          pharmacyId: "ph-a",
          dateWeight: 1.5,
          historicalDutyCount: 0,
          historicalWeightedLoad: 0,
          balanceAdjustment: 0,
          currentPeriodWeightedLoad: 2,
          totalWeightedLoad: 2,
          projectedLoadIfAssigned: 3.5,
          totalAssignmentCount: 2,
          weekendCount: 0,
          sundayCount: 0,
          holidayCount: 0,
          lastDutyDate: null,
          daysSinceLastDuty: null,
          prefersThisDate: false,
          nameTieBreakValue: "Çınar Eczanesi",
        },
      })
    );
    expect(load.outcome).toBe("FAIL"); // 2 + 1.5 > 3
    expect(load.observedValue).toBe("3.5");
  });

  it("multiple simultaneous hard failures are retained across rules", () => {
    const context = makeContext({
      candidate: makeCandidate({ unavailableOnDate: true, assignedToThisSlot: true }),
    });
    const results = evaluateRulesForSlot({
      definitions: [
        makeDefinition({ ruleType: "PHARMACY_UNAVAILABLE_ON_DATE", id: "r-1" }),
        makeDefinition({ ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN", id: "r-2" }),
      ],
      candidateContexts: [context],
      slotContext: makeContext({ candidate: null }),
    });
    expect(results.filter((r) => r.outcome === "FAIL")).toHaveLength(2);
  });
});

describe("soft and advisory behavior", () => {
  it("PREFER_REQUESTED_DATE yields a SOFT PASS signal for preferring candidates and NOT_APPLICABLE otherwise", () => {
    const definition = makeDefinition({
      ruleType: "PREFER_REQUESTED_DATE",
      severity: "SOFT",
    });
    const preferring = evaluateRule(
      definition,
      makeContext({ candidate: makeCandidate({ prefersThisDate: true }) })
    );
    expect(preferring.outcome).toBe("PASS");
    const indifferent = evaluateRule(definition, makeContext());
    expect(indifferent.outcome).toBe("NOT_APPLICABLE");
    expect(indifferent.passed).toBe(true); // never a failure
  });

  it("consecutive weekend/holiday rules produce SOFT failures with PENALIZED effect", () => {
    const weekend = evaluateRule(
      makeDefinition({
        ruleType: "AVOID_CONSECUTIVE_WEEKEND_ASSIGNMENTS",
        severity: "SOFT",
        parameters: { lookbackDays: 7 },
      }),
      makeContext({
        slot: makeSlot({ date: "2026-08-08", slotKey: "2026-08-08:SATURDAY:Tam Gün:0" }), // Saturday
        candidate: makeCandidate({
          date: "2026-08-08",
          periodAssignments: [{ date: "2026-08-02", weight: 1.5, slotKey: null }], // Sunday
        }),
      })
    );
    expect(weekend.outcome).toBe("FAIL");
    expect(weekend.severity).toBe("SOFT");
    expect(weekend.decisionEffect).toBe("PENALIZED");

    const holiday = evaluateRule(
      makeDefinition({
        ruleType: "AVOID_CONSECUTIVE_HOLIDAY_ASSIGNMENTS",
        severity: "ADVISORY",
        parameters: { lookbackDays: 7 },
      }),
      makeContext({
        holidayDates: new Set(["2026-08-03", "2026-08-01"]),
        candidate: makeCandidate({
          periodAssignments: [{ date: "2026-08-01", weight: 2, slotKey: null }],
        }),
      })
    );
    expect(holiday.outcome).toBe("FAIL");
    expect(holiday.decisionEffect).toBe("INFORMATION_ONLY"); // advisory never penalizes
  });
});

describe("unsupported facts and NOT_APPLICABLE", () => {
  it("tag and group rules return UNSUPPORTED_FACT — never a silent pass", () => {
    const tag = evaluateRule(
      makeDefinition({
        ruleType: "TAG_COMBINATION_FORBIDDEN",
        parameters: { tagKey: "tur", tagValues: ["hastane"], maximumTogether: 1 },
      }),
      makeContext()
    );
    expect(tag.outcome).toBe("UNSUPPORTED_FACT");
    expect(tag.decisionEffect).toBe("UNSUPPORTED");
    expect(tag.passed).toBe(true); // does not fail anyone silently either

    const group = evaluateRule(
      makeDefinition({
        ruleType: "GROUP_COMBINATION_FORBIDDEN",
        parameters: { groupIds: ["grp-1"], maximumTogether: 1 },
      }),
      makeContext()
    );
    expect(group.outcome).toBe("UNSUPPORTED_FACT");
  });

  it("MINIMUM_REST_AFTER_SHIFT: null shift times => NOT_APPLICABLE; real times with adjacent assignment => UNSUPPORTED_FACT", () => {
    const definition = makeDefinition({
      ruleType: "MINIMUM_REST_AFTER_SHIFT",
      parameters: { minimumHours: 11 },
    });
    const nullTimes = evaluateRule(definition, makeContext());
    expect(nullTimes.outcome).toBe("NOT_APPLICABLE");
    expect(nullTimes.explanationCode).toBe("RULE_REST_HOURS_NO_SHIFT_TIMES");

    const adjacent = evaluateRule(
      definition,
      makeContext({
        shiftStartMinute: 480,
        shiftEndMinute: 1140,
        candidate: makeCandidate({
          periodAssignments: [{ date: "2026-08-02", weight: 1, slotKey: null }],
        }),
      })
    );
    expect(adjacent.outcome).toBe("UNSUPPORTED_FACT");

    const clear = evaluateRule(
      definition,
      makeContext({ shiftStartMinute: 480, shiftEndMinute: 1140 })
    );
    expect(clear.outcome).toBe("PASS");
  });

  it("SAME_DAY_ASSIGNMENT_LIMIT non-ALL_SLOTS scope modes are UNSUPPORTED_FACT", () => {
    const result = evaluateRule(
      makeDefinition({
        ruleType: "SAME_DAY_ASSIGNMENT_LIMIT",
        parameters: { maximumAssignments: 1, scopeMode: "SAME_SHIFT" },
      }),
      makeContext()
    );
    expect(result.outcome).toBe("UNSUPPORTED_FACT");
  });
});

describe("CUSTOM_DATE_OVERRIDE (meta rule)", () => {
  const target = makeDefinition({ ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN", id: "r-target" });
  const override = makeDefinition({
    ruleType: "CUSTOM_DATE_OVERRIDE",
    id: "r-override",
    severity: "ADVISORY",
    parameters: { targetRuleIds: ["r-target"], dates: ["2026-08-03"], action: "DISABLE" },
  });

  it("disables the referenced rule on listed dates only", () => {
    const onDate = applyDateOverrides([target, override], "2026-08-03");
    expect(onDate.find((d) => d.id === "r-target")?.enabled).toBe(false);
    const offDate = applyDateOverrides([target, override], "2026-08-04");
    expect(offDate.find((d) => d.id === "r-target")?.enabled).toBe(true);
  });

  it("severity overrides respect the target catalogue's allowed severities", () => {
    const severityOverride = makeDefinition({
      ruleType: "CUSTOM_DATE_OVERRIDE",
      id: "r-sev",
      severity: "ADVISORY",
      parameters: {
        targetRuleIds: ["r-min"],
        dates: ["2026-08-03"],
        action: "SET_SEVERITY",
        severity: "SOFT",
      },
    });
    const minDays = makeDefinition({
      ruleType: "MIN_DAYS_BETWEEN_ASSIGNMENTS",
      id: "r-min",
      parameters: { minimumDays: 2, relaxable: true, scopeMode: "ALL_ASSIGNMENTS" },
    });
    const applied = applyDateOverrides([minDays, severityOverride], "2026-08-03");
    expect(applied.find((d) => d.id === "r-min")?.severity).toBe("SOFT");

    // A hard-only safety rule cannot be softened by an override.
    const illegal = makeDefinition({
      ruleType: "CUSTOM_DATE_OVERRIDE",
      id: "r-illegal",
      severity: "ADVISORY",
      parameters: {
        targetRuleIds: ["r-target"],
        dates: ["2026-08-03"],
        action: "SET_SEVERITY",
        severity: "SOFT",
      },
    });
    const unchanged = applyDateOverrides([target, illegal], "2026-08-03");
    expect(unchanged.find((d) => d.id === "r-target")?.severity).toBe("HARD");
  });
});

describe("explainability", () => {
  it("failed hard/soft, advisory, exception, and unsupported results all yield code-based explanations without tenant names", () => {
    const definitions = [
      makeDefinition({ ruleType: "PHARMACY_UNAVAILABLE_ON_DATE", id: "r-hard" }),
      makeDefinition({
        ruleType: "AVOID_CONSECUTIVE_WEEKEND_ASSIGNMENTS",
        id: "r-soft",
        severity: "SOFT",
        parameters: { lookbackDays: 7 },
      }),
      makeDefinition({
        ruleType: "PREFER_REQUESTED_DATE",
        id: "r-advisory",
        severity: "ADVISORY",
      }),
      makeDefinition({
        ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN",
        id: "r-excepted",
        exceptions: { excludedDates: ["2026-08-03"] },
      }),
      makeDefinition({
        ruleType: "TAG_COMBINATION_FORBIDDEN",
        id: "r-unsupported",
        parameters: { tagKey: "tur", tagValues: ["v"], maximumTogether: 1 },
      }),
    ];
    const context = makeContext({
      candidate: makeCandidate({ unavailableOnDate: true, pharmacyName: "Gizli Eczanesi" }),
    });
    const results = evaluateRulesForSlot({
      definitions,
      candidateContexts: [context],
      slotContext: makeContext({ candidate: null }),
    });
    const explanations = buildRuleExplanations(
      new Map(definitions.map((d) => [d.id, d])),
      results
    );
    const byRule = new Map(explanations.map((e) => [e.ruleId, e]));
    expect(byRule.get("r-hard")).toMatchObject({
      applicability: "APPLICABLE",
      decisionEffect: "EXCLUDED",
      explanationCode: "RULE_UNAVAILABLE",
      relaxable: false,
    });
    expect(byRule.get("r-excepted")).toMatchObject({
      applicability: "EXCEPTION",
      exceptionMatched: "excludedDates",
      decisionEffect: "NO_EFFECT",
    });
    expect(byRule.get("r-unsupported")?.applicability).toBe("UNSUPPORTED");
    // No sensitive tenant content anywhere in explanation payloads.
    expect(JSON.stringify(explanations)).not.toContain("Gizli");
  });
});
