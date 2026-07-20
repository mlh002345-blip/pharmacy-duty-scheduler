import { dateAtUtcMidnight, todayAtUtcMidnight } from "./date-tr";

// Bir oda, tek bir oturumda ileriye dönük tüm nöbet dönemlerini (ör. 12
// ayın tamamını) üretip dışa aktarıp sistemden ayrılabilir — abonelik
// modeliyle çelişen bu senaryoyu önlemek için, ne kadar ileriye dönük
// çizelge üretilebileceğine sabit bir üst sınır konur. Mevcut ay her
// zaman dahildir (0 = yalnızca bu ay); değer, odanın kendisi tarafından
// yükseltilemez — bilinçli olarak bir organizasyon ayarı değil, sistem
// genelinde sabit bir iş kuralıdır.
export const MAX_GENERATION_MONTHS_AHEAD = 2;

// Belirtilen referans tarihe (varsayılan: bugün) göre, üretimine izin
// verilen en ileri dönemin başlangıç tarihi — ayın 1'i olarak.
export function maxAllowedGenerationPeriodStart(
  referenceDate: Date = todayAtUtcMidnight(),
  monthsAhead: number = MAX_GENERATION_MONTHS_AHEAD
): Date {
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth() + 1; // 1-12
  const targetMonthIndex0 = month - 1 + monthsAhead;
  const targetYear = year + Math.floor(targetMonthIndex0 / 12);
  const targetMonth = (targetMonthIndex0 % 12) + 1;
  return dateAtUtcMidnight(targetYear, targetMonth, 1);
}

// periodStart, o dönemin başlangıcı olan herhangi bir tarih olabilir
// (V1'de ayın 1'i, V2'de operatörün seçtiği bir tarih) — yalnızca üst
// sınırı aşıp aşmadığı kontrol edilir, geçmiş tarihler bu fonksiyonun
// kapsamı dışındadır (mevcut davranış korunur).
export function isWithinGenerationHorizon(
  periodStart: Date,
  referenceDate: Date = todayAtUtcMidnight(),
  monthsAhead: number = MAX_GENERATION_MONTHS_AHEAD
): boolean {
  return periodStart.getTime() <= maxAllowedGenerationPeriodStart(referenceDate, monthsAhead).getTime();
}

export const GENERATION_HORIZON_EXCEEDED_MESSAGE =
  `Bu tarih için çizelge henüz üretilemez — bir seferde en fazla ${MAX_GENERATION_MONTHS_AHEAD + 1} aylık dönem (bu ay dahil) için çizelge oluşturulabilir. Bir sonraki dönem yaklaştıkça tekrar deneyebilirsiniz.`;
