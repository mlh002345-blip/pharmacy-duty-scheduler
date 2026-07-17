// Duty Rules V2 — Phase 6, Phase 14: the platform-owned V1 compatibility
// chain. This is a FIXED, platform-defined comparator sequence — not
// chamber-invented — reproducing V1's exact chain
// (generate-duty-schedule.ts:271-299):
//
//   1. totalWeightedLoad ascending
//   2. prefersThisDate descending
//   3. totalAssignmentCount ascending
//   4. weekendCount ascending — ONLY when the date is actually a weekend
//   5. holidayCount ascending — ONLY when the date actually has a holiday
//   6. lastDutyDate ascending, never-served first (V1: `if (!lastDutyDate)
//      return -1`)
//   7. pharmacy name, explicit Turkish locale comparison
//
// Steps 4 and 5 are DATE-CONDITIONAL in V1 (the comparison is skipped
// entirely on non-matching dates, not merely a no-op tie) — the ONLY
// reason this catalogue entry needs matchContext at all. The two
// booleans are DERIVED from matchContext.weekday /
// matchContext.holidayTypes at ranking time, using the calendar's
// UNDERLYING facts (preserved on CalendarDayContext since Phase 4)
// rather than the resolved day-type key — so a HOLIDAY_EVE date is
// correctly evaluated by what it actually IS (e.g. a plain Tuesday),
// achieving exact ORDERING parity with V1 on eve dates. See
// docs/architecture/DUTY_RULES_V2_SELECTION_STRATEGY_ENGINE.md for the
// separate, NOT-yet-solved holiday-eve WEIGHT question (Phase 4's
// dayTypeWeights model has no way to express "this day type's weight
// equals whatever its underlying weekday's weight is").

import { z } from "zod";

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

export const V1_COMPATIBILITY_CHAIN: StrategyCatalogueEntry = {
  strategyType: "V1_COMPATIBILITY_CHAIN",
  comparatorVersion: 1,
  parameterSchema: z.object({}).strict(),
  supportedScopeDimensions: SCOPE_DIMENSIONS,
  supportedTieBreakers: [],
  resolveCriterionSequence: (_parameters, _candidates, matchContext) => {
    const isWeekendDate = matchContext.weekday === "SATURDAY" || matchContext.weekday === "SUNDAY";
    const isHolidayDate = matchContext.holidayTypes.some((type) => type !== "NONE");
    const sequence: RankingCriterion[] = [
      "TOTAL_WEIGHTED_LOAD_ASC",
      "PREFER_REQUESTED_DATE_DESC",
      "TOTAL_ASSIGNMENT_COUNT_ASC",
    ];
    if (isWeekendDate) sequence.push("WEEKEND_COUNT_ASC");
    if (isHolidayDate) sequence.push("HOLIDAY_COUNT_ASC");
    sequence.push("LAST_DUTY_DATE_ASC", "PHARMACY_NAME_TR_ASC");
    return sequence;
  },
};
