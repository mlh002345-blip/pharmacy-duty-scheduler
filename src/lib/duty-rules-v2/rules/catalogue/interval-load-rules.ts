// Duty Rules V2 — Phase 5 catalogue: interval, same-day, and load rules.

import { z } from "zod";

import { safeLoad, safePositiveCount } from "../domain/rule-parameters";
import type { EvaluatorVerdict, RuleCatalogueEntry } from "../domain/rule-catalogue";
import type { RuleEvaluationContext } from "../domain/rule-evaluation";
import { addDays } from "../../engine/domain/dates";

const CANDIDATE_SCOPES = [
  "organizationId",
  "regionId",
  "planId",
  "planVersionId",
  "poolIds",
  "dayTypes",
  "customDayCategories",
  "shiftKeys",
  "slotIds",
  "pharmacyIds",
  "dateRange",
  "weekdays",
  "holidayTypes",
  "generationModes",
] as const;

const CANDIDATE_EXCEPTIONS = [
  "excludedDates",
  "includedDates",
  "excludedWeekdays",
  "excludedHolidayTypes",
  "excludedPharmacyIds",
  "excludedPoolIds",
  "excludedSlotIds",
  "excludedGenerationModes",
] as const;

function withCandidate(
  context: RuleEvaluationContext,
  verdict: (candidate: NonNullable<RuleEvaluationContext["candidate"]>) => EvaluatorVerdict
): EvaluatorVerdict {
  if (context.candidate === null) {
    return {
      outcome: "NOT_APPLICABLE",
      observedValue: "slot-level",
      expectedValue: "candidate",
      explanationCode: "CANDIDATE_CONTEXT_REQUIRED",
      factsUsed: [],
    };
  }
  return verdict(context.candidate);
}

/** The ONLY rule that may reproduce V1's automatic relaxation, and the
 *  chamber must explicitly opt in via the `relaxable` parameter. */
export const MIN_DAYS_BETWEEN_ASSIGNMENTS: RuleCatalogueEntry = {
  ruleType: "MIN_DAYS_BETWEEN_ASSIGNMENTS",
  evaluatorVersion: 1,
  allowedSeverities: ["HARD", "SOFT"],
  severityConfigurable: true,
  parameterSchema: z
    .object({
      minimumDays: safePositiveCount,
      relaxable: z.boolean(),
      scopeMode: z.enum(["ALL_ASSIGNMENTS"]),
    })
    .strict(),
  supportedScopeDimensions: CANDIDATE_SCOPES,
  supportedExceptionKinds: CANDIDATE_EXCEPTIONS,
  requiredFacts: ["candidate.daysSinceLastDuty"],
  participatesIn: ["ELIGIBILITY"],
  perCandidate: true,
  relaxable: true,
  relaxationMode: "V1_MIN_INTERVAL",
  evaluate: (parameters, context) =>
    withCandidate(context, (candidate) => {
      const { minimumDays } = parameters as { minimumDays: number };
      const passed =
        candidate.daysSinceLastDuty === null || candidate.daysSinceLastDuty >= minimumDays;
      return {
        outcome: passed ? "PASS" : "FAIL",
        observedValue:
          candidate.daysSinceLastDuty === null ? "never" : String(candidate.daysSinceLastDuty),
        expectedValue: `>=${minimumDays}`,
        explanationCode: "RULE_MIN_DAYS_INTERVAL",
        factsUsed: ["candidate.daysSinceLastDuty"],
      };
    }),
};

export const SAME_DAY_ASSIGNMENT_LIMIT: RuleCatalogueEntry = {
  ruleType: "SAME_DAY_ASSIGNMENT_LIMIT",
  evaluatorVersion: 1,
  allowedSeverities: ["HARD"],
  severityConfigurable: false,
  parameterSchema: z
    .object({
      maximumAssignments: safePositiveCount,
      scopeMode: z.enum(["ALL_SLOTS", "SAME_SHIFT", "SAME_POOL", "SAME_DAY_TYPE"]),
    })
    .strict(),
  supportedScopeDimensions: CANDIDATE_SCOPES,
  supportedExceptionKinds: CANDIDATE_EXCEPTIONS,
  requiredFacts: ["candidate.periodAssignments"],
  participatesIn: ["ELIGIBILITY"],
  perCandidate: true,
  relaxable: false,
  relaxationMode: null,
  evaluate: (parameters, context) =>
    withCandidate(context, (candidate) => {
      const { maximumAssignments, scopeMode } = parameters as {
        maximumAssignments: number;
        scopeMode: string;
      };
      // Existing assignments carry only date + opaque slotKey; shift/
      // pool/day-type attribution per assignment is a future fact.
      // Anything but ALL_SLOTS is therefore UNSUPPORTED_FACT — a
      // controlled result, never a silent pass.
      if (scopeMode !== "ALL_SLOTS") {
        return {
          outcome: "UNSUPPORTED_FACT",
          observedValue: scopeMode,
          expectedValue: "ALL_SLOTS",
          explanationCode: "RULE_SAME_DAY_SCOPE_FACT_UNAVAILABLE",
          factsUsed: ["candidate.periodAssignments"],
        };
      }
      const sameDay = candidate.periodAssignments.filter((a) => a.date === context.date).length;
      const passed = sameDay < maximumAssignments;
      return {
        outcome: passed ? "PASS" : "FAIL",
        observedValue: String(sameDay),
        expectedValue: `<${maximumAssignments}`,
        explanationCode: "RULE_SAME_DAY_ASSIGNMENT_LIMIT",
        factsUsed: ["candidate.periodAssignments"],
      };
    }),
};

export const MAX_ASSIGNMENTS_IN_PERIOD: RuleCatalogueEntry = {
  ruleType: "MAX_ASSIGNMENTS_IN_PERIOD",
  evaluatorVersion: 1,
  allowedSeverities: ["HARD", "SOFT"],
  severityConfigurable: true,
  parameterSchema: z
    .object({
      maximumAssignments: safePositiveCount,
      periodType: z.enum(["GENERATION_PERIOD", "ROLLING_DAYS"]),
      rollingDays: safePositiveCount.optional(),
    })
    .strict()
    .refine((p) => p.periodType !== "ROLLING_DAYS" || p.rollingDays !== undefined, {
      message: "rollingDays required for ROLLING_DAYS",
    }),
  supportedScopeDimensions: CANDIDATE_SCOPES,
  supportedExceptionKinds: CANDIDATE_EXCEPTIONS,
  requiredFacts: ["candidate.periodAssignments"],
  participatesIn: ["ELIGIBILITY", "QUOTA"],
  perCandidate: true,
  relaxable: false,
  relaxationMode: null,
  evaluate: (parameters, context) =>
    withCandidate(context, (candidate) => {
      const { maximumAssignments, periodType, rollingDays } = parameters as {
        maximumAssignments: number;
        periodType: string;
        rollingDays?: number;
      };
      let counted: number;
      if (periodType === "GENERATION_PERIOD") {
        counted = candidate.periodAssignments.length;
      } else {
        const windowStart = addDays(context.date, -(rollingDays as number) + 1);
        // Per-date history before the generation period is not carried
        // (only aggregates); a window reaching before the period cannot
        // be counted precisely — controlled UNSUPPORTED_FACT.
        if (windowStart < context.periodStart) {
          return {
            outcome: "UNSUPPORTED_FACT",
            observedValue: `window:${windowStart}`,
            expectedValue: `>=${context.periodStart}`,
            explanationCode: "RULE_ROLLING_WINDOW_FACT_UNAVAILABLE",
            factsUsed: ["candidate.periodAssignments"],
          };
        }
        counted = candidate.periodAssignments.filter((a) => a.date >= windowStart).length;
      }
      const passed = counted < maximumAssignments;
      return {
        outcome: passed ? "PASS" : "FAIL",
        observedValue: String(counted),
        expectedValue: `<${maximumAssignments}`,
        explanationCode: "RULE_MAX_ASSIGNMENTS_IN_PERIOD",
        factsUsed: ["candidate.periodAssignments"],
      };
    }),
};

export const MAX_WEIGHTED_LOAD_IN_PERIOD: RuleCatalogueEntry = {
  ruleType: "MAX_WEIGHTED_LOAD_IN_PERIOD",
  evaluatorVersion: 1,
  allowedSeverities: ["HARD", "SOFT"],
  severityConfigurable: true,
  parameterSchema: z
    .object({
      maximumLoad: safeLoad,
      periodType: z.enum(["GENERATION_PERIOD"]),
    })
    .strict(),
  supportedScopeDimensions: CANDIDATE_SCOPES,
  supportedExceptionKinds: CANDIDATE_EXCEPTIONS,
  requiredFacts: ["fairness.currentPeriodWeightedLoad", "fairness.dateWeight"],
  participatesIn: ["ELIGIBILITY", "QUOTA"],
  perCandidate: true,
  relaxable: false,
  relaxationMode: null,
  evaluate: (parameters, context) => {
    if (context.candidate === null || context.fairness === null) {
      return {
        outcome: "NOT_APPLICABLE",
        observedValue: "slot-level",
        expectedValue: "candidate",
        explanationCode: "CANDIDATE_CONTEXT_REQUIRED",
        factsUsed: [],
      };
    }
    const { maximumLoad } = parameters as { maximumLoad: number };
    // Would the candidate exceed the cap IF assigned to this slot?
    const projected = context.fairness.currentPeriodWeightedLoad + context.fairness.dateWeight;
    const passed = projected <= maximumLoad;
    return {
      outcome: passed ? "PASS" : "FAIL",
      observedValue: String(projected),
      expectedValue: `<=${maximumLoad}`,
      explanationCode: "RULE_MAX_WEIGHTED_LOAD_IN_PERIOD",
      factsUsed: ["fairness.currentPeriodWeightedLoad", "fairness.dateWeight"],
    };
  },
};
