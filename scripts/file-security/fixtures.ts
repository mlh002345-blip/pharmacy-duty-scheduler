// Deterministic Excel/ZIP fixture generator for Step 7 (Excel/XLSX
// import-export resource/security testing). Fixtures are generated
// on-demand into a gitignored directory — never committed, since some
// are deliberately large (zip-bomb-style, high-row-count).
//
// Usage (from a test or an ad-hoc script):
//   import { buildValidWorkbook, buildZipBomb, ... } from "./fixtures";

import ExcelJS from "exceljs";
import JSZip from "jszip";

export const HEADER_ROW = ["Tarih", "Bölge", "Eczane Adı", "Nöbet Türü", "Telefon", "Adres", "Not"];

async function workbookToBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function addSheet(workbook: ExcelJS.Workbook, name = "Sheet1") {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(HEADER_ROW);
  return sheet;
}

// ---- Valid fixtures --------------------------------------------------

export async function buildSmallValidWorkbook(rowCount = 3): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = addSheet(workbook);
  for (let i = 0; i < rowCount; i++) {
    sheet.addRow([`0${(i % 9) + 1}.01.2026`, "Kadıköy", `Test Eczanesi ${i}`, "Normal", "0555 000 00 00", "Test Adres", ""]);
  }
  return workbookToBuffer(workbook);
}

export async function buildTurkishCharacterWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = addSheet(workbook);
  sheet.addRow(["01.01.2026", "Şişli", "İğdır Öztürk Eczanesi Çağlar", "Nöbetçi", "0555 111 22 33", "Çamlıca Sk. No:5", "Ğüşçöı test notu"]);
  return workbookToBuffer(workbook);
}

export async function buildMultiSheetWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet1 = addSheet(workbook, "Ocak");
  sheet1.addRow(["01.01.2026", "Kadıköy", "Ocak Eczanesi", "Normal", "", "", ""]);
  const sheet2 = workbook.addWorksheet("Şubat");
  sheet2.addRow(["not the expected header row"]);
  return workbookToBuffer(workbook);
}

export async function buildDuplicateRowsWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = addSheet(workbook);
  for (let i = 0; i < 2; i++) {
    sheet.addRow(["01.01.2026", "Kadıköy", "Aynı Eczane", "Normal", "0555 000 00 00", "Aynı Adres", ""]);
  }
  return workbookToBuffer(workbook);
}

export async function buildEmptyTrailingRowsWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = addSheet(workbook);
  sheet.addRow(["01.01.2026", "Kadıköy", "Gerçek Eczane", "Normal", "", "", ""]);
  // exceljs doesn't materialize a truly "empty" row unless a cell is
  // touched — write a row of empty strings to simulate a real trailing
  // blank row a user might leave in a spreadsheet.
  sheet.addRow(["", "", "", "", "", "", ""]);
  sheet.addRow(["", "", "", "", "", "", ""]);
  return workbookToBuffer(workbook);
}

export async function buildDateVariantsWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = addSheet(workbook);
  sheet.addRow(["01.01.2026", "Kadıköy", "Nokta Tarih Eczanesi", "Normal", "", "", ""]);
  sheet.addRow(["2026-01-02", "Kadıköy", "ISO Tarih Eczanesi", "Normal", "", "", ""]);
  sheet.addRow(["3-1-2026", "Kadıköy", "Tire Tarih Eczanesi", "Normal", "", "", ""]);
  const realDateRow = sheet.addRow(["", "Kadıköy", "Gerçek Tarih Eczanesi", "Normal", "", "", ""]);
  realDateRow.getCell(1).value = new Date(Date.UTC(2026, 0, 4));
  return workbookToBuffer(workbook);
}

// ---- Invalid/structurally-broken fixtures ------------------------------

export function buildEmptyFile(): Buffer {
  return Buffer.alloc(0);
}

export function buildNonXlsxRenamedFile(): Buffer {
  return Buffer.from("This is a plain text file pretending to be .xlsx, not a ZIP at all.");
}

export async function buildTruncatedZip(): Promise<Buffer> {
  const valid = await buildSmallValidWorkbook();
  return valid.subarray(0, Math.floor(valid.length / 2));
}

export async function buildCorruptCentralDirectory(): Promise<Buffer> {
  const valid = await buildSmallValidWorkbook();
  const corrupted = Buffer.from(valid);
  // Central directory end record ("End Of Central Directory") is near
  // the tail of a ZIP — corrupt the last 32 bytes to break the
  // structure without producing a merely-truncated file.
  for (let i = Math.max(0, corrupted.length - 32); i < corrupted.length; i++) {
    corrupted[i] = 0x00;
  }
  return corrupted;
}

export async function buildMissingWorksheetWorkbook(): Promise<Buffer> {
  // A structurally valid ZIP with an xl/workbook.xml entry but no real
  // worksheet part — simulates "no expected worksheet" without needing
  // a hand-rolled OOXML writer.
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types/>');
  zip.file("xl/workbook.xml", '<?xml version="1.0"?><workbook/>');
  return zip.generateAsync({ type: "nodebuffer" });
}

export async function buildMissingHeadersWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRow(["Not İlgili Bir Sütun", "Başka Bir Sütun"]);
  sheet.addRow(["x", "y"]);
  return workbookToBuffer(workbook);
}

export async function buildReorderedHeadersWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRow(["Eczane Adı", "Tarih", "Adres", "Bölge"]);
  sheet.addRow(["Ters Sıra Eczanesi", "01.01.2026", "Adres", "Kadıköy"]);
  return workbookToBuffer(workbook);
}

export async function buildDuplicateHeadersWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRow(["Tarih", "Eczane Adı", "Eczane Adı"]);
  sheet.addRow(["01.01.2026", "İlk Değer", "İkinci Değer"]);
  return workbookToBuffer(workbook);
}

export async function buildExcessiveSheetCountWorkbook(sheetCount = 150): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (let i = 0; i < sheetCount; i++) {
    const sheet = workbook.addWorksheet(`Sheet${i}`);
    sheet.addRow(["Tarih", "Eczane Adı"]);
  }
  return workbookToBuffer(workbook);
}

export async function buildExcessiveColumnCountWorkbook(columnCount = 500): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  const headerRow = Array.from({ length: columnCount }, (_, i) => `Sütun${i}`);
  headerRow[0] = "Tarih";
  headerRow[1] = "Eczane Adı";
  sheet.addRow(headerRow);
  return workbookToBuffer(workbook);
}

export async function buildExcessiveRowCountWorkbook(rowCount: number): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = addSheet(workbook);
  for (let i = 0; i < rowCount; i++) {
    sheet.addRow([`0${(i % 9) + 1}.01.2026`, "Kadıköy", `Eczane ${i}`, "Normal", "", "", ""]);
  }
  return workbookToBuffer(workbook);
}

export async function buildLongCellStringWorkbook(length = 200_000): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = addSheet(workbook);
  sheet.addRow(["01.01.2026", "Kadıköy", "A".repeat(length), "Normal", "", "", ""]);
  return workbookToBuffer(workbook);
}

/** Many rows sharing one very long string — stresses exceljs's shared-string table specifically. */
export async function buildSharedStringAmplificationWorkbook(rowCount = 5000, stringLength = 5000): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = addSheet(workbook);
  const longString = "X".repeat(stringLength);
  for (let i = 0; i < rowCount; i++) {
    sheet.addRow([`0${(i % 9) + 1}.01.2026`, "Kadıköy", `Eczane ${i}`, longString, "", "", ""]);
  }
  return workbookToBuffer(workbook);
}

/** A ZIP whose one internal entry compresses at an extreme ratio (classic zip-bomb shape), packaged with a real xl/workbook.xml so it passes a naive "is this an xlsx" sniff. */
export async function buildHighCompressionRatioZip(uncompressedMB = 200): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", '<?xml version="1.0"?><workbook/>');
  zip.file("xl/bomb.xml", Buffer.alloc(uncompressedMB * 1024 * 1024, 0), {
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
  return zip.generateAsync({ type: "nodebuffer" });
}

export async function buildFormulaCellsWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = addSheet(workbook);
  const row = sheet.addRow(["01.01.2026", "Kadıköy", "", "Normal", "", "", ""]);
  row.getCell(3).value = { formula: "SUM(1,2,3)", result: "Formül Eczanesi" };
  return workbookToBuffer(workbook);
}

export async function buildFormulaTriggerCharsWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = addSheet(workbook);
  const payloads = [
    "=HYPERLINK(\"http://evil.example/\",\"click\")",
    "=WEBSERVICE(\"http://evil.example/\")",
    "=cmd|' /C calc'!A0",
    "+SUM(1,2)",
    "-1+2",
    "@SUM(1,2)",
  ];
  for (const payload of payloads) {
    sheet.addRow(["01.01.2026", "Kadıköy", payload, "Normal", "", "", ""]);
  }
  return workbookToBuffer(workbook);
}

export async function buildHyperlinkCellWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = addSheet(workbook);
  const row = sheet.addRow(["01.01.2026", "Kadıköy", "Bağlantılı Eczane", "Normal", "", "", ""]);
  row.getCell(3).value = { text: "Bağlantılı Eczane", hyperlink: "http://example.invalid/" };
  return workbookToBuffer(workbook);
}

export async function buildHiddenSheetWorkbook(veryHidden = false): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  addSheet(workbook, "Görünür");
  const hidden = workbook.addWorksheet("Gizli", {
    state: veryHidden ? "veryHidden" : "hidden",
  });
  hidden.addRow(["01.01.2026", "Kadıköy", "Gizli Eczane", "Normal", "", "", ""]);
  return workbookToBuffer(workbook);
}

export async function buildInvalidDatesWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = addSheet(workbook);
  sheet.addRow(["31.02.2026", "Kadıköy", "İmkansız Tarih Eczanesi", "Normal", "", "", ""]);
  sheet.addRow(["00.00.0000", "Kadıköy", "Sıfır Tarih Eczanesi", "Normal", "", "", ""]);
  sheet.addRow(["not-a-date", "Kadıköy", "Metin Tarih Eczanesi", "Normal", "", "", ""]);
  sheet.addRow(["01.01.9999", "Kadıköy", "Uzak Gelecek Eczanesi", "Normal", "", "", ""]);
  return workbookToBuffer(workbook);
}

export async function buildNumericOverflowWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = addSheet(workbook);
  const row = sheet.addRow(["01.01.2026", "Kadıköy", "Eczane", "Normal", "", "", ""]);
  row.getCell(5).value = Number.MAX_SAFE_INTEGER * 1000; // telefon column, unsafe integer
  return workbookToBuffer(workbook);
}

export async function buildUnicodeControlCharsWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = addSheet(workbook);
  sheet.addRow(["01.01.2026", "Kadıköy", "Kontrol KarakterEczanesi", "Normal", "", "", ""]);
  return workbookToBuffer(workbook);
}

export async function buildCsvFormulaInjectionWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = addSheet(workbook);
  sheet.addRow(["01.01.2026", "Kadıköy", "=1+1", "Normal", "=cmd|'/c calc'!A1", "", ""]);
  return workbookToBuffer(workbook);
}

/** A ZIP-encrypted (traditional ZipCrypto) archive, close to how a password-protected workbook shows up at the ZIP-metadata layer. Real "Encrypt with Password" OOXML files use a different (CFB/OLE) container that isn't a ZIP at all — buildMissingWorksheetWorkbook-style rejection covers that case; this covers the ZIP-crypto flavor for completeness of the metadata-layer check. */
export async function buildZipCryptoEncryptedZip(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", '<?xml version="1.0"?><workbook/>', { compression: "STORE" });
  // JSZip's public API doesn't implement ZipCrypto encryption directly;
  // a real password-protected export from Excel is a completely
  // different (non-ZIP, OLE/CFB) container. Simulate the "not a real
  // xlsx" outcome the app must reject either way by returning a
  // structurally-invalid stand-in that is neither a valid ZIP nor a
  // valid workbook: an OLE/CFB-style magic-number header.
  const cfbMagic = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const filler = Buffer.alloc(512 - cfbMagic.length, 0);
  return Buffer.concat([cfbMagic, filler]);
}
