// Duty Rules V2 — Phase 5 catalogue: soft pattern and preference rules.

import { z } from "zod";

import { safePositiveCount } from "../domain/rule-parameters";
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

function isWeekendDate(date: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** A positive preference SIGNAL for Phase 6 scoring — deliberately never
 *  HARD and never a failure for candidates without a preference. */
export const PREFER_REQUESTED_DATE: RuleCatalogueEntry = {
  ruleType: "PREFER_REQUESTED_DATE",
  evaluatorVersion: 1,
  allowedSeverities: ["SOFT", "ADVISORY"],
  severityConfigurable: true,
  parameterSchema: z.object({}).strict(),
  supportedScopeDimensions: CANDIDATE_SCOPES,
  supportedExceptionKinds: CANDIDATE_EXCEPTIONS,
  requiredFacts: ["candidate.prefersThisDate"],
  participatesIn: ["SCORING"],
  perCandidate: true,
  relaxable: false,
  relaxationMode: null,
  evaluate: (_parameters, context) =>
    withCandidate(context, (candidate) => ({
      outcome: candidate.prefersThisDate ? "PASS" : "NOT_APPLICABLE",
      observedValue: candidate.prefersThisDate ? "preferred" : "no-preference",
      expectedValue: "preferred",
      explanationCode: "RULE_PREFERRED_DATE_MATCH",
      factsUsed: ["candidate.prefersThisDate"],
    })),
};

export const AVOID_CONSECUTIVE_WEEKEND_ASSIGNMENTS: RuleCatalogueEntry = {
  ruleType: "AVOID_CONSECUTIVE_WEEKEND_ASSIGNMENTS",
  evaluatorVersion: 1,
  allowedSeverities: ["SOFT", "ADVISORY", "HARD"],
  severityConfigurable: true,
  parameterSchema: z.object({ lookbackDays: safePositiveCount }).strict(),
  supportedScopeDimensions: CANDIDATE_SCOPES,
  supportedExceptionKinds: CANDIDATE_EXCEPTIONS,
  requiredFacts: ["candidate.periodAssignments"],
  participatesIn: ["SCORING", "DIAGNOSTICS"],
  perCandidate: true,
  relaxable: false,
  relaxationMode: null,
  evaluate: (parameters, context) =>
    withCandidate(context, (candidate) => {
      if (!isWeekendDate(context.date)) {
        return {
          outcome: "NOT_APPLICABLE",
          observedValue: "not-weekend",
          expectedValue: "weekend",
          explanationCode: "RULE_NOT_A_WEEKEND_DATE",
          factsUsed: [],
        };
      }
      const { lookbackDays } = parameters as { lookbackDays: number };
      const windowStart = addDays(context.date, -lookbackDays);
      // Evaluated over current-period assignment facts (per-date history
      // before the period is aggregate-only by design).
      const previousWeekend = candidate.periodAssignments.some(
        (a) => a.date >= windowStart && a.date < context.date && isWeekendDate(a.date)
      );
      return {
        outcome: previousWeekend ? "FAIL" : "PASS",
        observedValue: previousWeekend ? "recent-weekend-duty" : "none",
        expectedValue: "none",
        explanationCode: "RULE_CONSECUTIVE_WEEKEND",
        factsUsed: ["candidate.periodAssignments"],
      };
    }),
};

export const AVOID_CONSECUTIVE_HOLIDAY_ASSIGNMENTS: RuleCatalogueEntry = {
  ruleType: "AVOID_CONSECUTIVE_HOLIDAY_ASSIGNMENTS",
  evaluatorVersion: 1,
  allowedSeverities: ["SOFT", "ADVISORY", "HARD"],
  severityConfigurable: true,
  parameterSchema: z.object({ lookbackDays: safePositiveCount }).strict(),
  supportedScopeDimensions: CANDIDATE_SCOPES,
  supportedExceptionKinds: CANDIDATE_EXCEPTIONS,
  requiredFacts: ["candidate.periodAssignments", "context.holidayDates"],
  participatesIn: ["SCORING", "DIAGNOSTICS"],
  perCandidate: true,
  relaxable: false,
  relaxationMode: null,
  evaluate: (parameters, context) =>
    withCandidate(context, (candidate) => {
      if (!context.holidayDates.has(context.date)) {
        return {
          outcome: "NOT_APPLICABLE",
          observedValue: "not-holiday",
          expectedValue: "holiday",
          explanationCode: "RULE_NOT_A_HOLIDAY_DATE",
          factsUsed: [],
        };
      }
      const { lookbackDays } = parameters as { lookbackDays: number };
      const windowStart = addDays(context.date, -lookbackDays);
      const previousHoliday = candidate.periodAssignments.some(
        (a) => a.date >= windowStart && a.date < context.date && context.holidayDates.has(a.date)
      );
      return {
        outcome: previousHoliday ? "FAIL" : "PASS",
        observedValue: previousHoliday ? "recent-holiday-duty" : "none",
        expectedValue: "none",
        explanationCode: "RULE_CONSECUTIVE_HOLIDAY",
        factsUsed: ["candidate.periodAssignments", "context.holidayDates"],
      };
    }),
};

export const MINIMUM_REST_AFTER_SHIFT: RuleCatalogueEntry = {
  ruleType: "MINIMUM_REST_AFTER_SHIFT",
  evaluatorVersion: 1,
  allowedSeverities: ["HARD", "SOFT"],
  severityConfigurable: true,
  parameterSchema: z
    .object({ minimumHours: z.number().int().min(1).max(72).finite() })
    .strict(),
  supportedScopeDimensions: CANDIDATE_SCOPES,
  supportedExceptionKinds: CANDIDATE_EXCEPTIONS,
  requiredFacts: ["slot.shiftTimes", "candidate.periodAssignments"],
  participatesIn: ["ELIGIBILITY", "DIAGNOSTICS"],
  perCandidate: true,
  relaxable: false,
  relaxationMode: null,
  evaluate: (_parameters, context) =>
    withCandidate(context, (candidate) => {
      // Reliable shift times are a precondition: the synthetic V1
      // whole-day shift has none — NOT_APPLICABLE, never a guess.
      if (context.shiftStartMinute === null || context.shiftEndMinute === null) {
        return {
          outcome: "NOT_APPLICABLE",
          observedValue: "no-shift-times",
          expectedValue: "shift-times",
          explanationCode: "RULE_REST_HOURS_NO_SHIFT_TIMES",
          factsUsed: ["slot.shiftTimes"],
        };
      }
      // Prior assignments carry no shift times yet: with an adjacent
      // (same/previous-day) assignment the rest gap cannot be computed —
      // controlled UNSUPPORTED_FACT; with none, the rest is trivially
      // satisfied.
      const previousDay = addDays(context.date, -1);
      const adjacent = candidate.periodAssignments.some(
        (a) => a.date === context.date || a.date === previousDay
      );
      if (adjacent) {
        return {
          outcome: "UNSUPPORTED_FACT",
          observedValue: "adjacent-assignment-without-times",
          expectedValue: "assignment-shift-times",
          explanationCode: "RULE_REST_HOURS_FACT_UNAVAILABLE",
          factsUsed: ["candidate.periodAssignments"],
        };
      }
      return {
        outcome: "PASS",
        observedValue: "no-adjacent-assignment",
        expectedValue: "rest-satisfied",
        explanationCode: "RULE_MINIMUM_REST_AFTER_SHIFT",
        factsUsed: ["slot.shiftTimes", "candidate.periodAssignments"],
      };
    }),
};
