import * as XLSX from "xlsx";

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

export function parseHistoricalExcel(buffer: Buffer): ImportRowInput[] {
  let workbook: XLSX.WorkBook;
  try {
    // Tarih hücreleri "dd.mm.yyyy" metnine çevrilir; tüm değerler string okunur.
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, raw: false });
  } catch {
    throw new HistoricalExcelParseError(
      "Dosya okunamadı. Lütfen geçerli bir Excel (.xlsx) dosyası yükleyin."
    );
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new HistoricalExcelParseError("Excel dosyasında sayfa bulunamadı.");
  }
  const sheet = workbook.Sheets[sheetName];

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    raw: false,
    dateNF: "dd.mm.yyyy",
    defval: "",
  });

  if (rawRows.length === 0) {
    throw new HistoricalExcelParseError("Excel dosyasında veri satırı bulunamadı.");
  }
  if (rawRows.length > MAX_IMPORT_ROWS) {
    throw new HistoricalExcelParseError(
      `Dosyada ${rawRows.length} satır var; tek seferde en fazla ${MAX_IMPORT_ROWS} satır aktarılabilir. Lütfen dosyayı bölerek yükleyin.`
    );
  }

  // Başlıkları normalize ederek alanlara eşle.
  const firstRow = rawRows[0];
  const headerMap = new Map<string, keyof Omit<ImportRowInput, "rowNumber">>();
  for (const header of Object.keys(firstRow)) {
    const alias = HEADER_ALIASES[normalizeText(header)];
    if (alias) headerMap.set(header, alias);
  }

  const mappedFields = new Set(headerMap.values());
  if (!mappedFields.has("tarih") || !mappedFields.has("eczaneAdi")) {
    throw new HistoricalExcelParseError(
      'Zorunlu sütunlar eksik: dosyada en az "Tarih" ve "Eczane Adı" sütunları bulunmalıdır.'
    );
  }

  return rawRows.map((raw, index) => {
    const row: ImportRowInput = {
      rowNumber: index + 2, // 1. satır başlık
      tarih: "",
      bolge: "",
      eczaneAdi: "",
      nobetTuru: "",
      telefon: "",
      adres: "",
      not: "",
    };
    for (const [header, field] of headerMap) {
      const value = raw[header];
      row[field] = typeof value === "string" ? value : String(value ?? "");
    }
    return row;
  });
}
