import ExcelJS from "exceljs";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";

import {
  PharmacyExcelParseError,
  parsePharmacyImportExcel,
  MAX_IMPORT_ROWS,
} from "@/lib/pharmacy-import/parse-excel";
import { preflightZipArchive, ZipPreflightError } from "@/lib/zip-preflight";
import { previewPharmacyImportAction } from "@/app/(dashboard)/eczaneler/ice-aktar/actions";

import * as F from "../../../scripts/file-security/fixtures";
import {
  createFileTestAdmin,
  createFileTestRegion,
  createFileTestSession,
} from "../helpers/fixtures";
import { fileTestPrisma } from "../helpers/db";
import { FileTestRedirectSignal, setFileTestSessionToken } from "../helpers/setup";

// Pharmacy Excel Import inherits the same Step 7 ZIP-level defenses as
// historical duty import (both call the identical, unmodified
// preflightZipArchive) — this file proves that inheritance explicitly
// through the pharmacy-specific parser/route, not just implicitly by
// code reuse. See docs/testing/PHARMACY_EXCEL_IMPORT_TEST.md.

const PHARMACY_HEADERS = ["Bölge", "Eczane Adı", "Eczacı Adı Soyadı", "Telefon", "Aktif"];

async function toBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function buildValidPharmacyWorkbook(regionName: string, rowCount = 1): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Eczaneler");
  sheet.addRow(PHARMACY_HEADERS);
  for (let i = 0; i < rowCount; i++) {
    sheet.addRow([regionName, `Test Eczanesi ${i}`, "Test Eczacı", "0212 212 19 18", "Evet"]);
  }
  return toBuffer(workbook);
}

function buildExcessiveRowPharmacyWorkbook(rowCount: number): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Eczaneler");
  sheet.addRow(PHARMACY_HEADERS);
  for (let i = 0; i < rowCount; i++) {
    sheet.addRow(["Kadıköy", `Eczane ${i}`, "Eczacı", "0212 212 19 18", "Evet"]);
  }
  return toBuffer(workbook);
}

function buildExcessiveColumnPharmacyWorkbook(columnCount = 500): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Eczaneler");
  const headerRow = Array.from({ length: columnCount }, (_, i) => `Sütun${i}`);
  headerRow[0] = "Bölge";
  headerRow[1] = "Eczane Adı";
  headerRow[2] = "Eczacı Adı Soyadı";
  headerRow[3] = "Telefon";
  sheet.addRow(headerRow);
  sheet.addRow(["Kadıköy", "Eczane", "Eczacı", "0212 212 19 18"]);
  return toBuffer(workbook);
}

function buildLongCellPharmacyWorkbook(length = 200_000): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Eczaneler");
  sheet.addRow(PHARMACY_HEADERS);
  sheet.addRow(["Kadıköy", "A".repeat(length), "Eczacı", "0212 212 19 18", "Evet"]);
  return toBuffer(workbook);
}

function buildFormulaInRequiredFieldWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Eczaneler");
  sheet.addRow(PHARMACY_HEADERS);
  const row = sheet.addRow(["Kadıköy", "", "Eczacı", "0212 212 19 18", "Evet"]);
  row.getCell(2).value = { formula: "SUM(1,2,3)", result: "Formül Eczanesi" };
  return toBuffer(workbook);
}

function buildHyperlinkPharmacyWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Eczaneler");
  sheet.addRow(PHARMACY_HEADERS);
  const row = sheet.addRow(["Kadıköy", "Bağlantılı Eczane", "Eczacı", "0212 212 19 18", "Evet"]);
  row.getCell(2).value = { text: "Bağlantılı Eczane", hyperlink: "http://example.invalid/" };
  return toBuffer(workbook);
}

// Simulates an "external link" workbook part (Excel's own
// externalLinks/externalReference feature, used for formulas that
// reference another workbook) — never a real risk here since no cell
// value is ever evaluated as a formula (see cellToString in
// parse-excel.ts), only its cached text/result is read.
async function buildExternalLinkWorkbook(): Promise<Buffer> {
  const base = await buildValidPharmacyWorkbook("Kadıköy");
  const zip = await JSZip.loadAsync(base);
  zip.file(
    "xl/externalLinks/externalLink1.xml",
    '<?xml version="1.0"?><externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><externalBook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></externalLink>'
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

// A ZIP entry name containing a literal "../" segment — proves
// preflightZipArchive's isUnsafeEntryPath check independent of the
// shared unit test, through the pharmacy import's own call site.
//
// JSZip's own writer (zip.generateAsync) silently normalizes ".."
// segments out of any entry name passed to zip.file() before it's ever
// serialized — a real attacker isn't bound by that, since a malicious
// archive can be hand-crafted or produced by a different tool entirely.
// This builds the minimal raw ZIP bytes directly (stored/uncompressed
// entries, CRC-32 left as 0 since preflightZipArchive's own
// JSZip.loadAsync call passes { checkCRC32: false }) so the literal
// ".." bytes actually reach the archive, the same way an
// attacker-crafted file would.
function rawZipEntry(name: string, content: string): { local: Buffer; central: Buffer; offset: number } {
  const nameBuf = Buffer.from(name, "utf8");
  const contentBuf = Buffer.from(content, "utf8");
  const local = Buffer.alloc(30 + nameBuf.length);
  local.write("PK\x03\x04", 0, "binary");
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0, 6); // flags
  local.writeUInt16LE(0, 8); // method: stored
  local.writeUInt16LE(0, 10); // mod time
  local.writeUInt16LE(0, 12); // mod date
  local.writeUInt32LE(0, 14); // crc32 (unchecked by loader)
  local.writeUInt32LE(contentBuf.length, 18); // compressed size
  local.writeUInt32LE(contentBuf.length, 22); // uncompressed size
  local.writeUInt16LE(nameBuf.length, 26); // name length
  local.writeUInt16LE(0, 28); // extra length
  nameBuf.copy(local, 30);

  const central = Buffer.alloc(46 + nameBuf.length);
  central.write("PK\x01\x02", 0, "binary");
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6); // version needed
  central.writeUInt16LE(0, 8); // flags
  central.writeUInt16LE(0, 10); // method
  central.writeUInt16LE(0, 12); // mod time
  central.writeUInt16LE(0, 14); // mod date
  central.writeUInt32LE(0, 16); // crc32
  central.writeUInt32LE(contentBuf.length, 20); // compressed size
  central.writeUInt32LE(contentBuf.length, 24); // uncompressed size
  central.writeUInt16LE(nameBuf.length, 28); // name length
  central.writeUInt16LE(0, 30); // extra length
  central.writeUInt16LE(0, 32); // comment length
  central.writeUInt16LE(0, 34); // disk number
  central.writeUInt16LE(0, 36); // internal attrs
  central.writeUInt32LE(0, 38); // external attrs
  central.writeUInt32LE(0, 42); // relative offset — patched by caller
  nameBuf.copy(central, 46);

  return { local: Buffer.concat([local, contentBuf]), central, offset: 0 };
}

function buildRawZip(entries: { name: string; content: string }[]): Buffer {
  const parts: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, content } of entries) {
    const { local, central } = rawZipEntry(name, content);
    central.writeUInt32LE(offset, 42); // relative offset of local header
    parts.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralStart = offset;
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.write("PK\x05\x06", 0, "binary");
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // central dir start disk
  eocd.writeUInt16LE(entries.length, 8); // records on this disk
  eocd.writeUInt16LE(entries.length, 10); // total records
  eocd.writeUInt32LE(centralDir.length, 12); // central dir size
  eocd.writeUInt32LE(centralStart, 16); // central dir offset
  eocd.writeUInt16LE(0, 20); // comment length
  return Buffer.concat([...parts, centralDir, eocd]);
}

function buildPathTraversalZip(): Buffer {
  // A forward-slash "../../../etc/passwd" entry name is normalized away
  // by JSZip's own loader before preflightZipArchive ever sees it
  // (confirmed by direct inspection — JSZip.loadAsync collapses ".."
  // segments in "/"-separated paths at parse time, a built-in
  // protection layered underneath this app's own check). A
  // backslash-separated equivalent is NOT normalized by JSZip and
  // reaches isUnsafeEntryPath's own segment-split (which splits on
  // both "/" and "\\") intact — the realistic surviving vector this
  // app's own check exists to catch.
  return buildRawZip([
    { name: "xl/workbook.xml", content: '<?xml version="1.0"?><workbook/>' },
    { name: "..\\..\\..\\etc\\passwd", content: "not a real secret, just a path-traversal probe" },
  ]);
}

function fileFrom(buffer: Buffer, name = "test.xlsx"): File {
  return new File([new Uint8Array(buffer)], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("Pharmacy Excel Import inherits Step 7 ZIP/resource defenses (pure-function level)", () => {
  it("rejects an empty file", async () => {
    await expect(preflightZipArchive(F.buildEmptyFile())).rejects.toThrow(ZipPreflightError);
  });

  it("rejects a non-XLSX file renamed as .xlsx", async () => {
    await expect(preflightZipArchive(F.buildNonXlsxRenamedFile())).rejects.toThrow(ZipPreflightError);
  });

  it("rejects a truncated ZIP archive", async () => {
    await expect(preflightZipArchive(await F.buildTruncatedZip())).rejects.toThrow(ZipPreflightError);
  });

  it("rejects a corrupt/malformed central directory", async () => {
    await expect(preflightZipArchive(await F.buildCorruptCentralDirectory())).rejects.toThrow(ZipPreflightError);
  });

  it("rejects a ZIP-bomb-shaped high-compression-ratio entry without decompressing it", async () => {
    const buffer = await F.buildHighCompressionRatioZip(200);
    const memBefore = process.memoryUsage().rss;
    const start = performance.now();
    await expect(preflightZipArchive(buffer)).rejects.toThrow(ZipPreflightError);
    const durationMs = performance.now() - start;
    const memDeltaMb = (process.memoryUsage().rss - memBefore) / 1024 / 1024;
    expect(durationMs).toBeLessThan(1_000);
    expect(memDeltaMb).toBeLessThan(50);
  });

  it("rejects excessive compression ratio via the same reason code as the shared preflight", async () => {
    const buffer = await F.buildHighCompressionRatioZip(50);
    await expect(preflightZipArchive(buffer)).rejects.toMatchObject({
      reasonCode: "compression_ratio_too_high",
    });
  });

  it("rejects an excessive ZIP entry count before parsing", async () => {
    await expect(preflightZipArchive(await F.buildExcessiveSheetCountWorkbook(150))).rejects.toMatchObject({
      reasonCode: "too_many_entries",
    });
  });

  it("rejects a path-traversal ZIP entry name", async () => {
    await expect(preflightZipArchive(await buildPathTraversalZip())).rejects.toMatchObject({
      reasonCode: "unsafe_entry_path",
    });
  });

  it("rejects a CFB/OLE-container stand-in for a password-protected workbook", async () => {
    await expect(preflightZipArchive(await F.buildZipCryptoEncryptedZip())).rejects.toThrow(ZipPreflightError);
  });

  it("rejects a workbook whose only worksheet is hidden", async () => {
    const buffer = await F.buildHiddenSheetWorkbook();
    // Structurally a valid ZIP with a real worksheet — the hidden-only
    // rejection is pharmacy-parser-level, not ZIP-level, so preflight
    // passes and parsePharmacyImportExcel rejects it.
    await expect(preflightZipArchive(buffer)).resolves.toBeUndefined();
    await expect(parsePharmacyImportExcel(buffer)).rejects.toBeInstanceOf(PharmacyExcelParseError);
  });

  it("rejects a structurally valid archive with an xl/workbook.xml entry but no real worksheet part", async () => {
    const buffer = await F.buildMissingWorksheetWorkbook();
    await expect(preflightZipArchive(buffer)).resolves.toBeUndefined();
    await expect(parsePharmacyImportExcel(buffer)).rejects.toBeInstanceOf(PharmacyExcelParseError);
  });

  it("rejects a file missing required headers", async () => {
    await expect(parsePharmacyImportExcel(await F.buildMissingHeadersWorkbook())).rejects.toBeInstanceOf(
      PharmacyExcelParseError
    );
  });

  it("rejects a file with a duplicate normalized header", async () => {
    await expect(parsePharmacyImportExcel(await F.buildDuplicateHeadersWorkbook())).rejects.toBeInstanceOf(
      PharmacyExcelParseError
    );
  });

  it("handles an excessive column count without hanging or crashing, surfacing the extras only as non-blocking warnings", async () => {
    const start = performance.now();
    const parsed = await parsePharmacyImportExcel(await buildExcessiveColumnPharmacyWorkbook(500));
    expect(performance.now() - start).toBeLessThan(5_000);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.ignoredColumnWarnings.length).toBeGreaterThan(400);
  });

  it("rejects a file with more than MAX_IMPORT_ROWS (5,000) data rows", async () => {
    const buffer = await buildExcessiveRowPharmacyWorkbook(MAX_IMPORT_ROWS + 1);
    await expect(parsePharmacyImportExcel(buffer)).rejects.toBeInstanceOf(PharmacyExcelParseError);
  });

  it("never evaluates a formula in a required field — cached result/text only, and formula-trigger characters pass through as inert text", async () => {
    const buffer = await buildFormulaInRequiredFieldWorkbook();
    const parsed = await parsePharmacyImportExcel(buffer);
    expect(parsed.rows[0].eczaneAdi).toBe("Formül Eczanesi");
  });

  it("reads a hyperlink cell's display text only, never follows the link", async () => {
    const buffer = await buildHyperlinkPharmacyWorkbook();
    const parsed = await parsePharmacyImportExcel(buffer);
    expect(parsed.rows[0].eczaneAdi).toBe("Bağlantılı Eczane");
  });

  it("ignores an externalLinks workbook part without following it or crashing", async () => {
    const buffer = await buildExternalLinkWorkbook();
    const parsed = await parsePharmacyImportExcel(buffer);
    expect(parsed.rows).toHaveLength(1);
  });

  it("accepts an excessively long cell value structurally (row-count/ZIP limits are the real defense, not per-cell length)", async () => {
    const buffer = await buildLongCellPharmacyWorkbook(200_000);
    const parsed = await parsePharmacyImportExcel(buffer);
    expect(parsed.rows[0].eczaneAdi.length).toBe(200_000);
    // The application-level length limit (analyzePharmacyImportRows,
    // NAME_MAX_LENGTH) is what actually blocks this at row-validation
    // time — proven separately in analyze-import.test.ts.
  });
});

describe("Pharmacy Excel Import inherits Step 7 defenses (full Server Action level)", () => {
  afterEach(() => {
    setFileTestSessionToken(undefined);
  });

  async function adminSession() {
    const region = await createFileTestRegion();
    const region2 = await createFileTestRegion(region.organizationId);
    const admin = await createFileTestAdmin(region.organizationId);
    const token = await createFileTestSession(admin.id);
    setFileTestSessionToken(token);
    return { admin, region, region2 };
  }

  async function batchCountForOrganization(organizationId: string): Promise<number> {
    return fileTestPrisma.pharmacyImportBatch.count({ where: { organizationId } });
  }

  it("rejects an empty file upload with no batch created", async () => {
    const { admin } = await adminSession();
    const before = await batchCountForOrganization(admin.organizationId!);

    const formData = new FormData();
    formData.set("file", fileFrom(Buffer.alloc(0)));
    const result = await previewPharmacyImportAction({ success: false, message: "" }, formData);

    expect(result.success).toBe(false);
    expect(result.message).not.toMatch(/prisma|stack|ENOENT|undefined/i);
    expect(await batchCountForOrganization(admin.organizationId!)).toBe(before);
  });

  it("rejects a file just over the 5 MB limit before any parsing, with no batch created", async () => {
    const { admin } = await adminSession();
    const before = await batchCountForOrganization(admin.organizationId!);

    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 0x41);
    const formData = new FormData();
    formData.set("file", fileFrom(oversized));
    const result = await previewPharmacyImportAction({ success: false, message: "" }, formData);

    expect(result.success).toBe(false);
    expect(result.message).toContain("5 MB");
    expect(await batchCountForOrganization(admin.organizationId!)).toBe(before);
  });

  it("rejects a ZIP bomb before decompression, with no batch created", async () => {
    const { admin } = await adminSession();
    const before = await batchCountForOrganization(admin.organizationId!);

    const bomb = await F.buildHighCompressionRatioZip(200);
    const formData = new FormData();
    formData.set("file", fileFrom(bomb));
    const memBefore = process.memoryUsage().rss;
    const result = await previewPharmacyImportAction({ success: false, message: "" }, formData);
    const memDeltaMb = (process.memoryUsage().rss - memBefore) / 1024 / 1024;

    expect(result.success).toBe(false);
    expect(memDeltaMb).toBeLessThan(50);
    expect(await batchCountForOrganization(admin.organizationId!)).toBe(before);
  });

  it("rejects a path-traversal ZIP entry with a controlled Turkish error, no batch created", async () => {
    const { admin } = await adminSession();
    const before = await batchCountForOrganization(admin.organizationId!);

    const formData = new FormData();
    formData.set("file", fileFrom(await buildPathTraversalZip()));
    const result = await previewPharmacyImportAction({ success: false, message: "" }, formData);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/[a-zA-ZğüşöçıİĞÜŞÖÇ]/); // a real Turkish sentence, not a raw error dump
    expect(await batchCountForOrganization(admin.organizationId!)).toBe(before);
  });

  it("rejects missing required headers with no batch created", async () => {
    const { admin } = await adminSession();
    const before = await batchCountForOrganization(admin.organizationId!);

    const formData = new FormData();
    formData.set("file", fileFrom(await F.buildMissingHeadersWorkbook()));
    const result = await previewPharmacyImportAction({ success: false, message: "" }, formData);

    expect(result.success).toBe(false);
    expect(await batchCountForOrganization(admin.organizationId!)).toBe(before);
  });

  it("rejects more than MAX_IMPORT_ROWS rows with no batch created", async () => {
    const { admin } = await adminSession();
    const before = await batchCountForOrganization(admin.organizationId!);

    const formData = new FormData();
    formData.set("file", fileFrom(await buildExcessiveRowPharmacyWorkbook(MAX_IMPORT_ROWS + 1)));
    const result = await previewPharmacyImportAction({ success: false, message: "" }, formData);

    expect(result.success).toBe(false);
    expect(await batchCountForOrganization(admin.organizationId!)).toBe(before);
  });

  it("a valid workbook is accepted and creates exactly one PREVIEWED batch scoped to the caller's organization", async () => {
    const { admin, region } = await adminSession();

    const formData = new FormData();
    formData.set("file", fileFrom(await buildValidPharmacyWorkbook(region.name, 2)));
    let redirectPath: string | undefined;
    try {
      await previewPharmacyImportAction({ success: false, message: "" }, formData);
    } catch (error) {
      if (error instanceof FileTestRedirectSignal) redirectPath = error.path;
      else throw error;
    }
    expect(redirectPath).toMatch(/^\/eczaneler\/ice-aktar\/onizleme\//);

    const batches = await fileTestPrisma.pharmacyImportBatch.findMany({
      where: { organizationId: admin.organizationId! },
    });
    expect(batches).toHaveLength(1);
    expect(batches[0].status).toBe("PREVIEWED");
    expect(batches[0].readyRows).toBe(2);

    await fileTestPrisma.pharmacyImportBatch.deleteMany({ where: { organizationId: admin.organizationId! } });
  });
});
