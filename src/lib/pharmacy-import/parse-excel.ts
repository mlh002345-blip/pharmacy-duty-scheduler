import ExcelJS from "exceljs";

import { normalizeText } from "@/lib/historical/normalize";
import { MAX_IMPORT_ROWS } from "@/lib/historical/parse-excel";

export { MAX_IMPORT_ROWS };

export class PharmacyExcelParseError extends Error {}

export type PharmacyImportRawRow = {
  rowNumber: number;
  bolge: string;
  ilce: string;
  adres: string;
  eczaneAdi: string;
  eczaciAdi: string;
  telefon: string;
  aktif: string;
};

export type ParsedPharmacyImportFile = {
  rows: PharmacyImportRawRow[];
  // Unrecognized extra columns — never blocking, only surfaced to the
  // ADMIN as an informational note.
  ignoredColumnWarnings: string[];
};

type CanonicalField = keyof Omit<PharmacyImportRawRow, "rowNumber">;

// Every accepted header variant, normalized (trim/collapse-space/
// lowercase/Turkish-aware via normalizeText) -> canonical field. Two
// different variants mapping to the same field is fine (e.g. "Bölge"
// and "Bolge"); two DIFFERENT canonical fields sharing a normalized
// header string would be a real ambiguity — not possible here since
// every alias below is unique — but is still guarded against explicitly
// in parsePharmacyImportExcel for column headers repeated verbatim in
// the same file.
const HEADER_ALIASES: Record<string, CanonicalField> = {
  "bölge": "bolge",
  "bolge": "bolge",
  "nöbet bölgesi": "bolge",
  "nobet bolgesi": "bolge",
  "nöbet bolgesi": "bolge",
  "nobet bölgesi": "bolge",
  // İlçe is its OWN canonical field now (region discovery uses it as a
  // fallback region source when Bölge is blank). Old files that used an
  // "İlçe" header as their region column keep working: their values flow
  // through the İlçe field and resolve to the same region candidates.
  "ilçe": "ilce",
  "ilce": "ilce",
  // Turkish-locale-lowercasing an ASCII "I" (no dot) yields "ı" (dotless
  // lowercase i), not "i" — "Ilce" therefore normalizes differently from
  // "İlçe" (dotted capital İ, which lowercases to plain "i").
  "ılce": "ilce",
  "ilçe/il": "ilce",
  "ilce/il": "ilce",
  "ılce/ıl": "ilce",
  "ilçe / il": "ilce",
  "ilce / il": "ilce",
  "ılce / ıl": "ilce",
  "ilçe adı": "ilce",
  "ilçe adi": "ilce",
  "ilce adı": "ilce",
  "ilce adi": "ilce",
  "ılce adı": "ilce",
  "ılce adi": "ilce",
  "adres": "adres",
  "eczane adresi": "adres",
  "açık adres": "adres",
  "acik adres": "adres",
  "açik adres": "adres",
  "acık adres": "adres",
  "eczane": "eczaneAdi",
  "eczane adı": "eczaneAdi",
  "eczane adi": "eczaneAdi",
  "eczacı": "eczaciAdi",
  "eczaci": "eczaciAdi",
  "eczacı adı soyadı": "eczaciAdi",
  "eczaci adi soyadi": "eczaciAdi",
  "telefon": "telefon",
  "telefon no": "telefon",
  "telefon numarası": "telefon",
  "telefon numarasi": "telefon",
  "aktif": "aktif",
  "aktiflik": "aktif",
  "durum": "aktif",
};

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
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

export async function parsePharmacyImportExcel(buffer: Buffer): Promise<ParsedPharmacyImportFile> {
  const workbook = new ExcelJS.Workbook();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see parse-excel.ts in historical import for the same exceljs/@types/node Buffer conflict
    await workbook.xlsx.load(buffer as any);
  } catch {
    throw new PharmacyExcelParseError(
      "Dosya okunamadı. Lütfen geçerli bir Excel (.xlsx) dosyası yükleyin."
    );
  }

  // Only a visible worksheet may supply data — a workbook whose only
  // sheet(s) are hidden is treated the same as having no worksheet at
  // all, rather than silently importing from a sheet the ADMIN cannot
  // see or verify.
  const worksheet = workbook.worksheets.find((sheet) => sheet.state === "visible");
  if (!worksheet) {
    throw new PharmacyExcelParseError("Excel dosyasında görünür bir sayfa bulunamadı.");
  }

  const headerRow = worksheet.getRow(1);
  const headerByColumn = new Map<number, string>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const text = cellToString(cell.value).trim();
    if (text) headerByColumn.set(colNumber, text);
  });

  const headerMap = new Map<number, CanonicalField>();
  const seenNormalizedHeaders = new Set<string>();
  const ignoredColumnWarnings: string[] = [];

  for (const [colNumber, header] of headerByColumn) {
    const normalized = normalizeText(header);
    if (seenNormalizedHeaders.has(normalized)) {
      throw new PharmacyExcelParseError(
        `"${header}" sütun başlığı dosyada birden fazla kez kullanılmış. Lütfen yinelenen başlıkları düzeltin.`
      );
    }
    seenNormalizedHeaders.add(normalized);

    const canonical = HEADER_ALIASES[normalized];
    if (canonical) {
      // A canonical field mapped by more than one column in the same
      // file is an unresolvable ambiguity (which column's value should
      // win?) — blocking, not a silent last-write-wins.
      const alreadyMappedColumn = [...headerMap.entries()].find(([, field]) => field === canonical);
      if (alreadyMappedColumn) {
        throw new PharmacyExcelParseError(
          `"${header}" sütunu, zaten eşleştirilmiş bir alanla (${headerByColumn.get(alreadyMappedColumn[0])}) çakışıyor. Lütfen belirsiz başlıkları düzeltin.`
        );
      }
      headerMap.set(colNumber, canonical);
    } else {
      ignoredColumnWarnings.push(`"${header}" sütunu tanınmadı ve yok sayıldı.`);
    }
  }

  const mappedFields = new Set(headerMap.values());
  const requiredFields: CanonicalField[] = ["eczaneAdi", "eczaciAdi", "telefon"];
  const missingFields = requiredFields.filter((field) => !mappedFields.has(field));
  if (missingFields.length > 0) {
    throw new PharmacyExcelParseError(
      'Zorunlu sütunlar eksik: dosyada "Eczane Adı", "Eczacı Adı Soyadı" ve "Telefon" sütunları bulunmalıdır.'
    );
  }
  // Region discovery needs at least ONE region source column: Bölge,
  // İlçe, or Adres. A file with none of them can never resolve any row
  // to a region — blocked at parse time with a clear message. (Old
  // templates always carried a Bölge or İlçe header, so they keep
  // working unchanged.)
  if (!mappedFields.has("bolge") && !mappedFields.has("ilce") && !mappedFields.has("adres")) {
    throw new PharmacyExcelParseError(
      'Bölge kaynağı eksik: dosyada "Bölge", "İlçe" veya "Adres" sütunlarından en az biri bulunmalıdır.'
    );
  }

  const rows: PharmacyImportRawRow[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // başlık satırı

    const parsedRow: PharmacyImportRawRow = {
      rowNumber,
      bolge: "",
      ilce: "",
      adres: "",
      eczaneAdi: "",
      eczaciAdi: "",
      telefon: "",
      aktif: "",
    };
    for (const [colNumber, field] of headerMap) {
      const cell = row.getCell(colNumber);
      parsedRow[field] = cellToString(cell.value);
    }
    rows.push(parsedRow);
  });

  if (rows.length === 0) {
    throw new PharmacyExcelParseError("Excel dosyasında veri satırı bulunamadı.");
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new PharmacyExcelParseError(
      `Dosyada ${rows.length} satır var; tek seferde en fazla ${MAX_IMPORT_ROWS} satır aktarılabilir. Lütfen dosyayı bölerek yükleyin.`
    );
  }

  return { rows, ignoredColumnWarnings };
}
