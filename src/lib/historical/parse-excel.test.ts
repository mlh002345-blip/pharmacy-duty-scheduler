import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";

import { HistoricalExcelParseError, parseHistoricalExcel } from "./parse-excel";

async function buildWorkbookBuffer(
  headers: string[],
  rows: (string | number | Date)[][]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Sheet1");
  worksheet.addRow(headers);
  for (const row of rows) worksheet.addRow(row);
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe("parseHistoricalExcel", () => {
  it("parses rows using aliased Turkish headers", async () => {
    const buffer = await buildWorkbookBuffer(
      ["Tarih", "Bölge", "Eczane Adı", "Nöbet Türü", "Telefon", "Adres", "Not"],
      [["05.01.2025", "Kadıköy", "Deva Eczanesi", "Normal", "0216 000 00 00", "Bir Sokak", "Test"]]
    );

    const rows = await parseHistoricalExcel(buffer);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tarih: "05.01.2025",
      bolge: "Kadıköy",
      eczaneAdi: "Deva Eczanesi",
      nobetTuru: "Normal",
      telefon: "0216 000 00 00",
      adres: "Bir Sokak",
      not: "Test",
    });
    expect(rows[0].rowNumber).toBe(2);
  });

  it("formats a real Date cell as dd.mm.yyyy text", async () => {
    const buffer = await buildWorkbookBuffer(
      ["Tarih", "Eczane Adı"],
      [[new Date(Date.UTC(2025, 0, 5)), "Deva Eczanesi"]]
    );

    const rows = await parseHistoricalExcel(buffer);
    expect(rows[0].tarih).toBe("05.01.2025");
  });

  it("accepts generic-name column aliases (case/space insensitive)", async () => {
    const buffer = await buildWorkbookBuffer(
      ["tarih", "eczane", "nobet turu"],
      [["05.01.2025", "Deva Eczanesi", "Hafta Sonu"]]
    );

    const rows = await parseHistoricalExcel(buffer);
    expect(rows[0].eczaneAdi).toBe("Deva Eczanesi");
    expect(rows[0].nobetTuru).toBe("Hafta Sonu");
  });

  it("rejects a file missing the required Tarih/Eczane Adı columns", async () => {
    const buffer = await buildWorkbookBuffer(["Bölge", "Telefon"], [["Kadıköy", "0216"]]);
    await expect(parseHistoricalExcel(buffer)).rejects.toThrow(HistoricalExcelParseError);
  });

  it("rejects a file with no data rows", async () => {
    const buffer = await buildWorkbookBuffer(["Tarih", "Eczane Adı"], []);
    await expect(parseHistoricalExcel(buffer)).rejects.toThrow(HistoricalExcelParseError);
  });

  it("rejects an unreadable buffer", async () => {
    await expect(parseHistoricalExcel(Buffer.from("not an xlsx file"))).rejects.toThrow(
      HistoricalExcelParseError
    );
  });

  it("does not execute or expand formula cells — reads the cached result as text", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Sheet1");
    worksheet.addRow(["Tarih", "Eczane Adı"]);
    const row = worksheet.addRow(["05.01.2025", ""]);
    row.getCell(2).value = { formula: "1+1", result: "Deva Eczanesi" };
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const rows = await parseHistoricalExcel(buffer);
    expect(rows[0].eczaneAdi).toBe("Deva Eczanesi");
  });
});
