// Geçmiş nöbet içe aktarması için saf yardımcılar: metin normalizasyonu,
// tarih ayrıştırma ve geçmiş nöbet ağırlığı hesabı. Prisma'ya bağımlı
// değildir; birim testleriyle doğrulanır.

import { isSaturday, isSunday } from "@/lib/scheduling/date-tr";

// Türkçe'ye duyarlı normalizasyon: kırp, tekrarlanan boşlukları teke indir,
// küçük harfe çevir (İ→i, I→ı doğru şekilde).
export function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("tr");
}

// dd.mm.yyyy, dd/mm/yyyy, dd-mm-yyyy ve yyyy-mm-dd biçimlerini kabul eder;
// geçersiz tarihlerde null döner. Sonuç her zaman UTC gece yarısıdır.
export function parseHistoricalDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const text = value.trim();

  let day: number, month: number, year: number;

  const dmy = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  const ymd = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (dmy) {
    day = Number(dmy[1]);
    month = Number(dmy[2]);
    year = Number(dmy[3]);
  } else if (ymd) {
    year = Number(ymd[1]);
    month = Number(ymd[2]);
    day = Number(ymd[3]);
  } else {
    return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // 31.02.2024 gibi taşan tarihleri reddet.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export type HolidayLookup = (date: Date) => "OFFICIAL" | "RELIGIOUS" | "OTHER" | null;

// Şeffaf geçmiş nöbet puanlaması:
//   "bayram" içeren nöbet türü        → 2.0
//   "tatil" içeren nöbet türü         → 1.5
//   tarihte dini bayram kaydı varsa   → 2.0
//   tarihte resmî/diğer tatil varsa   → 1.5
//   Pazar                             → 1.3
//   Cumartesi                         → 1.2
//   diğer günler                      → 1.0
export function calculateHistoricalDutyWeight(
  date: Date,
  rawDutyType: string | null | undefined,
  holidayLookup?: HolidayLookup
): number {
  const dutyType = normalizeText(rawDutyType);
  if (dutyType.includes("bayram")) return 2.0;
  if (dutyType.includes("tatil")) return 1.5;

  const holidayType = holidayLookup?.(date) ?? null;
  if (holidayType === "RELIGIOUS") return 2.0;
  if (holidayType) return 1.5;

  if (isSunday(date)) return 1.3;
  if (isSaturday(date)) return 1.2;
  return 1.0;
}
