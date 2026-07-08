import ExcelJS from "exceljs";

import { normalizeText } from "./normalize";
import type { ImportRowInput } from "./analyze-import";

// Tek seferde içe aktarılabilecek azami satır sayısı (bellek/istek koruması).
export const MAX_IMPORT_ROWS = 5000;

export class HistoricalExcelParseError extends Error {}

// Başlık eşleştirme: boşluk/büyük-küçük harf duyarsız, yaygın eş anlamlılar.
const HEADER_ALIASES: Record<string, keyof Omit<ImportRowInput, "rowNumber">> = {
  tarih: "tarih",
  "bölge": "bolge",
  bolge: "bolge",
  "eczane adı": "eczaneAdi",
  "eczane adi": "eczaneAdi",
  eczane: "eczaneAdi",
  "nöbet türü": "nobetTuru",
  "nobet turu": "nobetTuru",
  "nöbet tipi": "nobetTuru",
  telefon: "telefon",
  adres: "adres",
  not: "not",
  "açıklama": "not",
};

// Tarih hücreleri (gerçek Date olarak saklanmışsa) "dd.mm.yyyy" metnine
// çevrilir; formül hücrelerinde önbelleğe alınmış sonuç, zengin metin
// hücrelerinde düz metin kullanılır. Hiçbir hücre içeriği yorumlanmaz/
// çalıştırılmaz — yalnızca metne dönüştürülür.
function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const day = String(value.getUTCDate()).padStart(2, "0");
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const year = value.getUTCFullYear();
    return `${day}.${month}.${year}`;
  }
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("text" in value && typeof value.text === "string") {
      return value.text;
    }
    if ("result" in value) {
      return cellToString(value.result as ExcelJS.CellValue);
    }
    if ("error" in value) {
      return "";
    }
    if ("hyperlink" in value && typeof value.hyperlink === "string") {
      return value.hyperlink;
    }
    return "";
  }
  return String(value);
}

export async function parseHistoricalExcel(buffer: Buffer): Promise<ImportRowInput[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs bundles its own (older) @types/node via a transitive
    // dependency (fast-csv), whose ambient Buffer type structurally
    // conflicts with this project's @types/node — a types-only collision,
    // not a runtime issue (Buffer is Buffer at runtime), so bypassing the
    // check here is the pragmatic fix.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buffer as any);
  } catch {
    throw new HistoricalExcelParseError(
      "Dosya okunamadı. Lütfen geçerli bir Excel (.xlsx) dosyası yükleyin."
    );
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new HistoricalExcelParseError("Excel dosyasında sayfa bulunamadı.");
  }

  const headerRow = worksheet.getRow(1);
  const headerByColumn = new Map<number, string>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const text = cellToString(cell.value).trim();
    if (text) headerByColumn.set(colNumber, text);
  });

  const headerMap = new Map<number, keyof Omit<ImportRowInput, "rowNumber">>();
  for (const [colNumber, header] of headerByColumn) {
    const alias = HEADER_ALIASES[normalizeText(header)];
    if (alias) headerMap.set(colNumber, alias);
  }

  const mappedFields = new Set(headerMap.values());
  if (!mappedFields.has("tarih") || !mappedFields.has("eczaneAdi")) {
    throw new HistoricalExcelParseError(
      'Zorunlu sütunlar eksik: dosyada en az "Tarih" ve "Eczane Adı" sütunları bulunmalıdır.'
    );
  }

  const rows: ImportRowInput[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // başlık satırı

    const parsedRow: ImportRowInput = {
      rowNumber,
      tarih: "",
      bolge: "",
      eczaneAdi: "",
      nobetTuru: "",
      telefon: "",
      adres: "",
      not: "",
    };
    for (const [colNumber, field] of headerMap) {
      const cell = row.getCell(colNumber);
      parsedRow[field] = cellToString(cell.value);
    }
    rows.push(parsedRow);
  });

  if (rows.length === 0) {
    throw new HistoricalExcelParseError("Excel dosyasında veri satırı bulunamadı.");
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new HistoricalExcelParseError(
      `Dosyada ${rows.length} satır var; tek seferde en fazla ${MAX_IMPORT_ROWS} satır aktarılabilir. Lütfen dosyayı bölerek yükleyin.`
    );
  }

  return rows;
}
