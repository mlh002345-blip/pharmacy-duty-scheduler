// Nöbet bildirimi Türkçe mesaj şablonları. Saf fonksiyonlardır; birim
// testleriyle doğrulanır. Gerçek gönderim yapılmaz — şablonlar önizleme ve
// simülasyon için kullanılır, ileride sağlayıcı entegrasyonuna hazırdır.

export type NotificationTemplateInput = {
  pharmacyName: string;
  monthYearLabel: string; // ör. "Temmuz 2026"
  dutyDates: string[]; // ör. ["05.07.2026", "19.07.2026"]
  regionName: string;
  address: string;
  publicLink?: string;
};

export function buildSmsMessage(input: NotificationTemplateInput): string {
  const dates = input.dutyDates.join(", ");
  const link = input.publicLink ? ` Detay: ${input.publicLink}` : "";
  return `Sayın ${input.pharmacyName}, ${input.monthYearLabel} nöbet çizelgesine göre nöbet gününüz: ${dates}. Bölge: ${input.regionName}.${link}`;
}

export function buildEmailSubject(input: Pick<NotificationTemplateInput, "monthYearLabel">): string {
  return `${input.monthYearLabel} Nöbet Bilgilendirmesi`;
}

export function buildEmailBody(input: NotificationTemplateInput): string {
  const dates = input.dutyDates.join(", ");
  return [
    `Sayın ${input.pharmacyName},`,
    "",
    `${input.monthYearLabel} dönemine ait nöbet bilginiz aşağıdadır:`,
    "",
    `Tarih: ${dates}`,
    `Bölge: ${input.regionName}`,
    `Adres: ${input.address}`,
    "",
    "Detaylı bilgi için vatandaş ekranını veya eczacı odası duyurularını kontrol edebilirsiniz.",
    "",
    "Bu mesaj eczacı odası nöbet yönetim sistemi üzerinden oluşturulmuştur.",
  ].join("\n");
}
