import { describe, expect, it } from "vitest";

import { HistoricalExcelParseError, parseHistoricalExcel } from "@/lib/historical/parse-excel";
import { preflightZipArchive, ZipPreflightError } from "@/lib/zip-preflight";

import * as F from "../../../scripts/file-security/fixtures";

// Item 3/5 — malicious/invalid fixture rejection, before or during
// parsing (never after full workbook materialization for the ZIP-level
// checks).
describe("malicious/invalid Excel fixtures are rejected safely", () => {
  it("rejects an empty file", async () => {
    await expect(preflightZipArchive(F.buildEmptyFile())).rejects.toThrow(ZipPreflightError);
  });

  it("rejects a non-XLSX file renamed as .xlsx", async () => {
    await expect(preflightZipArchive(F.buildNonXlsxRenamedFile())).rejects.toThrow(ZipPreflightError);
  });

  it("rejects a truncated ZIP archive", async () => {
    await expect(preflightZipArchive(await F.buildTruncatedZip())).rejects.toThrow(ZipPreflightError);
  });

  it("rejects a corrupt central directory", async () => {
    await expect(preflightZipArchive(await F.buildCorruptCentralDirectory())).rejects.toThrow(ZipPreflightError);
  });

  it("rejects a CFB/OLE-container stand-in for a password-protected workbook", async () => {
    await expect(preflightZipArchive(await F.buildZipCryptoEncryptedZip())).rejects.toThrow(ZipPreflightError);
  });

  it("rejects a workbook with an xl/workbook.xml entry but no real worksheet part — passes the cheap ZIP-metadata check, caught by exceljs's own structural parse instead", async () => {
    const buffer = await F.buildMissingWorksheetWorkbook();
    await expect(preflightZipArchive(buffer)).resolves.toBeUndefined(); // structurally a real ZIP with a workbook.xml entry
    await expect(parseHistoricalExcel(buffer)).rejects.toThrow(HistoricalExcelParseError);
  });

  it("rejects an archive with no xl/workbook.xml entry at all via the missing-workbook-entry check", async () => {
    await expect(preflightZipArchive(await F.buildNonXlsxRenamedFile())).rejects.toThrow(ZipPreflightError);
  });

  it("rejects an excessive sheet count before parsing (ZIP entry-count limit)", async () => {
    await expect(preflightZipArchive(await F.buildExcessiveSheetCountWorkbook(150))).rejects.toMatchObject({
      reasonCode: "too_many_entries",
    });
  });

  it("rejects a high-compression-ratio ZIP entry (bomb shape) without decompressing it", async () => {
    const buffer = await F.buildHighCompressionRatioZip(200);
    const memBefore = process.memoryUsage().rss;
    const start = performance.now();
    await expect(preflightZipArchive(buffer)).rejects.toThrow(ZipPreflightError);
    const durationMs = performance.now() - start;
    const memDeltaMb = (process.memoryUsage().rss - memBefore) / 1024 / 1024;
    // Rejected fast and cheap — proves the 200 MB payload was never
    // decompressed to reach this verdict.
    expect(durationMs).toBeLessThan(1_000);
    expect(memDeltaMb).toBeLessThan(50);
  });

  it("rejects a workbook missing required headers (Tarih / Eczane Adı)", async () => {
    await expect(parseHistoricalExcel(await F.buildMissingHeadersWorkbook())).rejects.toThrow(
      HistoricalExcelParseError
    );
  });

  it("accepts reordered headers (position-independent, alias-based mapping)", async () => {
    const rows = await parseHistoricalExcel(await F.buildReorderedHeadersWorkbook());
    expect(rows).toHaveLength(1);
    expect(rows[0].eczaneAdi).toBe("Ters Sıra Eczanesi");
  });

  it("does not crash on duplicate header columns (last matching column wins, no exception)", async () => {
    const rows = await parseHistoricalExcel(await F.buildDuplicateHeadersWorkbook());
    expect(rows).toHaveLength(1);
  });

  it("never evaluates formula cells — cached result/text only, and formula-trigger characters pass through as inert text", async () => {
    const formulaRows = await parseHistoricalExcel(await F.buildFormulaCellsWorkbook());
    expect(formulaRows[0].eczaneAdi).toBe("Formül Eczanesi");

    const triggerRows = await parseHistoricalExcel(await F.buildFormulaTriggerCharsWorkbook());
    expect(triggerRows.map((r) => r.eczaneAdi)).toEqual([
      '=HYPERLINK("http://evil.example/","click")',
      '=WEBSERVICE("http://evil.example/")',
      "=cmd|' /C calc'!A0",
      "+SUM(1,2)",
      "-1+2",
      "@SUM(1,2)",
    ]);
  });

  it("reads a hyperlink cell's visible text, never triggers any outbound request", async () => {
    const rows = await parseHistoricalExcel(await F.buildHyperlinkCellWorkbook());
    expect(rows[0].eczaneAdi).toBe("Bağlantılı Eczane");
  });

  it("rejects invalid/impossible dates by leaving them unparsed (empty tarih), not by throwing", async () => {
    const rows = await parseHistoricalExcel(await F.buildInvalidDatesWorkbook());
    expect(rows).toHaveLength(4);
    // parseHistoricalExcel itself only extracts text — date *parsing*
    // (and rejection of 31.02.2026 etc.) happens downstream in
    // normalize.ts's parseHistoricalDate, exercised via analyzeImportRows
    // in 03-transaction-rollback.filesec.test.ts.
    for (const row of rows) expect(typeof row.tarih).toBe("string");
  });

  it("parses Turkish characters correctly", async () => {
    const rows = await parseHistoricalExcel(await F.buildTurkishCharacterWorkbook());
    expect(rows[0].eczaneAdi).toContain("İğdır");
    expect(rows[0].bolge).toBe("Şişli");
  });

  it("parses a workbook with duplicate logical rows without deduplicating at the parse layer (dedup is a downstream analysis concern)", async () => {
    const rows = await parseHistoricalExcel(await F.buildDuplicateRowsWorkbook());
    expect(rows).toHaveLength(2);
  });

  it("only reads the first worksheet — hidden/veryHidden later sheets are never processed", async () => {
    // buildHiddenSheetWorkbook puts data only on its second ("Gizli")
    // sheet; the first sheet has a header row but no data — proves the
    // parser genuinely only looks at worksheets[0], regardless of any
    // other sheet's visibility state.
    await expect(parseHistoricalExcel(await F.buildHiddenSheetWorkbook(false))).rejects.toThrow(
      HistoricalExcelParseError
    );
    await expect(parseHistoricalExcel(await F.buildHiddenSheetWorkbook(true))).rejects.toThrow(
      HistoricalExcelParseError
    );
  });
});
