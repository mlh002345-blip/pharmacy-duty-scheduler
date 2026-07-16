// Duty Rules V2 engine — Stage 2: day-type resolver.
//
// DETERMINISTIC PRECEDENCE (documented; the task's suggested default,
// consistent with V1 where V1 makes a distinction at all):
//
//   1. explicit custom category override (runtime input, per date)
//   2. RELIGIOUS_HOLIDAY
//   3. OFFICIAL_HOLIDAY   (Holiday.type OTHER resolves here — V1 rule)
//   4. HOLIDAY_EVE
//   5. SUNDAY
//   6. SATURDAY
//   7. WEEKDAY
//
// V1 never distinguishes holiday eves; a V1-adapted plan is insensitive
// to rank 4 because all six of its day types carry identical slots — the
// eve distinction only changes behavior for plans that configure it.
//
// A date the plan cannot resolve unambiguously returns a CONTROLLED
// unresolved result (resolved: false + diagnostic) — never a silent
// guess.

import type { BuiltinDayType, LoadedDayTypeRule } from "../domain/loaded-plan";
import type { CalendarDayContext } from "./resolve-calendar-context";
import type { EngineDiagnostic } from "./domain/diagnostics";

/** Stable key for a day-type rule: "WEEKDAY" or "WEEKDAY|Kategori". */
export function dayTypeKeyOf(dayType: BuiltinDayType, customDayCategory: string | null): string {
  return customDayCategory === null ? dayType : `${dayType}|${customDayCategory}`;
}

export type ResolvedDayType = {
  date: string;
  resolved: boolean;
  dayType: BuiltinDayType | null;
  customDayCategory: string | null;
  /** The matched rule's id and stable key (null when unresolved). */
  dayTypeRuleId: string | null;
  dayTypeKey: string | null;
  served: boolean | null;
  /** The precedence trail actually evaluated, e.g.
   *  ["CUSTOM_OVERRIDE:none", "RELIGIOUS_HOLIDAY:no-match", …]. */
  precedence: string[];
  diagnostics: EngineDiagnostic[];
};

export function resolveDayType(
  context: CalendarDayContext,
  dayTypeRules: LoadedDayTypeRule[]
): ResolvedDayType {
  const precedence: string[] = [];
  const diagnostics: EngineDiagnostic[] = [];

  const unresolved = (): ResolvedDayType => ({
    date: context.date,
    resolved: false,
    dayType: null,
    customDayCategory: null,
    dayTypeRuleId: null,
    dayTypeKey: null,
    served: null,
    precedence,
    diagnostics,
  });

  // 1. Explicit custom override: matched by category across the plan's
  // custom rules. Exactly one match resolves; zero or several are
  // controlled failures (never a guess).
  if (context.customDayCategoryOverride !== null) {
    const matches = dayTypeRules.filter(
      (rule) => rule.customDayCategory === context.customDayCategoryOverride
    );
    if (matches.length === 1) {
      precedence.push(`CUSTOM_OVERRIDE:${context.customDayCategoryOverride}`);
      return resolvedFrom(context, matches[0], precedence, diagnostics);
    }
    diagnostics.push({
      code: matches.length === 0 ? "UNKNOWN_CUSTOM_DAY_CATEGORY" : "AMBIGUOUS_DAY_TYPE",
      date: context.date,
      subjectKey: context.customDayCategoryOverride,
    });
    return unresolved();
  }
  precedence.push("CUSTOM_OVERRIDE:none");

  // 2–7. Built-in candidates, strongest calendar fact first (the context
  // already orders them by the documented precedence).
  const builtinRules = new Map(
    dayTypeRules
      .filter((rule) => rule.customDayCategory === null)
      .map((rule) => [rule.dayType, rule])
  );
  for (const candidate of context.candidateDayTypes) {
    const rule = builtinRules.get(candidate);
    if (!rule) {
      // The loader guarantees all six built-ins exist; a miss can only
      // mean a hand-built plan — treat as ambiguity, never guess on.
      precedence.push(`${candidate}:missing-rule`);
      diagnostics.push({ code: "AMBIGUOUS_DAY_TYPE", date: context.date, subjectKey: candidate });
      return unresolved();
    }
    precedence.push(`${candidate}:matched`);
    return resolvedFrom(context, rule, precedence, diagnostics);
  }

  // context.candidateDayTypes always ends with WEEKDAY, so this line is
  // unreachable for well-formed contexts.
  diagnostics.push({ code: "AMBIGUOUS_DAY_TYPE", date: context.date, subjectKey: "NONE" });
  return unresolved();
}

function resolvedFrom(
  context: CalendarDayContext,
  rule: LoadedDayTypeRule,
  precedence: string[],
  diagnostics: EngineDiagnostic[]
): ResolvedDayType {
  const dayTypeKey = dayTypeKeyOf(rule.dayType, rule.customDayCategory);
  if (!rule.isServed) {
    diagnostics.push({ code: "UNSERVED_DAY", date: context.date, subjectKey: dayTypeKey });
  }
  return {
    date: context.date,
    resolved: true,
    dayType: rule.dayType,
    customDayCategory: rule.customDayCategory,
    dayTypeRuleId: rule.id,
    dayTypeKey,
    served: rule.isServed,
    precedence,
    diagnostics,
  };
}
