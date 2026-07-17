// Duty Rules V2 — Phase 6: strategy scope and evaluation-context
// contracts. Mirrors Phase 5's rule-scope model deliberately — same AND
// semantics, same dimension set restricted to what Phase 4 facts
// support (no future/unsupported dimensions are added here, per PHASE 4
// instructions: "Do not add unsupported future scope dimensions unless
// needed").

import type { RuleGenerationMode, RuleHolidayType } from "../../rules/domain/rule-scope";
import type { WeekdayName } from "../../engine/domain/dates";

export type StrategyScope = {
  organizationId?: string;
  regionId?: string;
  planId?: string;
  planVersionId?: string;
  poolIds?: string[];
  dayTypes?: string[];
  customDayCategories?: string[];
  shiftKeys?: string[];
  slotIds?: string[];
  generationModes?: RuleGenerationMode[];
  dateRange?: { start: string; end: string };
  weekdays?: WeekdayName[];
  holidayTypes?: RuleHolidayType[];
};

export const STRATEGY_SCOPE_DIMENSIONS = [
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
export type StrategyScopeDimension = (typeof STRATEGY_SCOPE_DIMENSIONS)[number];

/** The plain projection of SelectionInput/Phase-4-context a strategy
 *  scope is matched against — one per slot (not per candidate: scope
 *  never depends on WHICH pharmacy, only on where/when the slot is). */
export type StrategyMatchContext = {
  organizationId: string;
  regionId: string;
  planId: string;
  planVersionId: string;
  generationMode: RuleGenerationMode;
  date: string;
  weekday: WeekdayName;
  holidayTypes: RuleHolidayType[];
  dayType: string;
  customDayCategory: string | null;
  poolId: string | null;
  shiftKey: string;
  slotId: string;
};
