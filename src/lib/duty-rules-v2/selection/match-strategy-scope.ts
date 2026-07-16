// Duty Rules V2 — Phase 6: deterministic strategy scope matching (AND
// semantics, mirrors Phase 5's match-rule-scope.ts). Strategy scope is
// evaluated once per SLOT (never per candidate — which pharmacy exists
// has no bearing on whether a strategy applies to this slot).

import { dateInWindow } from "../engine/domain/dates";
import type { StrategyScope, StrategyMatchContext } from "./domain/strategy-context";

export type StrategyScopeMatchResult =
  | { kind: "MATCH" }
  | { kind: "NO_MATCH"; dimension: string };

export function matchStrategyScope(
  scope: StrategyScope,
  context: StrategyMatchContext
): StrategyScopeMatchResult {
  if (scope.organizationId !== undefined && scope.organizationId !== context.organizationId) {
    return { kind: "NO_MATCH", dimension: "organizationId" };
  }
  if (scope.regionId !== undefined && scope.regionId !== context.regionId) {
    return { kind: "NO_MATCH", dimension: "regionId" };
  }
  if (scope.planId !== undefined && scope.planId !== context.planId) {
    return { kind: "NO_MATCH", dimension: "planId" };
  }
  if (scope.planVersionId !== undefined && scope.planVersionId !== context.planVersionId) {
    return { kind: "NO_MATCH", dimension: "planVersionId" };
  }
  if (scope.poolIds !== undefined) {
    if (context.poolId === null || !scope.poolIds.includes(context.poolId)) {
      return { kind: "NO_MATCH", dimension: "poolIds" };
    }
  }
  if (scope.dayTypes !== undefined && !scope.dayTypes.includes(context.dayType)) {
    return { kind: "NO_MATCH", dimension: "dayTypes" };
  }
  if (scope.customDayCategories !== undefined) {
    if (
      context.customDayCategory === null ||
      !scope.customDayCategories.includes(context.customDayCategory)
    ) {
      return { kind: "NO_MATCH", dimension: "customDayCategories" };
    }
  }
  if (scope.shiftKeys !== undefined && !scope.shiftKeys.includes(context.shiftKey)) {
    return { kind: "NO_MATCH", dimension: "shiftKeys" };
  }
  if (scope.slotIds !== undefined && !scope.slotIds.includes(context.slotId)) {
    return { kind: "NO_MATCH", dimension: "slotIds" };
  }
  if (
    scope.generationModes !== undefined &&
    !scope.generationModes.includes(context.generationMode)
  ) {
    return { kind: "NO_MATCH", dimension: "generationModes" };
  }
  if (scope.dateRange !== undefined) {
    if (!dateInWindow(context.date, scope.dateRange.start, scope.dateRange.end)) {
      return { kind: "NO_MATCH", dimension: "dateRange" };
    }
  }
  if (scope.weekdays !== undefined && !scope.weekdays.includes(context.weekday)) {
    return { kind: "NO_MATCH", dimension: "weekdays" };
  }
  if (scope.holidayTypes !== undefined) {
    const matches = scope.holidayTypes.some((type) => context.holidayTypes.includes(type));
    if (!matches) return { kind: "NO_MATCH", dimension: "holidayTypes" };
  }
  return { kind: "MATCH" };
}

/** validFrom/validTo inclusive, null = unbounded — same convention as
 *  Phase 5's rule effective-period matching (no includedDates override
 *  exists here; strategies don't have exceptions, only scope+validity). */
export function matchStrategyEffectivePeriod(
  validFrom: string | null,
  validTo: string | null,
  date: string
): boolean {
  return (validFrom === null || date >= validFrom) && (validTo === null || date <= validTo);
}
