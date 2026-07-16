// Duty Rules V2 — Phase 5: rule scope and exception contracts.
//
// Scope is a set of ADDITIVE dimensions combined with AND semantics: a
// rule applies only where EVERY present dimension matches. Absent
// dimensions match everything. Dimensions whose facts do not exist yet
// in the evaluation context (pharmacy groups, service areas) are stable
// contract fields TODAY; referencing them yields a controlled
// UNSUPPORTED_SCOPE_DIMENSION outcome — never a silent pass or ignore.

import type { WeekdayName } from "../../engine/domain/dates";

export type RuleHolidayType = "OFFICIAL" | "RELIGIOUS" | "OTHER" | "NONE";
export type RuleGenerationMode = "PREVIEW" | "SIMULATION";

export type RuleScope = {
  organizationId?: string;
  regionId?: string;
  planId?: string;
  planVersionId?: string;
  poolIds?: string[];
  dayTypes?: string[];
  customDayCategories?: string[];
  shiftKeys?: string[];
  slotIds?: string[];
  pharmacyIds?: string[];
  /** Future dimensions — no persistence/facts exist yet; referencing
   *  them is UNSUPPORTED_SCOPE_DIMENSION until the facts arrive. */
  pharmacyGroupIds?: string[];
  serviceAreaIds?: string[];
  dateRange?: { start: string; end: string };
  weekdays?: WeekdayName[];
  holidayTypes?: RuleHolidayType[];
  generationModes?: RuleGenerationMode[];
};

export const SCOPE_DIMENSIONS = [
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
  "pharmacyGroupIds",
  "serviceAreaIds",
  "dateRange",
  "weekdays",
  "holidayTypes",
  "generationModes",
] as const;
export type ScopeDimension = (typeof SCOPE_DIMENSIONS)[number];

/** Dimensions with no evaluation-context facts in this phase. */
export const UNSUPPORTED_SCOPE_DIMENSIONS: readonly ScopeDimension[] = [
  "pharmacyGroupIds",
  "serviceAreaIds",
];

export type RuleExceptions = {
  /** Dates on which the rule is explicitly NOT applied. */
  excludedDates?: string[];
  /** Dates on which the rule applies even OUTSIDE validFrom/validTo.
   *  Exclusions still win over inclusions (documented precedence). */
  includedDates?: string[];
  excludedWeekdays?: WeekdayName[];
  excludedHolidayTypes?: RuleHolidayType[];
  excludedPharmacyIds?: string[];
  excludedPoolIds?: string[];
  excludedSlotIds?: string[];
  excludedGenerationModes?: RuleGenerationMode[];
};

export const EXCEPTION_KINDS = [
  "excludedDates",
  "includedDates",
  "excludedWeekdays",
  "excludedHolidayTypes",
  "excludedPharmacyIds",
  "excludedPoolIds",
  "excludedSlotIds",
  "excludedGenerationModes",
] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];
