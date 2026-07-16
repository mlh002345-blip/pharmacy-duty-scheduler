// Duty Rules V2 — Phase 5: rule conflict contract.

export const CONFLICT_LEVELS = ["ERROR", "WARNING", "INFO"] as const;
export type ConflictLevel = (typeof CONFLICT_LEVELS)[number];

export type RuleConflictCode =
  | "UNKNOWN_RULE_TYPE"
  | "INVALID_PARAMETERS"
  | "UNSUPPORTED_SEVERITY"
  | "UNSUPPORTED_SCOPE_DIMENSION"
  | "UNSUPPORTED_EXCEPTION_KIND"
  | "DUPLICATE_RULE_DEFINITION"
  | "INCLUDE_EXCLUDE_CONTRADICTION"
  | "IMPOSSIBLE_PHARMACY_SET"
  | "MIN_GREATER_THAN_MAX"
  | "IMPOSSIBLE_QUOTA"
  | "VALIDITY_FULLY_EXCLUDED"
  | "EXCEPTION_OUTSIDE_VALIDITY"
  | "EQUAL_PRIORITY_HARD_CONTRADICTION"
  | "OVERLAPPING_EQUAL_PRECEDENCE_OVERRIDE"
  | "TENANT_INCONSISTENT_ID"
  | "INVALID_VALIDITY_RANGE"
  | "RULE_SET_TOO_LARGE";

export type RuleConflict = {
  code: RuleConflictCode;
  level: ConflictLevel;
  /** The offending definitions, ids only, sorted. */
  ruleIds: string[];
  /** Stable detail key (a dimension name, a date, a parameter) — never
   *  tenant content. */
  detail: string;
};

/** Canonical ordering: level (ERROR < WARNING < INFO), code, ruleIds. */
export function sortConflicts(conflicts: RuleConflict[]): RuleConflict[] {
  const levelRank = { ERROR: 0, WARNING: 1, INFO: 2 } as const;
  return [...conflicts].sort((a, b) => {
    if (a.level !== b.level) return levelRank[a.level] - levelRank[b.level];
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    const ka = a.ruleIds.join(",");
    const kb = b.ruleIds.join(",");
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.detail < b.detail ? -1 : a.detail > b.detail ? 1 : 0;
  });
}
