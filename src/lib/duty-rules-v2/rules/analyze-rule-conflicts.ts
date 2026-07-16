// Duty Rules V2 — Phase 5: pure static rule-set conflict analysis.
//
// Runs BEFORE any evaluation; a rule set with ERROR conflicts is
// rejected wholesale. Deliberately conservative: provable contradictions
// only, no NP-hard exhaustive combination solving.

import { canonicalSerialize } from "../v1-adapter";
import type { ConfiguredRuleDefinition } from "./domain/rule-definition";
import { RULE_LIMITS } from "./domain/rule-parameters";
import { sortConflicts, type RuleConflict } from "./domain/rule-conflict";
import { validateRuleDefinition } from "./validate-rule-definition";

export type ConflictAnalysisContext = {
  organizationId: string;
  regionId: string;
  /** Known tenant-owned ids, for TENANT_INCONSISTENT_ID checks. */
  knownPharmacyIds: ReadonlySet<string>;
  knownPoolIds: ReadonlySet<string>;
};

export function analyzeRuleConflicts(
  definitions: ConfiguredRuleDefinition[],
  context: ConflictAnalysisContext
): RuleConflict[] {
  const conflicts: RuleConflict[] = [];

  if (definitions.length > RULE_LIMITS.maxRulesPerSet) {
    return sortConflicts([
      { code: "RULE_SET_TOO_LARGE", level: "ERROR", ruleIds: [], detail: String(definitions.length) },
    ]);
  }

  // Per-definition validation (unknown type, parameters, severity,
  // scope/exception support, validity ranges).
  for (const definition of definitions) {
    for (const issue of validateRuleDefinition(definition)) {
      const map: Record<string, RuleConflict["code"]> = {
        UNKNOWN_RULE_TYPE: "UNKNOWN_RULE_TYPE",
        UNSUPPORTED_SEVERITY: "UNSUPPORTED_SEVERITY",
        SEVERITY_NOT_CONFIGURABLE: "UNSUPPORTED_SEVERITY",
        UNSUPPORTED_SCOPE_DIMENSION: "UNSUPPORTED_SCOPE_DIMENSION",
        UNSUPPORTED_EXCEPTION_KIND: "UNSUPPORTED_EXCEPTION_KIND",
        INVALID_VALIDITY_RANGE: "INVALID_VALIDITY_RANGE",
      };
      const code = map[issue.code] ?? "INVALID_PARAMETERS";
      conflicts.push({
        code,
        // Future-fact scope dimensions are configuration-visible warnings
        // (evaluation yields UNSUPPORTED_FACT); everything else blocks.
        level: issue.code === "UNSUPPORTED_FUTURE_SCOPE_DIMENSION" ? "WARNING" : "ERROR",
        ruleIds: [issue.ruleId],
        detail: issue.detail,
      });
    }
  }

  const enabled = definitions.filter((d) => d.enabled);

  // Duplicate active definitions: same type + same scope + overlapping
  // validity.
  const byIdentity = new Map<string, string[]>();
  for (const definition of enabled) {
    const identity = `${definition.ruleType}|${canonicalSerialize(definition.scope)}`;
    const list = byIdentity.get(identity) ?? [];
    list.push(definition.id);
    byIdentity.set(identity, list);
  }
  for (const [identity, ids] of byIdentity) {
    if (ids.length > 1) {
      conflicts.push({
        code: "DUPLICATE_RULE_DEFINITION",
        level: "ERROR",
        ruleIds: [...ids].sort(),
        detail: identity.split("|")[0],
      });
    }
  }

  // Include/exclude pharmacy contradictions and impossible sets.
  const includeRules = enabled.filter((d) => d.ruleType === "INCLUDE_ONLY_PHARMACIES");
  const excludeRules = enabled.filter((d) => d.ruleType === "EXCLUDE_PHARMACY");
  for (const includeRule of includeRules) {
    const included = new Set(
      ((includeRule.parameters as { pharmacyIds?: string[] }).pharmacyIds ?? [])
    );
    for (const excludeRule of excludeRules) {
      const excluded = (excludeRule.parameters as { pharmacyIds?: string[] }).pharmacyIds ?? [];
      const overlap = excluded.filter((id) => included.has(id));
      if (overlap.length > 0 && overlap.length < included.size) {
        conflicts.push({
          code: "INCLUDE_EXCLUDE_CONTRADICTION",
          level: "WARNING",
          ruleIds: [includeRule.id, excludeRule.id].sort(),
          detail: String(overlap.length),
        });
      }
      if (overlap.length === included.size && included.size > 0) {
        // Every allowed pharmacy is also excluded: provably impossible.
        conflicts.push({
          code: "IMPOSSIBLE_PHARMACY_SET",
          level: "ERROR",
          ruleIds: [includeRule.id, excludeRule.id].sort(),
          detail: String(included.size),
        });
      }
    }
  }

  // Quota / min-max contradictions inside single definitions.
  for (const definition of enabled) {
    if (definition.ruleType !== "POOL_QUOTA") continue;
    const { requiredCount, maximumCount } = definition.parameters as {
      requiredCount?: number;
      maximumCount?: number;
    };
    if (requiredCount !== undefined && maximumCount !== undefined && requiredCount > maximumCount) {
      conflicts.push({
        code: "IMPOSSIBLE_QUOTA",
        level: "ERROR",
        ruleIds: [definition.id],
        detail: `${requiredCount}>${maximumCount}`,
      });
    }
  }

  // Validity fully excluded by explicit date exceptions (provable only
  // for bounded periods small enough to enumerate).
  for (const definition of enabled) {
    if (definition.validFrom === null || definition.validTo === null) continue;
    const excluded = new Set(definition.exceptions.excludedDates ?? []);
    if (excluded.size === 0) continue;
    const from = new Date(`${definition.validFrom}T00:00:00.000Z`).getTime();
    const to = new Date(`${definition.validTo}T00:00:00.000Z`).getTime();
    const days = Math.round((to - from) / 86400000) + 1;
    if (days > 0 && days <= RULE_LIMITS.maxExplicitDates && excluded.size >= days) {
      let fullyExcluded = true;
      for (let index = 0; index < days; index++) {
        const date = new Date(from + index * 86400000).toISOString().slice(0, 10);
        if (!excluded.has(date)) {
          fullyExcluded = false;
          break;
        }
      }
      if (fullyExcluded) {
        conflicts.push({
          code: "VALIDITY_FULLY_EXCLUDED",
          level: "ERROR",
          ruleIds: [definition.id],
          detail: `${definition.validFrom}..${definition.validTo}`,
        });
      }
    }
    // Exceptions entirely outside validity: configuration mistake (INFO).
    for (const date of definition.exceptions.excludedDates ?? []) {
      if (date < definition.validFrom || date > definition.validTo) {
        conflicts.push({
          code: "EXCEPTION_OUTSIDE_VALIDITY",
          level: "INFO",
          ruleIds: [definition.id],
          detail: date,
        });
      }
    }
  }

  // Equal-priority HARD include/exclude contradictions (incompatible
  // HARD outcomes at the same precedence).
  for (const includeRule of includeRules) {
    for (const excludeRule of excludeRules) {
      if (
        includeRule.severity === "HARD" &&
        excludeRule.severity === "HARD" &&
        includeRule.priority === excludeRule.priority
      ) {
        const included = (includeRule.parameters as { pharmacyIds?: string[] }).pharmacyIds ?? [];
        const excluded = new Set(
          (excludeRule.parameters as { pharmacyIds?: string[] }).pharmacyIds ?? []
        );
        if (included.some((id) => excluded.has(id))) {
          conflicts.push({
            code: "EQUAL_PRIORITY_HARD_CONTRADICTION",
            level: "WARNING",
            ruleIds: [excludeRule.id, includeRule.id].sort(),
            detail: String(includeRule.priority),
          });
        }
      }
    }
  }

  // Overlapping CUSTOM_DATE_OVERRIDE rules with equal priority touching
  // the same target on the same date.
  const overrides = enabled.filter((d) => d.ruleType === "CUSTOM_DATE_OVERRIDE");
  for (let i = 0; i < overrides.length; i++) {
    for (let j = i + 1; j < overrides.length; j++) {
      const a = overrides[i];
      const b = overrides[j];
      if (a.priority !== b.priority) continue;
      const parametersA = a.parameters as { targetRuleIds: string[]; dates: string[] };
      const parametersB = b.parameters as { targetRuleIds: string[]; dates: string[] };
      const sharedTarget = parametersA.targetRuleIds.some((id) =>
        parametersB.targetRuleIds.includes(id)
      );
      const sharedDate = parametersA.dates.some((date) => parametersB.dates.includes(date));
      if (sharedTarget && sharedDate) {
        conflicts.push({
          code: "OVERLAPPING_EQUAL_PRECEDENCE_OVERRIDE",
          level: "ERROR",
          ruleIds: [a.id, b.id].sort(),
          detail: String(a.priority),
        });
      }
    }
  }

  // Tenant consistency: ids referenced in scope/exceptions/parameters
  // must belong to the plan's universe where known.
  for (const definition of definitions) {
    const referencedPharmacies = [
      ...(definition.scope.pharmacyIds ?? []),
      ...(definition.exceptions.excludedPharmacyIds ?? []),
      ...((definition.parameters as { pharmacyIds?: string[] }).pharmacyIds ?? []),
    ];
    for (const pharmacyId of referencedPharmacies) {
      if (!context.knownPharmacyIds.has(pharmacyId)) {
        conflicts.push({
          code: "TENANT_INCONSISTENT_ID",
          level: "ERROR",
          ruleIds: [definition.id],
          detail: `pharmacy:${pharmacyId}`,
        });
      }
    }
    const referencedPools = [
      ...(definition.scope.poolIds ?? []),
      ...(definition.exceptions.excludedPoolIds ?? []),
    ];
    for (const poolId of referencedPools) {
      if (!context.knownPoolIds.has(poolId)) {
        conflicts.push({
          code: "TENANT_INCONSISTENT_ID",
          level: "ERROR",
          ruleIds: [definition.id],
          detail: `pool:${poolId}`,
        });
      }
    }
    if (
      definition.scope.organizationId !== undefined &&
      definition.scope.organizationId !== context.organizationId
    ) {
      conflicts.push({
        code: "TENANT_INCONSISTENT_ID",
        level: "ERROR",
        ruleIds: [definition.id],
        detail: "organizationId",
      });
    }
    if (definition.scope.regionId !== undefined && definition.scope.regionId !== context.regionId) {
      conflicts.push({
        code: "TENANT_INCONSISTENT_ID",
        level: "ERROR",
        ruleIds: [definition.id],
        detail: "regionId",
      });
    }
  }

  return sortConflicts(conflicts);
}
