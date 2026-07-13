import { describe, expect, it } from "vitest";

import {
  discoverRegionCandidates,
  parseAddressRegionHint,
  resolveRowRegionSource,
} from "./region-discovery";

const ACTIVE_REGION = { id: "r-1", name: "Merkez", district: "Merkez", isActive: true };
const INACTIVE_REGION = { id: "r-2", name: "Adalar", district: "Adalar", isActive: false };

function row(overrides: Partial<{ rowNumber: number; bolge: string; ilce: string; adres: string }>) {
  return { rowNumber: 2, bolge: "", ilce: "", adres: "", ...overrides };
}

describe("parseAddressRegionHint", () => {
  it('extracts the district from a slash-separated ending: "İsmetpaşa Mahallesi, Bozüyük / Bilecik"', () => {
    expect(parseAddressRegionHint("İsmetpaşa Mahallesi, Bozüyük / Bilecik")).toEqual({
      kind: "suggestion",
      value: "Bozüyük",
    });
  });

  it('extracts the district from a compact slash ending: "Cumhuriyet Mah. Merkez/Bilecik"', () => {
    expect(parseAddressRegionHint("Cumhuriyet Mah. Merkez/Bilecik")).toEqual({
      kind: "suggestion",
      value: "Merkez",
    });
  });

  it('extracts the district from a comma-separated ending: "Gül Sok. No 3, Söğüt, Bilecik"', () => {
    expect(parseAddressRegionHint("Gül Sok. No 3, Söğüt, Bilecik")).toEqual({
      kind: "suggestion",
      value: "Söğüt",
    });
  });

  it("returns none for a plain street address with no structural ending", () => {
    expect(parseAddressRegionHint("Atatürk Caddesi No: 12")).toEqual({ kind: "none" });
    expect(parseAddressRegionHint("")).toEqual({ kind: "none" });
    expect(parseAddressRegionHint("   ")).toEqual({ kind: "none" });
  });

  it("marks a multi-slash ending as ambiguous instead of guessing", () => {
    expect(parseAddressRegionHint("Bir Mah, A / B / C")).toEqual({ kind: "ambiguous" });
  });

  it("marks endings with implausible tokens (digits) as ambiguous instead of guessing", () => {
    expect(parseAddressRegionHint("Mah 4, Sok 12 / Kat 3")).toEqual({ kind: "ambiguous" });
  });

  it("never derives anything from text without the documented structural endings", () => {
    // A province name buried mid-address is NOT structural evidence.
    expect(parseAddressRegionHint("Bozüyük yolu üzeri no 5")).toEqual({ kind: "none" });
  });
});

describe("resolveRowRegionSource priority", () => {
  it("explicit Bölge outranks everything", () => {
    const source = resolveRowRegionSource({
      bolge: "Merkez",
      ilce: "Bozüyük",
      adres: "X Mah, Söğüt / Bilecik",
    });
    expect(source).toEqual({ resolved: true, sourceType: "BOLGE_COLUMN", value: "Merkez" });
  });

  it("İlçe is used when Bölge is blank", () => {
    const source = resolveRowRegionSource({ bolge: "", ilce: "Bozüyük", adres: "" });
    expect(source).toEqual({ resolved: true, sourceType: "ILCE_COLUMN", value: "Bozüyük" });
  });

  it("address suggestion is used only when both Bölge and İlçe are blank", () => {
    const source = resolveRowRegionSource({
      bolge: "",
      ilce: "",
      adres: "X Mah, Söğüt / Bilecik",
    });
    expect(source).toEqual({ resolved: true, sourceType: "ADDRESS_SUGGESTION", value: "Söğüt" });
  });

  it("no source at all resolves to NO_SOURCE, ambiguous address to AMBIGUOUS_ADDRESS", () => {
    expect(resolveRowRegionSource({ bolge: "", ilce: "", adres: "" })).toEqual({
      resolved: false,
      reason: "NO_SOURCE",
    });
    expect(
      resolveRowRegionSource({ bolge: "", ilce: "", adres: "Mah 1, A / B / C" })
    ).toEqual({ resolved: false, reason: "AMBIGUOUS_ADDRESS" });
  });
});

describe("discoverRegionCandidates", () => {
  it("aggregates repeated values into one candidate with a row count (Turkish-aware)", () => {
    const result = discoverRegionCandidates(
      [
        row({ rowNumber: 2, bolge: "Merkez" }),
        row({ rowNumber: 3, bolge: "MERKEZ" }),
        row({ rowNumber: 4, bolge: "Bozüyük" }),
        row({ rowNumber: 5, bolge: "bozüyük" }),
        row({ rowNumber: 6, bolge: "Söğüt" }),
      ],
      []
    );
    expect(result.candidates).toHaveLength(3);
    const byKey = new Map(result.candidates.map((c) => [c.normalizedSourceValue, c]));
    expect(byKey.get("merkez")?.rowNumbers).toEqual([2, 3]);
    expect(byKey.get("bozüyük")?.rowNumbers).toEqual([4, 5]);
    expect(byKey.get("söğüt")?.rowNumbers).toEqual([6]);
  });

  it("collapses Turkish-character variations (İ/i, I/ı) into one candidate", () => {
    const result = discoverRegionCandidates(
      [row({ rowNumber: 2, bolge: "İnhisar" }), row({ rowNumber: 3, bolge: "inhisar" })],
      []
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].rowNumbers).toEqual([2, 3]);
  });

  it("classifies matches against existing active and inactive regions", () => {
    const result = discoverRegionCandidates(
      [row({ rowNumber: 2, bolge: "merkez" }), row({ rowNumber: 3, bolge: "ADALAR" })],
      [ACTIVE_REGION, INACTIVE_REGION]
    );
    const byKey = new Map(result.candidates.map((c) => [c.normalizedSourceValue, c]));
    expect(byKey.get("merkez")).toMatchObject({
      status: "MATCHED_EXISTING_ACTIVE",
      matchedRegionId: ACTIVE_REGION.id,
    });
    expect(byKey.get("adalar")).toMatchObject({
      status: "MATCHED_EXISTING_INACTIVE",
      matchedRegionId: INACTIVE_REGION.id,
    });
  });

  it("classifies an unmatched Bölge/İlçe value as NEW_REGION_CANDIDATE", () => {
    const result = discoverRegionCandidates([row({ rowNumber: 2, bolge: "Pazaryeri" })], []);
    expect(result.candidates[0].status).toBe("NEW_REGION_CANDIDATE");
  });

  it("classifies an address-derived value as ADDRESS_SUGGESTION even when it matches an existing region", () => {
    const result = discoverRegionCandidates(
      [row({ rowNumber: 2, adres: "X Mah, Merkez / Bilecik" })],
      [ACTIVE_REGION]
    );
    expect(result.candidates[0]).toMatchObject({
      status: "ADDRESS_SUGGESTION",
      sourceType: "ADDRESS_SUGGESTION",
      matchedRegionId: ACTIVE_REGION.id,
    });
  });

  it("the strongest source wins when the same value arrives from different columns", () => {
    const result = discoverRegionCandidates(
      [
        row({ rowNumber: 2, adres: "X Mah, Bozüyük / Bilecik" }),
        row({ rowNumber: 3, ilce: "Bozüyük" }),
        row({ rowNumber: 4, bolge: "Bozüyük" }),
      ],
      []
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].sourceType).toBe("BOLGE_COLUMN");
    expect(result.candidates[0].status).toBe("NEW_REGION_CANDIDATE");
    expect(result.candidates[0].rowNumbers).toEqual([2, 3, 4]);
  });

  it("proposes the row's İlçe as the district when available, falling back to the value itself", () => {
    const withIlce = discoverRegionCandidates(
      [row({ rowNumber: 2, bolge: "Merkez 1. Bölge", ilce: "Merkez" })],
      []
    );
    expect(withIlce.candidates[0].proposedDistrict).toBe("Merkez");

    const withoutIlce = discoverRegionCandidates([row({ rowNumber: 2, bolge: "Pazaryeri" })], []);
    expect(withoutIlce.candidates[0].proposedDistrict).toBe("Pazaryeri");
  });

  it("records unresolved reasons for rows without any usable source", () => {
    const result = discoverRegionCandidates(
      [row({ rowNumber: 2 }), row({ rowNumber: 3, adres: "M 1, A / B / C" })],
      []
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.unresolvedReasons.get(2)).toBe("NO_SOURCE");
    expect(result.unresolvedReasons.get(3)).toBe("AMBIGUOUS_ADDRESS");
  });

  it("never infers a region from anything but the supplied row text (no hardcoded lists)", () => {
    // A well-known Turkish district name with no structural evidence in
    // the row must NOT produce a candidate.
    const result = discoverRegionCandidates(
      [row({ rowNumber: 2, adres: "Kadıköy yakınlarında bir yer 7" })],
      []
    );
    expect(result.candidates).toHaveLength(0);
  });
});
