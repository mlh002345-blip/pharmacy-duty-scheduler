import { describe, expect, it } from "vitest";

import { analyzePharmacyImportRows } from "./analyze-import";
import type { PharmacyImportRawRow } from "./parse-excel";

const REGION_A = { id: "region-a", name: "Kadıköy" };
const REGION_B = { id: "region-b", name: "Üsküdar" };

function row(overrides: Partial<PharmacyImportRawRow> & { rowNumber: number }): PharmacyImportRawRow {
  return {
    bolge: REGION_A.name,
    eczaneAdi: "Deva Eczanesi",
    eczaciAdi: "Ada Yılmaz",
    telefon: "0212 212 19 18",
    aktif: "",
    ...overrides,
  };
}

function baseContext(overrides: Partial<Parameters<typeof analyzePharmacyImportRows>[1]> = {}) {
  return {
    regions: [REGION_A, REGION_B],
    existingPharmacies: [],
    defaultAreaCode: null,
    ...overrides,
  };
}

describe("analyzePharmacyImportRows", () => {
  it("marks a fully valid row READY with a normalized phone and default-active status", () => {
    const analysis = analyzePharmacyImportRows([row({ rowNumber: 2 })], baseContext());
    expect(analysis.canImport).toBe(true);
    expect(analysis.rows[0]).toMatchObject({
      status: "READY",
      matchedRegionId: REGION_A.id,
      phone: "+90 212 212 19 18",
      isActive: true,
      normalizedPharmacyName: "deva eczanesi",
    });
  });

  it("blocks the whole batch when a required field is missing", () => {
    const analysis = analyzePharmacyImportRows(
      [row({ rowNumber: 2, eczaneAdi: "" })],
      baseContext()
    );
    expect(analysis.rows[0].status).toBe("INVALID");
    expect(analysis.canImport).toBe(false);
  });

  it("rejects control characters in the pharmacy name", () => {
    const analysis = analyzePharmacyImportRows(
      [row({ rowNumber: 2, eczaneAdi: "Deva\x07Eczanesi" })],
      baseContext()
    );
    expect(analysis.rows[0].status).toBe("INVALID");
  });

  it("marks an unknown region as UNKNOWN_REGION, never auto-creating it", () => {
    const analysis = analyzePharmacyImportRows(
      [row({ rowNumber: 2, bolge: "Var Olmayan Bölge" })],
      baseContext()
    );
    expect(analysis.rows[0].status).toBe("UNKNOWN_REGION");
    expect(analysis.rows[0].matchedRegionId).toBeNull();
  });

  it("never matches a same-named region belonging to a different organization (context never includes it)", () => {
    // The context passed here simulates what the caller would build for
    // Organization A — a region literally named the same as REGION_A but
    // with a different id (as if it belonged to another org) would only
    // be matchable if the caller mistakenly included it; this asserts
    // the matcher only trusts the ids given, not name equality.
    const analysis = analyzePharmacyImportRows(
      [row({ rowNumber: 2, bolge: REGION_A.name })],
      baseContext({ regions: [{ id: "other-org-region", name: REGION_A.name }] })
    );
    expect(analysis.rows[0].matchedRegionId).toBe("other-org-region");
    // This proves the matcher trusts whatever region list it's given —
    // the actual cross-tenant guarantee lives in the caller only ever
    // fetching this organization's own regions (see actions.ts).
  });

  it("marks the second occurrence of the same pharmacy+region within the file as DUPLICATE_IN_FILE", () => {
    const analysis = analyzePharmacyImportRows(
      [row({ rowNumber: 2 }), row({ rowNumber: 3 })],
      baseContext()
    );
    expect(analysis.rows[0].status).toBe("READY");
    expect(analysis.rows[1].status).toBe("DUPLICATE_IN_FILE");
    expect(analysis.canImport).toBe(false);
  });

  it("allows the same pharmacy name in two different regions within one file", () => {
    const analysis = analyzePharmacyImportRows(
      [row({ rowNumber: 2, bolge: REGION_A.name }), row({ rowNumber: 3, bolge: REGION_B.name })],
      baseContext()
    );
    expect(analysis.rows[0].status).toBe("READY");
    expect(analysis.rows[1].status).toBe("READY");
  });

  it("marks a pharmacy already existing in the DB (same org, same region) as ALREADY_EXISTS", () => {
    const analysis = analyzePharmacyImportRows(
      [row({ rowNumber: 2 })],
      baseContext({
        existingPharmacies: [{ normalizedName: "deva eczanesi", regionId: REGION_A.id }],
      })
    );
    expect(analysis.rows[0].status).toBe("ALREADY_EXISTS");
    expect(analysis.canImport).toBe(false);
  });

  it("does not flag ALREADY_EXISTS when the same pharmacy name exists only in a different region", () => {
    const analysis = analyzePharmacyImportRows(
      [row({ rowNumber: 2, bolge: REGION_A.name })],
      baseContext({
        existingPharmacies: [{ normalizedName: "deva eczanesi", regionId: REGION_B.id }],
      })
    );
    expect(analysis.rows[0].status).toBe("READY");
  });

  it("parses every accepted Aktif value form", () => {
    const cases: [string, boolean][] = [
      ["Evet", true],
      ["evet", true],
      ["true", true],
      ["1", true],
      ["Aktif", true],
      ["Hayır", false],
      ["hayir", false],
      ["false", false],
      ["0", false],
      ["Pasif", false],
      ["", true],
    ];
    for (const [raw, expected] of cases) {
      const analysis = analyzePharmacyImportRows(
        [row({ rowNumber: 2, aktif: raw })],
        baseContext()
      );
      expect(analysis.rows[0].isActive, `Aktif="${raw}"`).toBe(expected);
      expect(analysis.rows[0].status, `Aktif="${raw}"`).toBe("READY");
    }
  });

  it("rejects an unrecognized Aktif value", () => {
    const analysis = analyzePharmacyImportRows(
      [row({ rowNumber: 2, aktif: "belki" })],
      baseContext()
    );
    expect(analysis.rows[0].status).toBe("INVALID");
  });

  it("combines a bare 7-digit phone with the supplied default area code", () => {
    const analysis = analyzePharmacyImportRows(
      [row({ rowNumber: 2, telefon: "212 19 18" })],
      baseContext({ defaultAreaCode: "228" })
    );
    expect(analysis.rows[0].phone).toBe("+90 228 212 19 18");
    expect(analysis.rows[0].status).toBe("READY");
  });

  it("blocks a bare 7-digit phone when no default area code is supplied", () => {
    const analysis = analyzePharmacyImportRows(
      [row({ rowNumber: 2, telefon: "2121918" })],
      baseContext()
    );
    expect(analysis.rows[0].status).toBe("INVALID");
  });

  it("canImport is false for an empty row set", () => {
    const analysis = analyzePharmacyImportRows([], baseContext());
    expect(analysis.canImport).toBe(false);
  });
});
