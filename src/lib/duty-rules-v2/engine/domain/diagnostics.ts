// Duty Rules V2 engine — the stable diagnostic and reason catalogues.
//
// Codes are the program-level contract; no free-text message is ever
// used as logic, and user-facing Turkish messages belong to a later
// presentation layer. Every diagnostic carries at most a date, a stable
// subject key, and a code — never tenant content.

export const CALENDAR_DIAGNOSTIC_CODES = [
  "AMBIGUOUS_DAY_TYPE",
  "UNKNOWN_CUSTOM_DAY_CATEGORY",
  "UNSERVED_DAY",
] as const;
export type CalendarDiagnosticCode = (typeof CALENDAR_DIAGNOSTIC_CODES)[number];

export const SLOT_DIAGNOSTIC_CODES = [
  "SLOT_WITHOUT_SHIFT",
  "SLOT_WITHOUT_POOL",
  "INVALID_REQUIRED_COUNT",
] as const;
export type SlotDiagnosticCode = (typeof SLOT_DIAGNOSTIC_CODES)[number];

export const POOL_DIAGNOSTIC_CODES = ["EMPTY_POOL", "NO_ACTIVE_MEMBERS"] as const;
export type PoolDiagnosticCode = (typeof POOL_DIAGNOSTIC_CODES)[number];

export const ELIGIBILITY_REASON_CODES = [
  "PHARMACY_INACTIVE",
  "NOT_A_MEMBER",
  "UNAVAILABLE",
  "CANNOT_DUTY_REQUEST",
  "EMERGENCY_EXCUSE",
  "MIN_DAYS_INTERVAL",
  "DUPLICATE_SLOT_ASSIGNMENT",
  "SAME_DAY_ASSIGNMENT_CONFLICT",
] as const;
export type EligibilityReasonCode = (typeof ELIGIBILITY_REASON_CODES)[number];

export const GENERATION_DIAGNOSTIC_CODES = [
  "INSUFFICIENT_STRICT_CANDIDATES",
  "MIN_INTERVAL_RELAXED",
  "INSUFFICIENT_CANDIDATES_AFTER_RELAXATION",
  "UNRESOLVED_SLOT",
] as const;
export type GenerationDiagnosticCode = (typeof GENERATION_DIAGNOSTIC_CODES)[number];

export type EngineDiagnosticCode =
  | CalendarDiagnosticCode
  | SlotDiagnosticCode
  | PoolDiagnosticCode
  | GenerationDiagnosticCode;

export type EngineDiagnostic = {
  code: EngineDiagnosticCode;
  /** The calendar date the diagnostic belongs to, or null for run-level. */
  date: string | null;
  /** Stable subject key (slot key, pool id, day-type key, …) — ids only. */
  subjectKey: string;
};

/** Canonical diagnostic ordering: date (nulls first), code, subjectKey. */
export function sortDiagnostics(diagnostics: EngineDiagnostic[]): EngineDiagnostic[] {
  return [...diagnostics].sort((a, b) => {
    const dateA = a.date ?? "";
    const dateB = b.date ?? "";
    if (dateA !== dateB) return dateA < dateB ? -1 : 1;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.subjectKey < b.subjectKey ? -1 : a.subjectKey > b.subjectKey ? 1 : 0;
  });
}
