// Duty Rules V2 engine — Stage 1: calendar context resolver.
//
// Pure calendar FACTS for every date of the period: weekday, holiday
// matches, eve status, custom overrides, and the candidate built-in day
// types those facts imply. This stage never decides the final day type —
// that is the day-type resolver's job (Stage 2).
//
// Calendar-date semantics only: all computations run on "YYYY-MM-DD"
// strings through UTC helpers; no local Date conversion can shift a day.

import type { BuiltinDayType } from "../domain/loaded-plan";
import {
  addDays,
  enumerateDates,
  isoWeekdayNumber,
  weekdayName,
  type WeekdayName,
} from "./domain/dates";
import type { EngineCustomDayOverride, EngineHoliday } from "./domain/engine-input";

export type CalendarDayContext = {
  date: string;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekdayNumber: number;
  weekdayName: WeekdayName;
  isSaturday: boolean;
  isSunday: boolean;
  /** Every holiday matching this date, deterministically ordered
   *  (type, then name) — overlapping holiday metadata is preserved. */
  holidays: EngineHoliday[];
  /** True when the FOLLOWING calendar day carries at least one holiday. */
  isHolidayEve: boolean;
  /** Explicit runtime override for this date, if any (validated unique). */
  customDayCategoryOverride: string | null;
  /** Built-in day types the calendar facts support, strongest first:
   *  RELIGIOUS_HOLIDAY > OFFICIAL_HOLIDAY > HOLIDAY_EVE > SUNDAY >
   *  SATURDAY > WEEKDAY. Holiday.type OTHER maps to OFFICIAL_HOLIDAY —
   *  the documented V1 weighting rule, preserved as a calendar fact. */
  candidateDayTypes: BuiltinDayType[];
  /** Phase 6 corrective: the day type this date would resolve to if
   *  HOLIDAY_EVE / holiday classification were ignored entirely — i.e.
   *  purely from the underlying weekday (V1 has no eve concept at all;
   *  resolveDutyWeight in generate-duty-schedule.ts only ever branches
   *  on holiday/Saturday/Sunday/weekday). Always computed, independent
   *  of any policy — a pure calendar fact, never a hidden default. Used
   *  ONLY when EngineSchedulingPolicy.holidayEveWeightSource is
   *  explicitly set to "UNDERLYING_WEEKDAY" AND the resolved day type is
   *  HOLIDAY_EVE; native V2 semantics (CONFIGURED, the default) ignore
   *  this field entirely. */
  compatibilityWeightDayType: "WEEKDAY" | "SATURDAY" | "SUNDAY";
};

/** Phase 6 corrective (Part 4): the LAST holiday matching `date`, in the
 *  caller's ORIGINAL `holidays` array order (never re-sorted) — or null
 *  if none. V1's `holidayByDateKey` is a plain Map, so whichever holiday
 *  record appears last in the input array wins for weight purposes;
 *  this reproduces that exact fact.
 *
 *  Deliberately NOT a field on CalendarDayContext (which is embedded
 *  wholesale into DutyEngineDraftResult.days and therefore
 *  resultFingerprint): CalendarDayContext must stay order-insensitive to
 *  holiday input so a NATIVE_PRECEDENCE (default) run's provenance is
 *  genuinely unaffected by holiday array order, exactly as before this
 *  corrective. Callers compute this ONLY when
 *  holidayOverlapResolutionMode is explicitly "V1_LAST_INPUT_WINS". */
export function resolveCompatibilityLastInputHoliday(
  holidays: EngineHoliday[],
  date: string
): EngineHoliday | null {
  let last: EngineHoliday | null = null;
  for (const holiday of holidays) {
    if (holiday.date === date) last = holiday;
  }
  return last;
}

export function resolveCalendarContext(input: {
  periodStart: string;
  periodEnd: string;
  holidays: EngineHoliday[];
  customDayOverrides: EngineCustomDayOverride[];
}): CalendarDayContext[] {
  const holidaysByDate = new Map<string, EngineHoliday[]>();
  for (const holiday of input.holidays) {
    const list = holidaysByDate.get(holiday.date) ?? [];
    list.push(holiday);
    holidaysByDate.set(holiday.date, list);
  }
  for (const list of holidaysByDate.values()) {
    list.sort((a, b) =>
      a.type !== b.type ? (a.type < b.type ? -1 : 1) : a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    );
  }
  const overrideByDate = new Map(
    input.customDayOverrides.map((o) => [o.date, o.customDayCategory])
  );

  return enumerateDates(input.periodStart, input.periodEnd).map((date) => {
    const holidays = holidaysByDate.get(date) ?? [];
    const saturday = isoWeekdayNumber(date) === 6;
    const sunday = isoWeekdayNumber(date) === 7;
    // Eve status may depend on a holiday just OUTSIDE the period, which
    // is why holidays are runtime input for the whole relevant span.
    const isHolidayEve = (holidaysByDate.get(addDays(date, 1)) ?? []).length > 0;

    const candidateDayTypes: BuiltinDayType[] = [];
    if (holidays.some((h) => h.type === "RELIGIOUS")) candidateDayTypes.push("RELIGIOUS_HOLIDAY");
    if (holidays.some((h) => h.type === "OFFICIAL" || h.type === "OTHER")) {
      candidateDayTypes.push("OFFICIAL_HOLIDAY");
    }
    if (isHolidayEve) candidateDayTypes.push("HOLIDAY_EVE");
    if (sunday) candidateDayTypes.push("SUNDAY");
    if (saturday) candidateDayTypes.push("SATURDAY");
    candidateDayTypes.push("WEEKDAY");

    return {
      date,
      weekdayNumber: isoWeekdayNumber(date),
      weekdayName: weekdayName(date),
      isSaturday: saturday,
      isSunday: sunday,
      holidays,
      isHolidayEve,
      customDayCategoryOverride: overrideByDate.get(date) ?? null,
      candidateDayTypes,
      compatibilityWeightDayType: sunday ? "SUNDAY" : saturday ? "SATURDAY" : "WEEKDAY",
    };
  });
}
