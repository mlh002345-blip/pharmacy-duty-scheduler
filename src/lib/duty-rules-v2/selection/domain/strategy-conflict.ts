// Duty Rules V2 — Phase 6: strategy conflict contract (mirrors Phase 5's
// rule-conflict.ts).

export const STRATEGY_CONFLICT_LEVELS = ["ERROR", "WARNING", "INFO"] as const;
export type StrategyConflictLevel = (typeof STRATEGY_CONFLICT_LEVELS)[number];

export type StrategyConflictCode =
  | "UNKNOWN_STRATEGY_TYPE"
  | "INVALID_PARAMETERS"
  | "UNSUPPORTED_SCOPE_DIMENSION"
  | "DUPLICATE_STRATEGY_DEFINITION"
  | "EQUAL_PRECEDENCE_OVERLAPPING_SCOPE"
  | "DUPLICATE_TIE_BREAKER"
  | "UNSUPPORTED_TIE_BREAKER"
  | "MISSING_FINAL_FALLBACK_UNREACHABLE"
  | "CYCLIC_FALLBACK_GRAPH"
  | "FALLBACK_TO_UNKNOWN_STRATEGY"
  | "FALLBACK_TO_DISABLED_STRATEGY"
  | "SELF_FALLBACK"
  | "EXCESSIVE_FALLBACK_CHAIN"
  | "INCOMPATIBLE_STRATEGY_TIE_BREAKER"
  | "EMPTY_LEXICOGRAPHIC_CHAIN"
  | "ALL_ZERO_WEIGHTS"
  | "VALIDITY_FULLY_EXCLUDED"
  | "TENANT_INCONSISTENT_ID"
  | "RANDOM_STRATEGY_REJECTED"
  | "STRATEGY_SET_TOO_LARGE"
  | "INVALID_VALIDITY_RANGE";

export type StrategyConflict = {
  code: StrategyConflictCode;
  level: StrategyConflictLevel;
  strategyIds: string[];
  detail: string;
};

export function sortStrategyConflicts(conflicts: StrategyConflict[]): StrategyConflict[] {
  const levelRank = { ERROR: 0, WARNING: 1, INFO: 2 } as const;
  return [...conflicts].sort((a, b) => {
    if (a.level !== b.level) return levelRank[a.level] - levelRank[b.level];
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    const ka = a.strategyIds.join(",");
    const kb = b.strategyIds.join(",");
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.detail < b.detail ? -1 : a.detail > b.detail ? 1 : 0;
  });
}
