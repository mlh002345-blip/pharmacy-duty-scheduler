// Duty Rules V2 — Phase 5: exception matching.
//
// Returns the FIRST matching exclusion exception kind (deterministic,
// fixed evaluation order) or null. Exceptions can only ever SUPPRESS a
// rule for the current context — they never extend it across tenants or
// alter parameters.

import type { ConfiguredRuleDefinition } from "./domain/rule-definition";
import type { RuleEvaluationContext } from "./domain/rule-evaluation";

export function matchRuleExceptions(
  definition: ConfiguredRuleDefinition,
  context: RuleEvaluationContext
): string | null {
  const exceptions = definition.exceptions;

  if ((exceptions.excludedDates ?? []).includes(context.date)) return "excludedDates";
  if ((exceptions.excludedWeekdays ?? []).includes(context.weekday)) return "excludedWeekdays";
  const excludedHolidayTypes = exceptions.excludedHolidayTypes ?? [];
  if (excludedHolidayTypes.some((type) => context.holidayTypes.includes(type))) {
    return "excludedHolidayTypes";
  }
  if (
    context.candidate !== null &&
    (exceptions.excludedPharmacyIds ?? []).includes(context.candidate.pharmacyId)
  ) {
    return "excludedPharmacyIds";
  }
  if (context.poolId !== null && (exceptions.excludedPoolIds ?? []).includes(context.poolId)) {
    return "excludedPoolIds";
  }
  if ((exceptions.excludedSlotIds ?? []).includes(context.slot.slotId)) return "excludedSlotIds";
  if ((exceptions.excludedGenerationModes ?? []).includes(context.generationMode)) {
    return "excludedGenerationModes";
  }
  return null;
}
