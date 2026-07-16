// Duty Rules V2 — Phase 5: deterministic scope matching (AND semantics).
//
// Every PRESENT dimension must match; absent dimensions match all.
// Referencing a dimension whose facts do not exist in the current
// context yields a controlled UNSUPPORTED result — never a silent
// ignore, never a silent pass.

import { dateInWindow } from "../engine/domain/dates";
import type { RuleScope } from "./domain/rule-scope";
import type { RuleEvaluationContext } from "./domain/rule-evaluation";

export type ScopeMatchResult =
  | { kind: "MATCH" }
  | { kind: "NO_MATCH"; dimension: string }
  | { kind: "UNSUPPORTED"; dimension: string };

export function matchRuleScope(
  scope: RuleScope,
  context: RuleEvaluationContext
): ScopeMatchResult {
  // Future dimensions: facts do not exist in this phase.
  if (scope.pharmacyGroupIds !== undefined) {
    return { kind: "UNSUPPORTED", dimension: "pharmacyGroupIds" };
  }
  if (scope.serviceAreaIds !== undefined) {
    return { kind: "UNSUPPORTED", dimension: "serviceAreaIds" };
  }

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
  if (scope.slotIds !== undefined && !scope.slotIds.includes(context.slot.slotId)) {
    return { kind: "NO_MATCH", dimension: "slotIds" };
  }
  if (scope.pharmacyIds !== undefined) {
    if (
      context.candidate === null ||
      !scope.pharmacyIds.includes(context.candidate.pharmacyId)
    ) {
      return { kind: "NO_MATCH", dimension: "pharmacyIds" };
    }
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
  if (
    scope.generationModes !== undefined &&
    !scope.generationModes.includes(context.generationMode)
  ) {
    return { kind: "NO_MATCH", dimension: "generationModes" };
  }

  return { kind: "MATCH" };
}
