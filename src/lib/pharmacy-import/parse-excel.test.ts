import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";

import { PharmacyExcelParseError, parsePharmacyImportExcel } from "./parse-excel";

async function buildWorkbookBuffer(
  headers: string[],
  rows: (string | number)[][],
  options: { sheetState?: "visible" | "hidden" | "veryHidden" } = {}
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Sheet1", { state: options.sheetState ?? "visible" });
  worksheet.addRow(headers);
  for (const row of rows) worksheet.addRow(row);
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

const CANONICAL_HEADERS = ["Bölge", "Eczane Adı", "Eczacı Adı Soyadı", "Telefon", "Aktif"];

describe("parsePharmacyImportExcel", () => {
  it("parses rows using the canonical headers", async () => {
    const buffer = await buildWorkbookBuffer(CANONICAL_HEADERS, [
      ["Kadıköy", "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "Evet"],
    ]);

    const result = await parsePharmacyImportExcel(buffer);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      rowNumber: 2,
      bolge: "Kadıköy",
      eczaneAdi: "Deva Eczanesi",
      eczaciAdi: "Ada Yılmaz",
      telefon: "0212 212 19 18",
      aktif: "Evet",
    });
    expect(result.ignoredColumnWarnings).toEqual([]);
  });

  it.each([
    ["Bolge", "Bölge"],
    ["İlçe", "Bölge"],
    ["Ilce", "Bölge"],
    ["İlçe/İl", "Bölge"],
    ["İlçe / İl", "Bölge"],
    ["Eczane", "Eczane Adı"],
    ["Eczane Adi", "Eczane Adı"],
    ["Eczaci", "Eczacı Adı Soyadı"],
    ["Eczaci Adi Soyadi", "Eczacı Adı Soyadı"],
    ["Telefon No", "Telefon"],
    ["Telefon Numarası", "Telefon"],
    ["Aktiflik", "Aktif"],
    ["Durum", "Aktif"],
  ])("accepts the header variant %s as an alias for %s", async (variant, canonical) => {
    const headers = CANONICAL_HEADERS.map((h) => (h === canonical ? variant : h));
    const buffer = await buildWorkbookBuffer(headers, [
      ["Kadıköy", "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "Evet"],
    ]);
    const result = await parsePharmacyImportExcel(buffer);
    expect(result.rows).toHaveLength(1);
  });

  it("rejects a file missing a required header", async () => {
    const buffer = await buildWorkbookBuffer(
      ["Bölge", "Eczane Adı", "Telefon", "Aktif"],
      [["Kadıköy", "Deva Eczanesi", "0212 212 19 18", "Evet"]]
    );
    await expect(parsePharmacyImportExcel(buffer)).rejects.toBeInstanceOf(PharmacyExcelParseError);
  });

  it("rejects a file with a duplicate normalized header", async () => {
    const buffer = await buildWorkbookBuffer(
      ["Bölge", "Bolge", "Eczane Adı", "Eczacı Adı Soyadı", "Telefon"],
      [["Kadıköy", "Kadıköy", "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18"]]
    );
    await expect(parsePharmacyImportExcel(buffer)).rejects.toBeInstanceOf(PharmacyExcelParseError);
  });

  it("rejects a file where two different header variants map to the same field (ambiguous)", async () => {
    const buffer = await buildWorkbookBuffer(
      ["Bölge", "İlçe", "Eczane Adı", "Eczacı Adı Soyadı", "Telefon"],
      [["Kadıköy", "Beşiktaş", "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18"]]
    );
    await expect(parsePharmacyImportExcel(buffer)).rejects.toBeInstanceOf(PharmacyExcelParseError);
  });

  it("surfaces an unrecognized extra column as a non-blocking warning", async () => {
    const buffer = await buildWorkbookBuffer(
      [...CANONICAL_HEADERS, "Notlar"],
      [["Kadıköy", "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "Evet", "serbest metin"]]
    );
    const result = await parsePharmacyImportExcel(buffer);
    expect(result.rows).toHaveLength(1);
    expect(result.ignoredColumnWarnings).toHaveLength(1);
    expect(result.ignoredColumnWarnings[0]).toContain("Notlar");
  });

  it("rejects a workbook whose only worksheet is hidden", async () => {
    const buffer = await buildWorkbookBuffer(
      CANONICAL_HEADERS,
      [["Kadıköy", "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "Evet"]],
      { sheetState: "hidden" }
    );
    await expect(parsePharmacyImportExcel(buffer)).rejects.toBeInstanceOf(PharmacyExcelParseError);
  });

  it("rejects a file with no data rows", async () => {
    const buffer = await buildWorkbookBuffer(CANONICAL_HEADERS, []);
    await expect(parsePharmacyImportExcel(buffer)).rejects.toBeInstanceOf(PharmacyExcelParseError);
  });

  it("rejects a corrupt (non-Excel) buffer", async () => {
    const buffer = Buffer.from("not an excel file");
    await expect(parsePharmacyImportExcel(buffer)).rejects.toBeInstanceOf(PharmacyExcelParseError);
  });

  it("rejects a file with more than MAX_IMPORT_ROWS data rows", async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => [
      "Kadıköy",
      `Eczane ${i}`,
      "Ada Yılmaz",
      "0212 212 19 18",
      "Evet",
    ]);
    const buffer = await buildWorkbookBuffer(CANONICAL_HEADERS, rows);
    await expect(parsePharmacyImportExcel(buffer)).rejects.toBeInstanceOf(PharmacyExcelParseError);
  });
});
