// Duty Rules V2 — Phase 5: rule-set canonicalization and fingerprint.
//
// The fingerprint reflects BEHAVIOR: enabled state, severity, priority,
// scope, parameters, validity, exceptions, definition version, and the
// catalogue evaluator version. It ignores display-only metadata, object
// key order, and the order of set-like arrays. Same behavior in, same
// bytes out.

import { createHash } from "node:crypto";

import { canonicalSerialize } from "../v1-adapter";
import { getCatalogueEntry } from "./catalogue";
import type { ConfiguredRuleDefinition } from "./domain/rule-definition";
import type { RuleExceptions, RuleScope } from "./domain/rule-scope";

/** Display-only fields (name, metadata) are excluded: they never affect
 *  behavior, so they never affect the fingerprint. */
type CanonicalRule = Omit<ConfiguredRuleDefinition, "metadata" | "name"> & {
  evaluatorVersion: number;
};

function sortedArray<T extends string | number>(values: T[] | undefined): T[] | undefined {
  return values === undefined ? undefined : [...values].sort();
}

function canonicalScope(scope: RuleScope): RuleScope {
  return {
    ...scope,
    poolIds: sortedArray(scope.poolIds),
    dayTypes: sortedArray(scope.dayTypes),
    customDayCategories: sortedArray(scope.customDayCategories),
    shiftKeys: sortedArray(scope.shiftKeys),
    slotIds: sortedArray(scope.slotIds),
    pharmacyIds: sortedArray(scope.pharmacyIds),
    pharmacyGroupIds: sortedArray(scope.pharmacyGroupIds),
    serviceAreaIds: sortedArray(scope.serviceAreaIds),
    weekdays: sortedArray(scope.weekdays),
    holidayTypes: sortedArray(scope.holidayTypes),
    generationModes: sortedArray(scope.generationModes),
  };
}

function canonicalExceptions(exceptions: RuleExceptions): RuleExceptions {
  return {
    excludedDates: sortedArray(exceptions.excludedDates),
    includedDates: sortedArray(exceptions.includedDates),
    excludedWeekdays: sortedArray(exceptions.excludedWeekdays),
    excludedHolidayTypes: sortedArray(exceptions.excludedHolidayTypes),
    excludedPharmacyIds: sortedArray(exceptions.excludedPharmacyIds),
    excludedPoolIds: sortedArray(exceptions.excludedPoolIds),
    excludedSlotIds: sortedArray(exceptions.excludedSlotIds),
    excludedGenerationModes: sortedArray(exceptions.excludedGenerationModes),
  };
}

/** Set-like id arrays inside parameters are order-insensitive. */
function canonicalParameters(parameters: Record<string, unknown>): Record<string, unknown> {
  const canonical: Record<string, unknown> = { ...parameters };
  for (const key of ["pharmacyIds", "targetRuleIds", "dates", "tagValues", "groupIds"]) {
    const value = canonical[key];
    if (Array.isArray(value)) canonical[key] = [...value].sort();
  }
  return canonical;
}

export function canonicalizeRuleSet(
  definitions: ConfiguredRuleDefinition[]
): CanonicalRule[] {
  const canonical = definitions.map((definition) => ({
    id: definition.id,
    ruleType: definition.ruleType,
    enabled: definition.enabled,
    severity: definition.severity,
    priority: definition.priority,
    scope: canonicalScope(definition.scope),
    parameters: canonicalParameters(definition.parameters),
    validFrom: definition.validFrom,
    validTo: definition.validTo,
    exceptions: canonicalExceptions(definition.exceptions),
    source: definition.source,
    version: definition.version,
    evaluatorVersion: getCatalogueEntry(definition.ruleType)?.evaluatorVersion ?? 0,
  }));

  canonical.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.ruleType !== b.ruleType) return a.ruleType < b.ruleType ? -1 : 1;
    const scopeA = canonicalSerialize(a.scope);
    const scopeB = canonicalSerialize(b.scope);
    if (scopeA !== scopeB) return scopeA < scopeB ? -1 : 1;
    const fromA = a.validFrom ?? "";
    const fromB = b.validFrom ?? "";
    if (fromA !== fromB) return fromA < fromB ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return canonical;
}

export function ruleSetFingerprint(definitions: ConfiguredRuleDefinition[]): string {
  return createHash("sha256")
    .update(canonicalSerialize(canonicalizeRuleSet(definitions)))
    .digest("hex");
}
