import { describe, expect, it } from "vitest";

import { buildEmailBody, buildEmailSubject, buildSmsMessage } from "./templates";

const INPUT = {
  pharmacyName: "Şifa Eczanesi",
  monthYearLabel: "Temmuz 2026",
  dutyDates: ["05.07.2026", "19.07.2026"],
  regionName: "Kadıköy",
  address: "Örnek Mah. No: 1, Kadıköy/İstanbul",
};

describe("notification templates", () => {
  it("builds the SMS message with pharmacy, period, dates and region", () => {
    const message = buildSmsMessage(INPUT);
    expect(message).toBe(
      "Sayın Şifa Eczanesi, Temmuz 2026 nöbet çizelgesine göre nöbet gününüz: 05.07.2026, 19.07.2026. Bölge: Kadıköy."
    );
  });

  it("appends the public link when provided", () => {
    const message = buildSmsMessage({ ...INPUT, publicLink: "https://ornek.tld/vatandas" });
    expect(message).toContain("Detay: https://ornek.tld/vatandas");
  });

  it("builds the email subject and body", () => {
    expect(buildEmailSubject(INPUT)).toBe("Temmuz 2026 Nöbet Bilgilendirmesi");

    const body = buildEmailBody(INPUT);
    expect(body).toContain("Sayın Şifa Eczanesi,");
    expect(body).toContain("Tarih: 05.07.2026, 19.07.2026");
    expect(body).toContain("Bölge: Kadıköy");
    expect(body).toContain("Adres: Örnek Mah. No: 1, Kadıköy/İstanbul");
    expect(body).toContain(
      "Bu mesaj eczacı odası nöbet yönetim sistemi üzerinden oluşturulmuştur."
    );
  });
});
