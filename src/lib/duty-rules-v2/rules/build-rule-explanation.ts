// Duty Rules V2 — Phase 5: deterministic explanation payloads.
//
// A plain, code-based explanation for every failed or non-applicable
// rule result. NO Turkish prose is generated here — presentation layers
// translate the stable codes later. Ids and stable codes only; never
// pharmacy/organization names or other tenant content.

import { getCatalogueEntry } from "./catalogue";
import type { ConfiguredRuleDefinition } from "./domain/rule-definition";
import type { RuleEvaluationResult } from "./domain/rule-evaluation";
import { canonicalSerialize } from "../v1-adapter";

export type RuleExplanation = {
  ruleId: string;
  ruleType: string;
  source: ConfiguredRuleDefinition["source"];
  severity: RuleEvaluationResult["severity"];
  candidateKey: string | null;
  date: string;
  slotKey: string;
  /** Canonical JSON of the scope actually configured (ids only). */
  scope: string;
  /** Canonical JSON of the validated parameters (ids/numbers only). */
  parametersUsed: string;
  factsObserved: string[];
  observedValue: string;
  expectedCondition: string;
  relaxable: boolean;
  applicability:
    | "APPLICABLE"
    | "DISABLED"
    | "OUTSIDE_EFFECTIVE_PERIOD"
    | "SCOPE_MISMATCH"
    | "EXCEPTION"
    | "UNSUPPORTED"
    | "CONTEXT_LEVEL_MISMATCH";
  exceptionMatched: string | null;
  explanationCode: string;
  decisionEffect: RuleEvaluationResult["decisionEffect"];
};

const APPLICABILITY_BY_CODE: Record<string, RuleExplanation["applicability"]> = {
  RULE_DISABLED: "DISABLED",
  RULE_OUTSIDE_EFFECTIVE_PERIOD: "OUTSIDE_EFFECTIVE_PERIOD",
  RULE_SCOPE_MISMATCH: "SCOPE_MISMATCH",
  RULE_EXCEPTION_MATCHED: "EXCEPTION",
  RULE_UNSUPPORTED_SCOPE_DIMENSION: "UNSUPPORTED",
  RULE_CONTEXT_LEVEL_MISMATCH: "CONTEXT_LEVEL_MISMATCH",
};

export function buildRuleExplanation(
  definition: ConfiguredRuleDefinition,
  result: RuleEvaluationResult
): RuleExplanation {
  const entry = getCatalogueEntry(definition.ruleType);
  return {
    ruleId: result.ruleId,
    ruleType: result.ruleType,
    source: definition.source,
    severity: result.severity,
    candidateKey: result.candidateKey,
    date: result.date,
    slotKey: result.slotKey,
    scope: canonicalSerialize(definition.scope),
    parametersUsed: canonicalSerialize(definition.parameters),
    factsObserved: result.factsUsed,
    observedValue: result.observedValue,
    expectedCondition: result.expectedValue,
    relaxable: result.relaxable && entry?.relaxable === true,
    applicability: result.applicable
      ? "APPLICABLE"
      : (APPLICABILITY_BY_CODE[result.explanationCode] ??
        (result.outcome === "UNSUPPORTED_FACT" ? "UNSUPPORTED" : "APPLICABLE")),
    exceptionMatched: result.exceptionMatch,
    explanationCode: result.explanationCode,
    decisionEffect: result.decisionEffect,
  };
}

/** Explanations for every result that is not a plain PASS. */
export function buildRuleExplanations(
  definitionsById: ReadonlyMap<string, ConfiguredRuleDefinition>,
  results: RuleEvaluationResult[]
): RuleExplanation[] {
  return results
    .filter((result) => result.outcome !== "PASS")
    .map((result) => {
      const definition = definitionsById.get(result.ruleId);
      if (!definition) {
        throw new Error(`Unknown rule id in results: ${result.ruleId}`);
      }
      return buildRuleExplanation(definition, result);
    });
}
