// Duty Rules V2 — Phase 5: effective-period matching.
//
// validFrom and validTo are both INCLUSIVE calendar dates; null means
// unbounded on that side. exceptions.includedDates may pull a date INTO
// applicability even outside the validity window (the documented
// inclusion override) — but explicit exclusions, evaluated later in the
// precedence chain, still win over inclusions.

import type { ConfiguredRuleDefinition } from "./domain/rule-definition";

export function matchRuleEffectivePeriod(
  definition: ConfiguredRuleDefinition,
  date: string
): boolean {
  const inPeriod =
    (definition.validFrom === null || date >= definition.validFrom) &&
    (definition.validTo === null || date <= definition.validTo);
  if (inPeriod) return true;
  return (definition.exceptions.includedDates ?? []).includes(date);
}
