import { describe, expect, it } from "vitest";

import {
  calculateHistoricalDutyWeight,
  normalizeText,
  parseHistoricalDate,
} from "./normalize";
import { analyzeImportRows, type ImportRowInput } from "./analyze-import";

function row(overrides: Partial<ImportRowInput>): ImportRowInput {
  return {
    rowNumber: 2,
    tarih: "15.01.2025",
    bolge: "",
    eczaneAdi: "Şifa Eczanesi",
    nobetTuru: "Normal",
    telefon: "",
    adres: "",
    not: "",
    ...overrides,
  };
}

const CONTEXT = {
  regions: [
    { id: "r1", name: "Kadıköy" },
    { id: "r2", name: "Üsküdar" },
  ],
  pharmacies: [
    { id: "p1", name: "Şifa Eczanesi", regionId: "r1" },
    { id: "p2", name: "Deva Eczanesi", regionId: "r1" },
    // Aynı ada sahip iki eczane (farklı bölgelerde) — belirsiz eşleşme testi.
    { id: "p3", name: "Merkez Eczanesi", regionId: "r1" },
    { id: "p4", name: "Merkez Eczanesi", regionId: "r2" },
  ],
};

describe("normalizeText", () => {
  it("trims, collapses spaces and lowercases with Turkish rules", () => {
    expect(normalizeText("  ŞİFA   ECZANESİ  ")).toBe("şifa eczanesi");
    expect(normalizeText("KADIKÖY")).toBe("kadıköy");
    expect(normalizeText(null)).toBe("");
  });
});

describe("parseHistoricalDate", () => {
  it("accepts dd.mm.yyyy, dd/mm/yyyy and yyyy-mm-dd", () => {
    for (const value of ["15.01.2025", "15/01/2025", "2025-01-15", "15-01-2025"]) {
      const date = parseHistoricalDate(value);
      expect(date?.toISOString()).toBe("2025-01-15T00:00:00.000Z");
    }
  });

  it("rejects invalid or overflowing dates", () => {
    expect(parseHistoricalDate("31.02.2024")).toBeNull();
    expect(parseHistoricalDate("2025-13-01")).toBeNull();
    expect(parseHistoricalDate("yarın")).toBeNull();
    expect(parseHistoricalDate("")).toBeNull();
  });
});

describe("calculateHistoricalDutyWeight", () => {
  const monday = new Date(Date.UTC(2025, 0, 13));
  const saturday = new Date(Date.UTC(2025, 0, 18));
  const sunday = new Date(Date.UTC(2025, 0, 19));

  it("uses duty type text first", () => {
    expect(calculateHistoricalDutyWeight(monday, "Bayram Nöbeti")).toBe(2.0);
    expect(calculateHistoricalDutyWeight(monday, "Resmi Tatil")).toBe(1.5);
    expect(calculateHistoricalDutyWeight(sunday, "BAYRAM")).toBe(2.0);
  });

  it("falls back to holiday lookup, then weekday", () => {
    expect(
      calculateHistoricalDutyWeight(monday, "", () => "RELIGIOUS")
    ).toBe(2.0);
    expect(calculateHistoricalDutyWeight(monday, "", () => "OFFICIAL")).toBe(1.5);
    expect(calculateHistoricalDutyWeight(saturday, "")).toBe(1.2);
    expect(calculateHistoricalDutyWeight(sunday, "")).toBe(1.3);
    expect(calculateHistoricalDutyWeight(monday, "")).toBe(1.0);
  });
});

describe("analyzeImportRows", () => {
  it("matches pharmacy by name + region, then by unique name with warning", () => {
    const analysis = analyzeImportRows(
      [
        row({ rowNumber: 2, bolge: "Kadıköy", eczaneAdi: "şifa eczanesi" }),
        row({ rowNumber: 3, tarih: "16.01.2025", eczaneAdi: "Deva Eczanesi" }),
      ],
      CONTEXT
    );

    expect(analysis.rows[0].status).toBe("OK");
    expect(analysis.rows[0].matchedPharmacyId).toBe("p1");
    expect(analysis.rows[0].matchedRegionId).toBe("r1");

    expect(analysis.rows[1].status).toBe("WARNING");
    expect(analysis.rows[1].matchedPharmacyId).toBe("p2");
    expect(analysis.canImport).toBe(true);
  });

  it("flags ambiguous matches, unknown pharmacies and missing/invalid dates as errors", () => {
    const analysis = analyzeImportRows(
      [
        row({ rowNumber: 2, eczaneAdi: "Merkez Eczanesi" }),
        row({ rowNumber: 3, eczaneAdi: "Olmayan Eczane" }),
        row({ rowNumber: 4, tarih: "" }),
        row({ rowNumber: 5, tarih: "31.02.2024" }),
        row({ rowNumber: 6, eczaneAdi: "" }),
      ],
      CONTEXT
    );

    expect(analysis.rows.every((r) => r.status === "ERROR")).toBe(true);
    expect(analysis.errorCount).toBe(5);
    expect(analysis.canImport).toBe(false);
  });

  it("resolves ambiguous names when region is provided", () => {
    const analysis = analyzeImportRows(
      [row({ bolge: "Üsküdar", eczaneAdi: "Merkez Eczanesi" })],
      CONTEXT
    );
    expect(analysis.rows[0].status).toBe("OK");
    expect(analysis.rows[0].matchedPharmacyId).toBe("p4");
  });

  it("detects duplicate date + pharmacy rows in the same file", () => {
    const analysis = analyzeImportRows(
      [
        row({ rowNumber: 2, bolge: "Kadıköy" }),
        row({ rowNumber: 3, bolge: "Kadıköy", eczaneAdi: " ŞİFA ECZANESİ " }),
      ],
      CONTEXT
    );
    expect(analysis.rows[0].status).toBe("OK");
    expect(analysis.rows[1].status).toBe("ERROR");
    expect(analysis.rows[1].messages.join(" ")).toContain("birden fazla satır");
  });

  it("applies default weight warning when duty type is empty", () => {
    const analysis = analyzeImportRows(
      [row({ bolge: "Kadıköy", nobetTuru: "" })],
      CONTEXT
    );
    expect(analysis.rows[0].weight).toBe(1.0);
    expect(analysis.rows[0].messages.join(" ")).toContain("varsayılan puan");
  });
});
