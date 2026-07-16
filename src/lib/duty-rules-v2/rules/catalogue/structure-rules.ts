// Duty Rules V2 — Phase 5 catalogue: slot/quota diagnostics, future-fact
// rules, and the date-override meta rule.

import { z } from "zod";

import { safeDateArray, safeIdArray, safePositiveCount, RULE_LIMITS } from "../domain/rule-parameters";
import type { RuleCatalogueEntry } from "../domain/rule-catalogue";

const SLOT_SCOPES = [
  "organizationId",
  "regionId",
  "planId",
  "planVersionId",
  "poolIds",
  "dayTypes",
  "customDayCategories",
  "shiftKeys",
  "slotIds",
  "dateRange",
  "weekdays",
  "holidayTypes",
  "generationModes",
] as const;

const SLOT_EXCEPTIONS = [
  "excludedDates",
  "includedDates",
  "excludedWeekdays",
  "excludedHolidayTypes",
  "excludedPoolIds",
  "excludedSlotIds",
  "excludedGenerationModes",
] as const;

/** Slot-level quota DIAGNOSTIC (this phase never selects winners). */
export const POOL_QUOTA: RuleCatalogueEntry = {
  ruleType: "POOL_QUOTA",
  evaluatorVersion: 1,
  allowedSeverities: ["HARD", "ADVISORY"],
  severityConfigurable: true,
  parameterSchema: z
    .object({
      requiredCount: safePositiveCount.optional(),
      maximumCount: safePositiveCount.optional(),
    })
    .strict()
    .refine((p) => p.requiredCount !== undefined || p.maximumCount !== undefined, {
      message: "requiredCount or maximumCount required",
    })
    .refine(
      (p) =>
        p.requiredCount === undefined ||
        p.maximumCount === undefined ||
        p.requiredCount <= p.maximumCount,
      { message: "requiredCount must be <= maximumCount" }
    ),
  supportedScopeDimensions: SLOT_SCOPES,
  supportedExceptionKinds: SLOT_EXCEPTIONS,
  requiredFacts: ["slot.requiredCount"],
  participatesIn: ["QUOTA", "DIAGNOSTICS"],
  perCandidate: false,
  relaxable: false,
  relaxationMode: null,
  evaluate: (parameters, context) => {
    const { requiredCount, maximumCount } = parameters as {
      requiredCount?: number;
      maximumCount?: number;
    };
    const actual = context.slot.requiredCount;
    const belowRequired = requiredCount !== undefined && actual < requiredCount;
    const aboveMaximum = maximumCount !== undefined && actual > maximumCount;
    return {
      outcome: belowRequired || aboveMaximum ? "FAIL" : "PASS",
      observedValue: String(actual),
      expectedValue: `${requiredCount ?? "-"}..${maximumCount ?? "-"}`,
      explanationCode: "RULE_POOL_QUOTA",
      factsUsed: ["slot.requiredCount"],
    };
  },
};

/** Tag facts do not exist yet: a controlled UNSUPPORTED_FACT — the rule
 *  is configurable today and becomes effective when tag facts arrive. */
export const TAG_COMBINATION_FORBIDDEN: RuleCatalogueEntry = {
  ruleType: "TAG_COMBINATION_FORBIDDEN",
  evaluatorVersion: 1,
  allowedSeverities: ["HARD", "SOFT"],
  severityConfigurable: true,
  parameterSchema: z
    .object({
      tagKey: z.string().min(1).max(RULE_LIMITS.maxIdLength),
      tagValues: z.array(z.string().min(1).max(RULE_LIMITS.maxIdLength)).min(1).max(100),
      maximumTogether: safePositiveCount,
    })
    .strict(),
  supportedScopeDimensions: SLOT_SCOPES,
  supportedExceptionKinds: SLOT_EXCEPTIONS,
  requiredFacts: ["candidate.tags"],
  participatesIn: ["DIAGNOSTICS"],
  perCandidate: true,
  relaxable: false,
  relaxationMode: null,
  evaluate: (_parameters, context) => ({
    outcome: "UNSUPPORTED_FACT",
    observedValue: context.tags === null ? "tags-unavailable" : "tags",
    expectedValue: "candidate tag facts",
    explanationCode: "RULE_TAG_FACTS_UNAVAILABLE",
    factsUsed: ["candidate.tags"],
  }),
};

export const GROUP_COMBINATION_FORBIDDEN: RuleCatalogueEntry = {
  ruleType: "GROUP_COMBINATION_FORBIDDEN",
  evaluatorVersion: 1,
  allowedSeverities: ["HARD", "SOFT"],
  severityConfigurable: true,
  parameterSchema: z
    .object({
      groupIds: safeIdArray.refine((ids) => ids.length > 0),
      maximumTogether: safePositiveCount,
    })
    .strict(),
  supportedScopeDimensions: SLOT_SCOPES,
  supportedExceptionKinds: SLOT_EXCEPTIONS,
  requiredFacts: ["candidate.groups"],
  participatesIn: ["DIAGNOSTICS"],
  perCandidate: true,
  relaxable: false,
  relaxationMode: null,
  evaluate: (_parameters, context) => ({
    outcome: "UNSUPPORTED_FACT",
    observedValue: context.groups === null ? "groups-unavailable" : "groups",
    expectedValue: "pharmacy group facts",
    explanationCode: "RULE_GROUP_FACTS_UNAVAILABLE",
    factsUsed: ["candidate.groups"],
  }),
};

/** Meta rule: on the listed dates, referenced catalogue rules are
 *  disabled or get a different severity. Applied during rule-set
 *  preparation (evaluate-rules.ts) — it has NO evaluator logic of its
 *  own and can never inject custom behavior. */
export const CUSTOM_DATE_OVERRIDE: RuleCatalogueEntry = {
  ruleType: "CUSTOM_DATE_OVERRIDE",
  evaluatorVersion: 1,
  allowedSeverities: ["ADVISORY"],
  severityConfigurable: false,
  parameterSchema: z
    .object({
      targetRuleIds: safeIdArray.refine((ids) => ids.length > 0),
      dates: safeDateArray.refine((dates) => dates.length > 0),
      action: z.enum(["DISABLE", "SET_SEVERITY"]),
      severity: z.enum(["HARD", "SOFT", "ADVISORY"]).optional(),
    })
    .strict()
    .refine((p) => p.action !== "SET_SEVERITY" || p.severity !== undefined, {
      message: "severity required for SET_SEVERITY",
    }),
  supportedScopeDimensions: SLOT_SCOPES,
  supportedExceptionKinds: [],
  requiredFacts: [],
  participatesIn: ["DIAGNOSTICS"],
  perCandidate: false,
  relaxable: false,
  relaxationMode: null,
  evaluate: () => ({
    outcome: "NOT_APPLICABLE",
    observedValue: "meta-rule",
    expectedValue: "applied-at-preparation",
    explanationCode: "RULE_DATE_OVERRIDE_META",
    factsUsed: [],
  }),
};
