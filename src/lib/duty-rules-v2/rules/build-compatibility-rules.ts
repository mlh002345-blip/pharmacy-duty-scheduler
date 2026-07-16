// Duty Rules V2 — Phase 5: deterministic V1-compatibility rule
// projection.
//
// Expresses the existing explicit runtime policy as catalogue rule
// definitions — the SAME semantics the Phase 4 built-in constraints
// enforce, now visible as configuration. Deterministic synthetic ids, no
// timestamps, no randomness. NOT auto-injected anywhere: engine behavior
// with an empty configuredRules array is byte-identical to Phase 4, and
// client-supplied policy never becomes a trusted production source (no
// production caller exists).

import type { EngineSchedulingPolicy } from "../engine/domain/engine-input";
import type { ConfiguredRuleDefinition } from "./domain/rule-definition";

export function buildCompatibilityRules(
  policy: EngineSchedulingPolicy
): ConfiguredRuleDefinition[] {
  const base = {
    enabled: true,
    scope: {},
    validFrom: null,
    validTo: null,
    exceptions: {},
    source: "COMPATIBILITY_V1" as const,
    version: 1,
    metadata: {},
  };

  const rules: ConfiguredRuleDefinition[] = [
    {
      ...base,
      id: "v1-rule:same-slot-duplicate-forbidden",
      ruleType: "SAME_SLOT_DUPLICATE_FORBIDDEN",
      name: "V1 aynı slot tekrarı yasağı",
      severity: "HARD",
      priority: 100,
      parameters: {},
    },
  ];

  // An interval of 0 means "no interval rule" — identical semantics to
  // omitting the definition (the catalogue requires minimumDays >= 1).
  if (policy.minDaysBetweenDuties >= 1) {
    rules.push({
      ...base,
      id: "v1-rule:min-days-between-assignments",
      ruleType: "MIN_DAYS_BETWEEN_ASSIGNMENTS",
      name: "V1 asgari nöbet aralığı",
      severity: "HARD",
      priority: 100,
      parameters: {
        minimumDays: policy.minDaysBetweenDuties,
        relaxable: policy.relaxMinIntervalWhenInsufficient,
        scopeMode: "ALL_ASSIGNMENTS",
      },
    });
  }

  if (!policy.sameDaySecondAssignmentAllowed) {
    rules.push({
      ...base,
      id: "v1-rule:same-day-assignment-limit",
      ruleType: "SAME_DAY_ASSIGNMENT_LIMIT",
      name: "V1 aynı gün ikinci atama yasağı",
      severity: "HARD",
      priority: 100,
      parameters: { maximumAssignments: 1, scopeMode: "ALL_SLOTS" },
    });
  }

  return rules;
}
