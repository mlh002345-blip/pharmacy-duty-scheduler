// Duty Rules V2 — Phase 5: typed rule-engine errors.

export type RuleEngineErrorCode =
  | "INVALID_RULE_DEFINITION"
  | "UNKNOWN_RULE_TYPE"
  | "RULE_SET_CONFLICTS"
  | "RULE_SET_TOO_LARGE";

export class RuleEngineError extends Error {
  constructor(
    public readonly code: RuleEngineErrorCode,
    message: string,
    /** Offending rule ids / conflict codes — ids only, never content. */
    public readonly details: string[] = []
  ) {
    super(message);
    this.name = "RuleEngineError";
  }
}
