// Nöbet dengesi sınıflandırması: bir eczanenin toplam denge skoru, bölgedeki
// ortalama yüke göre "Düşük Yük / Dengeli / Yüksek Yük" olarak etiketlenir.

export type BalanceStatus = "LOW" | "BALANCED" | "HIGH";

export const BALANCE_STATUS_LABELS: Record<BalanceStatus, string> = {
  LOW: "Düşük Yük",
  BALANCED: "Dengeli",
  HIGH: "Yüksek Yük",
};

// Ortalamanın %15 altı düşük, %15 üstü yüksek kabul edilir.
const BALANCE_TOLERANCE = 0.15;

export function classifyBalance(totalScore: number, meanScore: number): BalanceStatus {
  if (meanScore <= 0) return "BALANCED";
  if (totalScore < meanScore * (1 - BALANCE_TOLERANCE)) return "LOW";
  if (totalScore > meanScore * (1 + BALANCE_TOLERANCE)) return "HIGH";
  return "BALANCED";
}

export function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Görüntüleme için puanı en fazla 2 ondalıkla, gereksiz sıfırlar olmadan yazar.
export function formatPoints(value: number): string {
  return Number(value.toFixed(2)).toLocaleString("tr-TR");
}
