// Bölge bazlı veri sağlığı değerlendirmesi (saf, test edilebilir).

export type RegionHealthInput = {
  name: string;
  isActive: boolean;
  dailyDutyCount: number;
  activePharmacyCount: number;
  hasDutyRule: boolean;
};

export type HealthIssue = {
  severity: "CRITICAL" | "WARNING";
  message: string;
};

export function evaluateRegionHealth(region: RegionHealthInput): HealthIssue[] {
  const issues: HealthIssue[] = [];
  if (!region.isActive) return issues;

  if (!region.hasDutyRule) {
    issues.push({
      severity: "CRITICAL",
      message: `"${region.name}" bölgesinde nöbet kuralı tanımlanmamış.`,
    });
  }
  if (region.activePharmacyCount === 0) {
    issues.push({
      severity: "CRITICAL",
      message: `"${region.name}" bölgesinde aktif eczane bulunmuyor.`,
    });
  } else if (region.activePharmacyCount < region.dailyDutyCount) {
    issues.push({
      severity: "CRITICAL",
      message: `"${region.name}" bölgesinde aktif eczane sayısı (${region.activePharmacyCount}) günlük nöbetçi ihtiyacından (${region.dailyDutyCount}) az.`,
    });
  } else if (region.activePharmacyCount < region.dailyDutyCount * 3) {
    issues.push({
      severity: "WARNING",
      message: `"${region.name}" bölgesinde aktif eczane sayısı düşük (${region.activePharmacyCount}); bazı tarihlerde uygun eczane sayısı yetersiz olabilir.`,
    });
  }
  return issues;
}
