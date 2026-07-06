export const TURKISH_MONTH_NAMES = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];

const TURKISH_DAY_NAMES_BY_JS_DAY = [
  "Pazar",
  "Pazartesi",
  "Salı",
  "Çarşamba",
  "Perşembe",
  "Cuma",
  "Cumartesi",
];

export function getTurkishMonthName(month: number): string {
  return TURKISH_MONTH_NAMES[month - 1] ?? "";
}

export function getTurkishDayName(date: Date): string {
  return TURKISH_DAY_NAMES_BY_JS_DAY[date.getUTCDay()];
}

export function isSaturday(date: Date): boolean {
  return date.getUTCDay() === 6;
}

export function isSunday(date: Date): boolean {
  return date.getUTCDay() === 0;
}

export function isWeekend(date: Date): boolean {
  return isSaturday(date) || isSunday(date);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function dateAtUtcMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function diffInDays(a: Date, b: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((a.getTime() - b.getTime()) / msPerDay);
}
