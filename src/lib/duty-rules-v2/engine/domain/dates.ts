// Duty Rules V2 engine — pure calendar-date helpers.
//
// Everything operates on "YYYY-MM-DD" strings with UTC calendar
// semantics. No local Date conversion exists anywhere in the engine, so
// the process time zone and DST can never shift a day (the same
// convention as src/lib/scheduling/date-tr.ts, which is UTC-based).

import { isIsoDateString } from "../../resolve-pool-membership";

export { isIsoDateString };

export const WEEKDAY_NAMES = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;
export type WeekdayName = (typeof WEEKDAY_NAMES)[number];

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** ISO weekday number: 1 = Monday … 7 = Sunday. */
export function isoWeekdayNumber(date: string): number {
  const jsDay = toUtc(date).getUTCDay(); // 0 = Sunday … 6 = Saturday
  return jsDay === 0 ? 7 : jsDay;
}

export function weekdayName(date: string): WeekdayName {
  return WEEKDAY_NAMES[isoWeekdayNumber(date) - 1];
}

export function addDays(date: string, days: number): string {
  const utc = toUtc(date);
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (positive when to > from). */
export function diffInDays(to: string, from: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / msPerDay);
}

/** Every date of [start, end], inclusive, in ascending order. */
export function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

/** Inclusive window containment, all "YYYY-MM-DD" string comparisons. */
export function dateInWindow(date: string, start: string, end: string): boolean {
  return start <= date && date <= end;
}
