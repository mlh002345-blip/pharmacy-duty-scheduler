// Duty Rules V2 — Phase 5: the configured rule definition contract.
//
// A ConfiguredRuleDefinition is what a CHAMBER configures: which
// platform-catalogue rule is enabled, with what severity, priority,
// scope, parameters, validity, and exceptions. It is a PLAIN,
// serializable, strictly-validated value — it can never carry
// executable content (no callbacks, code strings, SQL, expressions,
// regex, dynamic module paths; metadata is limited to short display
// strings that never participate in evaluation).

import type { RuleScope } from "./rule-scope";
import type { RuleExceptions } from "./rule-scope";

export const RULE_SEVERITIES = ["HARD", "SOFT", "ADVISORY"] as const;
export type RuleSeverity = (typeof RULE_SEVERITIES)[number];

export const RULE_SOURCES = [
  "PLATFORM_DEFAULT",
  "ORGANIZATION_CONFIGURED",
  "REGION_CONFIGURED",
  "PLAN_VERSION_CONFIGURED",
  "COMPATIBILITY_V1",
] as const;
export type RuleSource = (typeof RULE_SOURCES)[number];

export type ConfiguredRuleDefinition = {
  id: string;
  ruleType: string;
  name: string;
  enabled: boolean;
  severity: RuleSeverity;
  /** Lower number = evaluated/reported earlier. Ties are ordered by
   *  ruleType, then id — always deterministic. */
  priority: number;
  scope: RuleScope;
  parameters: Record<string, unknown>;
  /** Inclusive calendar date or null (no lower/upper bound). */
  validFrom: string | null;
  validTo: string | null;
  exceptions: RuleExceptions;
  source: RuleSource;
  /** The chamber-visible configuration version of THIS definition. */
  version: number;
  /** Display-only, non-executable, excluded from the fingerprint. */
  metadata: { description?: string };
};
