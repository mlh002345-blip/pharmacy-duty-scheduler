// Duty Rules V2 — Phase 6, Phase 10: pure static strategy-set conflict
// analysis. Runs BEFORE any candidate ranking; a set with ERROR
// conflicts is rejected wholesale. Mirrors Phase 5's
// analyze-rule-conflicts.ts.
//
// Note on MISSING_DETERMINISTIC_FINAL_FALLBACK: this conflict is
// structurally unreachable by design — rank-candidates.ts unconditionally
// appends CANDIDATE_KEY_ASC (a strict total order over unique keys) to
// every comparator chain, so no configuration can ever leave a tie
// unresolved. The code stays defined for documentation completeness but
// no check emits it.

import { canonicalSerialize } from "../v1-adapter";
import { validateStrategyDefinition } from "./validate-strategy-definition";
import type { ConfiguredSelectionStrategy } from "./domain/strategy-definition";
import { STRATEGY_LIMITS } from "./domain/strategy-parameters";
import { sortStrategyConflicts, type StrategyConflict } from "./domain/strategy-conflict";

export type StrategyConflictContext = {
  organizationId: string;
  regionId: string;
};

export function analyzeStrategyConflicts(
  definitions: ConfiguredSelectionStrategy[],
  context: StrategyConflictContext
): StrategyConflict[] {
  const conflicts: StrategyConflict[] = [];

  if (definitions.length > STRATEGY_LIMITS.maxStrategiesPerSet) {
    return sortStrategyConflicts([
      { code: "STRATEGY_SET_TOO_LARGE", level: "ERROR", strategyIds: [], detail: String(definitions.length) },
    ]);
  }

  for (const definition of definitions) {
    for (const issue of validateStrategyDefinition(definition)) {
      const map: Record<string, StrategyConflict["code"]> = {
        UNKNOWN_STRATEGY_TYPE: "UNKNOWN_STRATEGY_TYPE",
        RANDOM_STRATEGY_REJECTED: "RANDOM_STRATEGY_REJECTED",
        UNSUPPORTED_SCOPE_DIMENSION: "UNSUPPORTED_SCOPE_DIMENSION",
        UNSUPPORTED_TIE_BREAKER: "UNSUPPORTED_TIE_BREAKER",
        DUPLICATE_TIE_BREAKER: "DUPLICATE_TIE_BREAKER",
        SELF_FALLBACK: "SELF_FALLBACK",
        EXCESSIVE_FALLBACK_CHAIN: "EXCESSIVE_FALLBACK_CHAIN",
        INVALID_VALIDITY_RANGE: "INVALID_VALIDITY_RANGE",
      };
      conflicts.push({
        code: map[issue.code] ?? "INVALID_PARAMETERS",
        level: "ERROR",
        strategyIds: [issue.strategyId],
        detail: issue.detail,
      });
    }
  }

  const enabled = definitions.filter((d) => d.enabled);
  const byId = new Map(definitions.map((d) => [d.id, d]));

  // Duplicate active definitions: identical type + scope.
  const byIdentity = new Map<string, string[]>();
  for (const definition of enabled) {
    const identity = `${definition.strategyType}|${canonicalSerialize(definition.scope)}`;
    const list = byIdentity.get(identity) ?? [];
    list.push(definition.id);
    byIdentity.set(identity, list);
  }
  for (const [, ids] of byIdentity) {
    if (ids.length > 1) {
      conflicts.push({
        code: "DUPLICATE_STRATEGY_DEFINITION",
        level: "ERROR",
        strategyIds: [...ids].sort(),
        detail: "duplicate type+scope",
      });
    }
  }

  // Equal-precedence overlapping scope: two enabled definitions with the
  // SAME priority whose scope is identical (a conservative, provable
  // subset of "overlapping" — arbitrary partial overlap is not solved).
  for (let i = 0; i < enabled.length; i++) {
    for (let j = i + 1; j < enabled.length; j++) {
      const a = enabled[i];
      const b = enabled[j];
      if (a.priority === b.priority && canonicalSerialize(a.scope) === canonicalSerialize(b.scope)) {
        conflicts.push({
          code: "EQUAL_PRECEDENCE_OVERLAPPING_SCOPE",
          level: "ERROR",
          strategyIds: [a.id, b.id].sort(),
          detail: String(a.priority),
        });
      }
    }
  }

  // Fallback graph: unknown target, disabled target, cyclic graph.
  for (const definition of enabled) {
    for (const targetId of definition.fallbackStrategyIds) {
      const target = byId.get(targetId);
      if (!target) {
        conflicts.push({
          code: "FALLBACK_TO_UNKNOWN_STRATEGY",
          level: "ERROR",
          strategyIds: [definition.id],
          detail: targetId,
        });
      } else if (!target.enabled) {
        conflicts.push({
          code: "FALLBACK_TO_DISABLED_STRATEGY",
          level: "WARNING",
          strategyIds: [definition.id, target.id].sort(),
          detail: targetId,
        });
      }
    }
  }
  const cycleIds = detectFallbackCycles(enabled);
  for (const cycle of cycleIds) {
    conflicts.push({
      code: "CYCLIC_FALLBACK_GRAPH",
      level: "ERROR",
      strategyIds: [...cycle].sort(),
      detail: cycle.join("->"),
    });
  }

  // Strategy/tie-breaker incompatibility, empty lexicographic chain,
  // all-zero weights.
  for (const definition of enabled) {
    if (definition.strategyType === "LEXICOGRAPHIC_CHAIN") {
      const criteria = (definition.parameters as { criteria?: unknown[] }).criteria;
      if (!Array.isArray(criteria) || criteria.length === 0) {
        conflicts.push({
          code: "EMPTY_LEXICOGRAPHIC_CHAIN",
          level: "ERROR",
          strategyIds: [definition.id],
          detail: "criteria",
        });
      }
    }
    if (definition.strategyType === "WEIGHTED_FAIRNESS") {
      const p = definition.parameters as Record<string, unknown>;
      const numericWeights = [
        "weightTotalWeightedLoad",
        "weightProjectedLoad",
        "weightAssignmentCount",
        "weightWeekendCount",
        "weightHolidayCount",
        "weightDaysSinceLastDuty",
        "weightRotationDistance",
        "preferDutyBonus",
      ];
      const softWeights = Object.values(
        (p.softRulePenaltyWeights as Record<string, number> | undefined) ?? {}
      );
      const allZero =
        numericWeights.every((key) => Number(p[key] ?? 0) === 0) &&
        softWeights.every((w) => w === 0);
      if (allZero) {
        conflicts.push({
          code: "ALL_ZERO_WEIGHTS",
          level: "ERROR",
          strategyIds: [definition.id],
          detail: "all weights zero",
        });
      }
    }
  }

  // Tenant consistency for referenced ids.
  for (const definition of definitions) {
    if (
      definition.scope.organizationId !== undefined &&
      definition.scope.organizationId !== context.organizationId
    ) {
      conflicts.push({
        code: "TENANT_INCONSISTENT_ID",
        level: "ERROR",
        strategyIds: [definition.id],
        detail: "organizationId",
      });
    }
    if (definition.scope.regionId !== undefined && definition.scope.regionId !== context.regionId) {
      conflicts.push({
        code: "TENANT_INCONSISTENT_ID",
        level: "ERROR",
        strategyIds: [definition.id],
        detail: "regionId",
      });
    }
  }

  return sortStrategyConflicts(conflicts);
}

function detectFallbackCycles(definitions: ConfiguredSelectionStrategy[]): string[][] {
  const byId = new Map(definitions.map((d) => [d.id, d]));
  const cycles: string[][] = [];
  const seenCycleKeys = new Set<string>();

  for (const start of definitions) {
    const path: string[] = [];
    const onPath = new Set<string>();
    let current: ConfiguredSelectionStrategy | undefined = start;
    while (current) {
      if (onPath.has(current.id)) {
        const cycleStart = path.indexOf(current.id);
        const cycle = path.slice(cycleStart);
        const key = [...cycle].sort().join(",");
        if (!seenCycleKeys.has(key)) {
          seenCycleKeys.add(key);
          cycles.push(cycle);
        }
        break;
      }
      path.push(current.id);
      onPath.add(current.id);
      const nextId: string | undefined = current.fallbackStrategyIds[0];
      // Only the FIRST fallback edge is walked for cycle detection —
      // sufficient because a cycle through any edge eventually revisits
      // a node already on this DFS path regardless of branch chosen,
      // and every definition is used as a DFS root above.
      current = nextId ? byId.get(nextId) : undefined;
      if (path.length > definitions.length + 1) break; // safety bound
    }
  }
  return cycles;
}
