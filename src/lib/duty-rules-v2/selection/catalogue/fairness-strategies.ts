// Duty Rules V2 — Phase 6 catalogue: fairness-based strategies.

import { z } from "zod";

import { safeWeight, STRATEGY_LIMITS } from "../domain/strategy-parameters";
import type { RankingCriterion } from "../domain/ranking-fact";
import type { StrategyCatalogueEntry } from "../domain/strategy-catalogue";

const SCOPE_DIMENSIONS = [
  "organizationId",
  "regionId",
  "planId",
  "planVersionId",
  "poolIds",
  "dayTypes",
  "customDayCategories",
  "shiftKeys",
  "slotIds",
  "generationModes",
  "dateRange",
  "weekdays",
  "holidayTypes",
] as const;

const TIE_BREAKERS = [
  "TOTAL_ASSIGNMENT_COUNT_ASC",
  "WEEKEND_COUNT_ASC",
  "SUNDAY_COUNT_ASC",
  "HOLIDAY_COUNT_ASC",
  "LAST_DUTY_DATE_ASC",
  "DAYS_SINCE_LAST_DUTY_DESC",
  "PHARMACY_NAME_TR_ASC",
  "PHARMACY_ID_ASC",
] as const;

export const FAIRNESS_LEAST_LOAD: StrategyCatalogueEntry = {
  strategyType: "FAIRNESS_LEAST_LOAD",
  comparatorVersion: 1,
  parameterSchema: z
    .object({
      includeProjectedLoad: z.boolean(),
      includeAssignmentCount: z.boolean(),
      includeWeekendCount: z.boolean(),
      includeHolidayCount: z.boolean(),
      includeLastDutyDate: z.boolean(),
    })
    .strict(),
  supportedScopeDimensions: SCOPE_DIMENSIONS,
  supportedTieBreakers: TIE_BREAKERS,
  resolveCriterionSequence: (parameters) => {
    const p = parameters as {
      includeProjectedLoad: boolean;
      includeAssignmentCount: boolean;
      includeWeekendCount: boolean;
      includeHolidayCount: boolean;
      includeLastDutyDate: boolean;
    };
    // totalWeightedLoad ascending is the mandatory primary criterion —
    // always applicable, since every candidate always has this fact.
    const sequence: RankingCriterion[] = ["TOTAL_WEIGHTED_LOAD_ASC"];
    if (p.includeProjectedLoad) sequence.push("PROJECTED_LOAD_ASC");
    if (p.includeAssignmentCount) sequence.push("TOTAL_ASSIGNMENT_COUNT_ASC");
    if (p.includeWeekendCount) sequence.push("WEEKEND_COUNT_ASC");
    if (p.includeHolidayCount) sequence.push("HOLIDAY_COUNT_ASC");
    if (p.includeLastDutyDate) sequence.push("LAST_DUTY_DATE_ASC");
    return sequence;
  },
};

const WEIGHTED_FAIRNESS_TIE_BREAKERS = [
  "TOTAL_WEIGHTED_LOAD_ASC",
  "PHARMACY_NAME_TR_ASC",
  "PHARMACY_ID_ASC",
] as const;

const MAX_SOFT_RULE_PENALTY_ENTRIES = 50;

export const WEIGHTED_FAIRNESS: StrategyCatalogueEntry = {
  strategyType: "WEIGHTED_FAIRNESS",
  comparatorVersion: 1,
  parameterSchema: z
    .object({
      weightTotalWeightedLoad: safeWeight,
      weightProjectedLoad: safeWeight,
      weightAssignmentCount: safeWeight,
      weightWeekendCount: safeWeight,
      weightHolidayCount: safeWeight,
      weightDaysSinceLastDuty: safeWeight,
      weightRotationDistance: safeWeight,
      preferDutyBonus: safeWeight,
      softRulePenaltyWeights: z
        .record(z.string().min(1).max(STRATEGY_LIMITS.maxNameLength), safeWeight)
        .refine((record) => Object.keys(record).length <= MAX_SOFT_RULE_PENALTY_ENTRIES, {
          message: "too many soft-rule penalty entries",
        }),
    })
    .strict(),
  supportedScopeDimensions: SCOPE_DIMENSIONS,
  supportedTieBreakers: WEIGHTED_FAIRNESS_TIE_BREAKERS,
  // Always applicable: the weighted score is always computable from
  // bounded, always-present facts (never-served/no-rotation candidates
  // contribute a deterministic sentinel, never a fallback trigger).
  resolveCriterionSequence: () => ["WEIGHTED_SCORE_ASC"],
  computeWeightedScore: (parameters, candidate) => {
    const p = parameters as {
      weightTotalWeightedLoad: number;
      weightProjectedLoad: number;
      weightAssignmentCount: number;
      weightWeekendCount: number;
      weightHolidayCount: number;
      weightDaysSinceLastDuty: number;
      weightRotationDistance: number;
      preferDutyBonus: number;
      softRulePenaltyWeights: Record<string, number>;
    };
    // "Never served" is treated as the maximum bounded wait (a fixed,
    // deterministic sentinel — never a random or clock-derived value)
    // so a positive weightDaysSinceLastDuty still ranks them first.
    const NEVER_SERVED_DAYS_SENTINEL = 100000;
    const daysSinceLastDuty = candidate.daysSinceLastDuty ?? NEVER_SERVED_DAYS_SENTINEL;
    const rotationDistance = candidate.distanceFromCursor ?? 0;

    let softPenalty = 0;
    for (const [ruleType, weight] of Object.entries(p.softRulePenaltyWeights)) {
      softPenalty += weight * (candidate.softFailuresByRuleType[ruleType] ?? 0);
    }

    return (
      p.weightTotalWeightedLoad * candidate.totalWeightedLoad +
      p.weightProjectedLoad * candidate.projectedLoadIfAssigned +
      p.weightAssignmentCount * candidate.totalAssignmentCount +
      p.weightWeekendCount * candidate.weekendCount +
      p.weightHolidayCount * candidate.holidayCount -
      p.weightDaysSinceLastDuty * daysSinceLastDuty +
      p.weightRotationDistance * rotationDistance -
      (candidate.prefersThisDate ? p.preferDutyBonus : 0) +
      softPenalty
    );
  },
};
