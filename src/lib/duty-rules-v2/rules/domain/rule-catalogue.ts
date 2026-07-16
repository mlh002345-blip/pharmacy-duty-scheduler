// Duty Rules V2 — Phase 5: the platform-controlled catalogue contract.
//
// The PLATFORM defines every entry: its stable code, strict parameter
// schema, allowed severities/scopes/exceptions, deterministic evaluator
// (platform code — never chamber-supplied), relaxation capability, and
// explanation codes. Chambers can only SELECT and PARAMETERIZE entries.

import type { z } from "zod";

import type { RuleSeverity } from "./rule-definition";
import type { ExceptionKind, ScopeDimension } from "./rule-scope";
import type { RuleEvaluationContext } from "./rule-evaluation";

export type RuleParticipation = "ELIGIBILITY" | "SCORING" | "QUOTA" | "DIAGNOSTICS";

/** What the platform evaluator returns; the surrounding engine adds the
 *  definition/severity/applicability envelope. */
export type EvaluatorVerdict = {
  outcome: "PASS" | "FAIL" | "NOT_APPLICABLE" | "UNSUPPORTED_FACT";
  observedValue: string;
  expectedValue: string;
  explanationCode: string;
  factsUsed: string[];
};

export type RuleCatalogueEntry = {
  ruleType: string;
  /** Bumped whenever evaluator BEHAVIOR changes; part of the rule-set
   *  fingerprint so provenance reflects behavior, not just config. */
  evaluatorVersion: number;
  allowedSeverities: readonly RuleSeverity[];
  /** May the chamber choose among allowedSeverities? When false the
   *  single allowed severity is mandatory. */
  severityConfigurable: boolean;
  parameterSchema: z.ZodTypeAny;
  supportedScopeDimensions: readonly ScopeDimension[];
  supportedExceptionKinds: readonly ExceptionKind[];
  /** Stable fact keys the evaluator needs (documentation + validation). */
  requiredFacts: readonly string[];
  participatesIn: readonly RuleParticipation[];
  /** Candidate-level rules run once per candidate; slot-level once per
   *  slot with context.candidate === null. */
  perCandidate: boolean;
  /** Only catalogue-declared relaxable rules may EVER relax, and only
   *  via the declared mode. */
  relaxable: boolean;
  relaxationMode: "V1_MIN_INTERVAL" | null;
  evaluate: (parameters: unknown, context: RuleEvaluationContext) => EvaluatorVerdict;
};
