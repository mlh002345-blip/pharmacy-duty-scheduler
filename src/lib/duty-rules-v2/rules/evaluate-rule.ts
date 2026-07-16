// Duty Rules V2 — Phase 5: single-rule evaluation with the documented
// applicability precedence:
//
//   1. rule disabled                → NOT_APPLICABLE (NO_EFFECT)
//   2. outside effective period     → NOT_APPLICABLE
//      (includedDates may override this step only)
//   3. scope mismatch               → NOT_APPLICABLE
//      (unsupported scope dimension → UNSUPPORTED_FACT)
//   4. explicit exclusion exception → NOT_APPLICABLE (exceptionMatch set)
//   5. evaluate via the platform catalogue evaluator
//
// The evaluator is ALWAYS platform code resolved from the catalogue by
// ruleType — never anything carried on the definition.

import { getCatalogueEntry } from "./catalogue";
import type { ConfiguredRuleDefinition } from "./domain/rule-definition";
import type { RuleEvaluationContext, RuleEvaluationResult } from "./domain/rule-evaluation";
import { matchRuleEffectivePeriod } from "./match-rule-effective-period";
import { matchRuleExceptions } from "./match-rule-exceptions";
import { matchRuleScope } from "./match-rule-scope";

export function evaluateRule(
  definition: ConfiguredRuleDefinition,
  context: RuleEvaluationContext
): RuleEvaluationResult {
  const entry = getCatalogueEntry(definition.ruleType);
  const base = {
    ruleId: definition.id,
    ruleType: definition.ruleType,
    ruleVersion: definition.version,
    evaluatorVersion: entry?.evaluatorVersion ?? 0,
    severity: definition.severity,
    priority: definition.priority,
    candidateKey: context.candidate?.candidateKey ?? null,
    date: context.date,
    slotKey: context.slot.slotKey,
    relaxable: entry?.relaxable === true && isRelaxableConfigured(definition),
  };

  const notApplicable = (
    explanationCode: string,
    overrides: Partial<RuleEvaluationResult> = {}
  ): RuleEvaluationResult => ({
    ...base,
    applicable: false,
    outcome: "NOT_APPLICABLE",
    passed: true,
    scopeMatch: false,
    effectivePeriodMatch: false,
    exceptionMatch: null,
    observedValue: "",
    expectedValue: "",
    violationCode: null,
    explanationCode,
    decisionEffect: "NO_EFFECT",
    factsUsed: [],
    ...overrides,
  });

  if (!entry) {
    // Unknown types are rejected before evaluation (conflict analysis);
    // reaching here means a caller skipped validation — still controlled.
    return notApplicable("RULE_UNKNOWN_TYPE", {
      outcome: "INVALID_CONFIGURATION",
      decisionEffect: "UNSUPPORTED",
    });
  }

  // 1. Disabled.
  if (!definition.enabled) return notApplicable("RULE_DISABLED");

  // 2. Effective period (includedDates may override).
  const inEffect = matchRuleEffectivePeriod(definition, context.date);
  if (!inEffect) return notApplicable("RULE_OUTSIDE_EFFECTIVE_PERIOD");

  // 3. Scope.
  const scopeResult = matchRuleScope(definition.scope, context);
  if (scopeResult.kind === "UNSUPPORTED") {
    return notApplicable("RULE_UNSUPPORTED_SCOPE_DIMENSION", {
      outcome: "UNSUPPORTED_FACT",
      effectivePeriodMatch: true,
      decisionEffect: "UNSUPPORTED",
      observedValue: scopeResult.dimension,
      expectedValue: "supported scope facts",
    });
  }
  if (scopeResult.kind === "NO_MATCH") {
    return notApplicable("RULE_SCOPE_MISMATCH", {
      effectivePeriodMatch: true,
      observedValue: scopeResult.dimension,
    });
  }

  // Skip candidate-level rules in slot-level contexts and vice versa.
  if (entry.perCandidate !== (context.candidate !== null)) {
    return notApplicable("RULE_CONTEXT_LEVEL_MISMATCH", {
      effectivePeriodMatch: true,
      scopeMatch: true,
    });
  }

  // 4. Explicit exclusion exceptions (win over inclusion overrides).
  const exception = matchRuleExceptions(definition, context);
  if (exception !== null) {
    return notApplicable("RULE_EXCEPTION_MATCHED", {
      effectivePeriodMatch: true,
      scopeMatch: true,
      exceptionMatch: exception,
    });
  }

  // 5. Evaluate. Parameters were validated against the catalogue schema
  // before any evaluation (validate-rule-definition + conflict gate).
  const verdict = entry.evaluate(definition.parameters, context);
  const failed = verdict.outcome === "FAIL";
  return {
    ...base,
    applicable: verdict.outcome === "PASS" || verdict.outcome === "FAIL",
    outcome: verdict.outcome,
    passed: !failed,
    scopeMatch: true,
    effectivePeriodMatch: true,
    exceptionMatch: null,
    observedValue: verdict.observedValue,
    expectedValue: verdict.expectedValue,
    violationCode: failed ? verdict.explanationCode : null,
    explanationCode: verdict.explanationCode,
    decisionEffect: failed
      ? definition.severity === "HARD"
        ? "EXCLUDED"
        : definition.severity === "SOFT"
          ? "PENALIZED"
          : "INFORMATION_ONLY"
      : verdict.outcome === "UNSUPPORTED_FACT"
        ? "UNSUPPORTED"
        : verdict.outcome === "PASS"
          ? "NO_EFFECT"
          : "NO_EFFECT",
    factsUsed: verdict.factsUsed,
  };
}

function isRelaxableConfigured(definition: ConfiguredRuleDefinition): boolean {
  const relaxable = (definition.parameters as { relaxable?: unknown }).relaxable;
  // Rules without a relaxable parameter fall back to the catalogue flag
  // alone; MIN_DAYS_BETWEEN_ASSIGNMENTS requires the explicit opt-in.
  return relaxable === undefined ? true : relaxable === true;
}
