// Duty Rules V2 — Phase 6: typed selection-engine errors.

export type SelectionEngineErrorCode =
  | "INVALID_STRATEGY_DEFINITION"
  | "UNKNOWN_STRATEGY_TYPE"
  | "STRATEGY_SET_CONFLICTS"
  | "STRATEGY_SET_TOO_LARGE"
  /** Phase 6 corrective: the period-level sequential orchestrator
   *  received the same slotKey more than once — a caller defect, never
   *  silently deduplicated. */
  | "DUPLICATE_SLOT_IN_PERIOD";

export class SelectionEngineError extends Error {
  constructor(
    public readonly code: SelectionEngineErrorCode,
    message: string,
    public readonly details: string[] = []
  ) {
    super(message);
    this.name = "SelectionEngineError";
  }
}
