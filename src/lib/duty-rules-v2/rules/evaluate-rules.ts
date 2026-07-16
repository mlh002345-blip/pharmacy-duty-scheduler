// Duty Rules V2 — Phase 5: rule-set evaluation for one slot.
//
// Applies CUSTOM_DATE_OVERRIDE meta rules for the slot's date (disable /
// severity change of explicitly referenced definitions — never new
// behavior), then evaluates every remaining definition per candidate
// (or once, for slot-level rules), returning canonically ordered
// results.

import type { ConfiguredRuleDefinition } from "./domain/rule-definition";
import type { RuleSeverity } from "./domain/rule-definition";
import {
  sortRuleResults,
  type RuleEvaluationContext,
  type RuleEvaluationResult,
} from "./domain/rule-evaluation";
import { evaluateRule } from "./evaluate-rule";
import { getCatalogueEntry } from "./catalogue";

/** The effective rule set for one date after date overrides. Exported
 *  for tests; deterministic (overrides apply in priority/id order). */
export function applyDateOverrides(
  definitions: ConfiguredRuleDefinition[],
  date: string
): ConfiguredRuleDefinition[] {
  const overrides = definitions
    .filter(
      (definition) =>
        definition.ruleType === "CUSTOM_DATE_OVERRIDE" &&
        definition.enabled &&
        (definition.parameters as { dates: string[] }).dates.includes(date)
    )
    .sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1));

  if (overrides.length === 0) return definitions;

  const effective = new Map(definitions.map((definition) => [definition.id, definition]));
  for (const override of overrides) {
    const parameters = override.parameters as {
      targetRuleIds: string[];
      action: "DISABLE" | "SET_SEVERITY";
      severity?: RuleSeverity;
    };
    for (const targetId of parameters.targetRuleIds) {
      const target = effective.get(targetId);
      if (!target || target.ruleType === "CUSTOM_DATE_OVERRIDE") continue;
      if (parameters.action === "DISABLE") {
        effective.set(targetId, { ...target, enabled: false });
      } else {
        const severity = parameters.severity as RuleSeverity;
        const entry = getCatalogueEntry(target.ruleType);
        // A severity override may only move within the catalogue's
        // allowed severities — otherwise it is ignored deterministically
        // (the conflict analyzer reports it as an ERROR beforehand).
        if (entry && entry.allowedSeverities.includes(severity) && entry.severityConfigurable) {
          effective.set(targetId, { ...target, severity });
        }
      }
    }
  }
  return definitions.map((definition) => effective.get(definition.id) ?? definition);
}

export function evaluateRulesForSlot(input: {
  definitions: ConfiguredRuleDefinition[];
  /** One context per candidate (candidate set), built by the caller. */
  candidateContexts: RuleEvaluationContext[];
  /** The slot-level context (candidate: null). */
  slotContext: RuleEvaluationContext;
}): RuleEvaluationResult[] {
  const effective = applyDateOverrides(input.definitions, input.slotContext.date);
  const results: RuleEvaluationResult[] = [];

  for (const definition of effective) {
    if (definition.ruleType === "CUSTOM_DATE_OVERRIDE") continue; // meta only
    const entry = getCatalogueEntry(definition.ruleType);
    if (entry?.perCandidate === false) {
      results.push(evaluateRule(definition, input.slotContext));
    } else {
      for (const context of input.candidateContexts) {
        results.push(evaluateRule(definition, context));
      }
    }
  }

  return sortRuleResults(results);
}
