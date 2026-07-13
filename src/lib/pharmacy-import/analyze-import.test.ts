import { describe, expect, it } from "vitest";

import {
  analyzePharmacyImportRows,
  recomputePharmacyImportRows,
  type PersistedCandidateForRecompute,
  type PersistedRowForRecompute,
} from "./analyze-import";
import type { PharmacyImportRawRow } from "./parse-excel";

const REGION_A = { id: "region-a", name: "Kadıköy", district: "Kadıköy", isActive: true };
const REGION_B = { id: "region-b", name: "Üsküdar", district: "Üsküdar", isActive: true };
const REGION_INACTIVE = { id: "region-c", name: "Adalar", district: "Adalar", isActive: false };

function row(overrides: Partial<PharmacyImportRawRow> & { rowNumber: number }): PharmacyImportRawRow {
  return {
    bolge: REGION_A.name,
    ilce: "",
    adres: "",
    eczaneAdi: "Deva Eczanesi",
    eczaciAdi: "Ada Yılmaz",
    telefon: "0212 212 19 18",
    aktif: "",
    ...overrides,
  };
}

function baseContext(overrides: Partial<Parameters<typeof analyzePharmacyImportRows>[1]> = {}) {
  return {
    regions: [REGION_A, REGION_B, REGION_INACTIVE],
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

  it("marks an unknown region as a pending new-region candidate, never auto-creating it", () => {
    const analysis = analyzePharmacyImportRows(
      [row({ rowNumber: 2, bolge: "Var Olmayan Bölge" })],
      baseContext()
    );
    expect(analysis.rows[0].status).toBe("REGION_PENDING");
    expect(analysis.rows[0].errorCode).toBe("REGION_PENDING_APPROVAL");
    expect(analysis.rows[0].matchedRegionId).toBeNull();
    expect(analysis.canImport).toBe(false);
    expect(analysis.candidates).toHaveLength(1);
    expect(analysis.candidates[0]).toMatchObject({
      status: "NEW_REGION_CANDIDATE",
      sourceType: "BOLGE_COLUMN",
      matchedRegionId: null,
    });
  });

  it("marks a match against an INACTIVE region as pending an explicit decision", () => {
    const analysis = analyzePharmacyImportRows(
      [row({ rowNumber: 2, bolge: REGION_INACTIVE.name })],
      baseContext()
    );
    expect(analysis.rows[0].status).toBe("REGION_PENDING");
    expect(analysis.rows[0].errorCode).toBe("REGION_INACTIVE_PENDING");
    expect(analysis.candidates[0].status).toBe("MATCHED_EXISTING_INACTIVE");
    expect(analysis.candidates[0].matchedRegionId).toBe(REGION_INACTIVE.id);
  });

  it("never matches a same-named region belonging to a different organization (context never includes it)", () => {
    const analysis = analyzePharmacyImportRows(
      [row({ rowNumber: 2, bolge: REGION_A.name })],
      baseContext({
        regions: [{ id: "other-org-region", name: REGION_A.name, district: "X", isActive: true }],
      })
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

  it("detects duplicates even between rows of a not-yet-created candidate region", () => {
    const analysis = analyzePharmacyImportRows(
      [
        row({ rowNumber: 2, bolge: "Yeni Bölge" }),
        row({ rowNumber: 3, bolge: "YENİ BÖLGE" }), // Turkish-variant capitalization
      ],
      baseContext()
    );
    expect(analysis.rows[0].status).toBe("REGION_PENDING");
    expect(analysis.rows[1].status).toBe("DUPLICATE_IN_FILE");
    expect(analysis.candidates).toHaveLength(1);
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

  it("uses the İlçe value as a fallback region source when Bölge is blank (old İlçe-header templates keep working)", () => {
    const analysis = analyzePharmacyImportRows(
      [row({ rowNumber: 2, bolge: "", ilce: REGION_A.name })],
      baseContext()
    );
    expect(analysis.rows[0].status).toBe("READY");
    expect(analysis.rows[0].matchedRegionId).toBe(REGION_A.id);
    expect(analysis.candidates[0].sourceType).toBe("ILCE_COLUMN");
  });

  it("treats an address-derived value as a suggestion needing confirmation, even when it matches an existing region", () => {
    const analysis = analyzePharmacyImportRows(
      [row({ rowNumber: 2, bolge: "", ilce: "", adres: "İsmetpaşa Mahallesi, Kadıköy / İstanbul" })],
      baseContext()
    );
    expect(analysis.rows[0].status).toBe("REGION_PENDING");
    expect(analysis.rows[0].errorCode).toBe("REGION_SUGGESTION_PENDING");
    expect(analysis.candidates[0]).toMatchObject({
      status: "ADDRESS_SUGGESTION",
      sourceType: "ADDRESS_SUGGESTION",
      matchedRegionId: REGION_A.id, // shown as a hint, never auto-used
    });
    expect(analysis.canImport).toBe(false);
  });

  it("leaves a row with no region source and no usable address unresolved", () => {
    const analysis = analyzePharmacyImportRows(
      [row({ rowNumber: 2, bolge: "", ilce: "", adres: "Sadece bir sokak adı 12" })],
      baseContext()
    );
    expect(analysis.rows[0].status).toBe("REGION_PENDING");
    expect(analysis.rows[0].errorCode).toBe("REGION_UNRESOLVED");
    expect(analysis.rows[0].candidateKey).toBeNull();
    expect(analysis.candidates).toHaveLength(0);
  });

  it("validates the optional Adres column (control characters, length)", () => {
    const bad = analyzePharmacyImportRows(
      [row({ rowNumber: 2, adres: "Cadde\x00Sokak" })],
      baseContext()
    );
    expect(bad.rows[0].status).toBe("INVALID");
    expect(bad.rows[0].errorCode).toBe("ADDRESS_INVALID_CHARACTERS");

    const long = analyzePharmacyImportRows(
      [row({ rowNumber: 2, adres: "a".repeat(501) })],
      baseContext()
    );
    expect(long.rows[0].status).toBe("INVALID");
    expect(long.rows[0].errorCode).toBe("ADDRESS_TOO_LONG");

    const fine = analyzePharmacyImportRows(
      [row({ rowNumber: 2, adres: "Çamlıca Mah. Gül Sok. No: 3" })],
      baseContext()
    );
    expect(fine.rows[0].status).toBe("READY");
    expect(fine.rows[0].address).toBe("Çamlıca Mah. Gül Sok. No: 3");
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

describe("recomputePharmacyImportRows", () => {
  function persistedRow(
    overrides: Partial<PersistedRowForRecompute> & { id: string; rowNumber: number }
  ): PersistedRowForRecompute {
    return {
      normalizedPharmacyName: `eczane ${overrides.id}`,
      status: "REGION_PENDING",
      safeErrorCode: "REGION_PENDING_APPROVAL",
      candidateId: null,
      regionId: null,
      ...overrides,
    };
  }

  function candidate(
    overrides: Partial<PersistedCandidateForRecompute> & { id: string }
  ): PersistedCandidateForRecompute {
    return {
      status: "NEW_REGION_CANDIDATE",
      approvedAt: null,
      matchedRegionId: null,
      normalizedProposedName: "yeni bölge",
      ...overrides,
    };
  }

  it("an unapproved new-region candidate blocks import; approval unblocks it", () => {
    const rows = [persistedRow({ id: "r1", rowNumber: 2, candidateId: "c1" })];
    const before = recomputePharmacyImportRows(rows, [candidate({ id: "c1" })], []);
    expect(before.rows[0].status).toBe("REGION_PENDING");
    expect(before.canImport).toBe(false);

    const after = recomputePharmacyImportRows(
      rows,
      [candidate({ id: "c1", approvedAt: new Date() })],
      []
    );
    expect(after.rows[0].status).toBe("READY");
    expect(after.rows[0].regionId).toBeNull(); // created only inside the final transaction
    expect(after.canImport).toBe(true);
  });

  it("an excluded candidate excludes its rows without blocking the rest", () => {
    const rows = [
      persistedRow({ id: "r1", rowNumber: 2, candidateId: "c1" }),
      persistedRow({ id: "r2", rowNumber: 3, candidateId: "c2" }),
    ];
    const result = recomputePharmacyImportRows(
      rows,
      [
        candidate({ id: "c1", status: "EXCLUDED_BY_ADMIN" }),
        candidate({ id: "c2", approvedAt: new Date(), normalizedProposedName: "b" }),
      ],
      []
    );
    expect(result.rows.find((r) => r.id === "r1")?.status).toBe("EXCLUDED");
    expect(result.rows.find((r) => r.id === "r2")?.status).toBe("READY");
    expect(result.excludedCount).toBe(1);
    expect(result.canImport).toBe(true);
  });

  it("an inactive-region match stays blocked until the ADMIN records a decision", () => {
    const rows = [persistedRow({ id: "r1", rowNumber: 2, candidateId: "c1" })];
    const pending = recomputePharmacyImportRows(
      rows,
      [candidate({ id: "c1", status: "MATCHED_EXISTING_INACTIVE", matchedRegionId: "region-x" })],
      []
    );
    expect(pending.rows[0].status).toBe("REGION_PENDING");
    expect(pending.rows[0].errorCode).toBe("REGION_INACTIVE_PENDING");

    const decided = recomputePharmacyImportRows(
      rows,
      [
        candidate({
          id: "c1",
          status: "MATCHED_EXISTING_INACTIVE",
          matchedRegionId: "region-x",
          approvedAt: new Date(),
        }),
      ],
      []
    );
    expect(decided.rows[0].status).toBe("READY");
    expect(decided.rows[0].regionId).toBe("region-x");
  });

  it("two approved candidates normalizing to the same region name share duplicate detection", () => {
    const rows = [
      persistedRow({ id: "r1", rowNumber: 2, candidateId: "c1", normalizedPharmacyName: "deva" }),
      persistedRow({ id: "r2", rowNumber: 3, candidateId: "c2", normalizedPharmacyName: "deva" }),
    ];
    const result = recomputePharmacyImportRows(
      rows,
      [
        candidate({ id: "c1", approvedAt: new Date(), normalizedProposedName: "merkez" }),
        candidate({ id: "c2", approvedAt: new Date(), normalizedProposedName: "merkez" }),
      ],
      []
    );
    expect(result.rows.find((r) => r.id === "r1")?.status).toBe("READY");
    expect(result.rows.find((r) => r.id === "r2")?.status).toBe("DUPLICATE_IN_FILE");
  });

  it("ALREADY_EXISTS applies against real regions during recompute", () => {
    const rows = [
      persistedRow({ id: "r1", rowNumber: 2, candidateId: "c1", normalizedPharmacyName: "deva" }),
    ];
    const result = recomputePharmacyImportRows(
      rows,
      [
        candidate({
          id: "c1",
          status: "MATCHED_EXISTING_ACTIVE",
          matchedRegionId: "region-a",
        }),
      ],
      [{ regionId: "region-a", normalizedName: "deva" }]
    );
    expect(result.rows[0].status).toBe("ALREADY_EXISTS");
    expect(result.canImport).toBe(false);
  });

  it("field-invalid rows stay INVALID regardless of candidate decisions", () => {
    const rows = [
      persistedRow({
        id: "r1",
        rowNumber: 2,
        candidateId: "c1",
        status: "INVALID",
        safeErrorCode: "PHONE_UNRECOGNIZED",
      }),
    ];
    const result = recomputePharmacyImportRows(
      rows,
      [candidate({ id: "c1", approvedAt: new Date() })],
      []
    );
    expect(result.rows[0].status).toBe("INVALID");
    expect(result.canImport).toBe(false);
  });

  it("rows with no candidate remain pending with their original unresolved reason", () => {
    const rows = [
      persistedRow({ id: "r1", rowNumber: 2, safeErrorCode: "REGION_AMBIGUOUS" }),
    ];
    const result = recomputePharmacyImportRows(rows, [], []);
    expect(result.rows[0].status).toBe("REGION_PENDING");
    expect(result.rows[0].errorCode).toBe("REGION_AMBIGUOUS");
  });

  it("a legacy row with a server-assigned regionId and no candidate stays resolved to that region", () => {
    const rows = [
      persistedRow({ id: "r1", rowNumber: 2, status: "READY", safeErrorCode: null, regionId: "region-a" }),
    ];
    const result = recomputePharmacyImportRows(rows, [], []);
    expect(result.rows[0].status).toBe("READY");
    expect(result.rows[0].regionId).toBe("region-a");
    expect(result.canImport).toBe(true);
  });
});
