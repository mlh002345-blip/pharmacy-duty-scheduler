// Duty Rules V2 — Phase 6: stable selection diagnostic/error catalogues.

export const SELECTION_DIAGNOSTIC_CODES = [
  "STRATEGY_NOT_FOUND",
  "STRATEGY_EQUAL_PRECEDENCE_CONFLICT",
  "STRATEGY_UNRESOLVED",
  "FALLBACK_USED",
  "FALLBACK_UNKNOWN_TARGET",
  "FALLBACK_DISABLED_TARGET",
  "FALLBACK_CYCLE_DETECTED",
  "UNDERFILLED_SELECTION",
  "NO_ELIGIBLE_CANDIDATES",
] as const;
export type SelectionDiagnosticCode = (typeof SELECTION_DIAGNOSTIC_CODES)[number];

export type SelectionDiagnostic = {
  code: SelectionDiagnosticCode;
  date: string;
  subjectKey: string;
};

export function sortSelectionDiagnostics(
  diagnostics: SelectionDiagnostic[]
): SelectionDiagnostic[] {
  return [...diagnostics].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.subjectKey < b.subjectKey ? -1 : a.subjectKey > b.subjectKey ? 1 : 0;
  });
}
