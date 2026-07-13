// Pure row-validation/matching for the Pharmacy Excel Import feature.
// No Prisma access here — the caller supplies this organization's own
// regions/pharmacies as plain arrays (already fetched org-scoped), so
// this module can never see, and therefore can never match against,
// another organization's data. See
// docs/features/PHARMACY_EXCEL_IMPORT.md.

import { normalizeText } from "@/lib/historical/normalize";
import { normalizePhoneNumber } from "./phone";
import type { PharmacyImportRawRow } from "./parse-excel";

const CONTROL_CHAR_PATTERN = /[\x00-\x1f\x7f]/;

const NAME_MAX_LENGTH = 200;

export type PharmacyImportRowStatus =
  | "READY"
  | "INVALID"
  | "DUPLICATE_IN_FILE"
  | "ALREADY_EXISTS"
  | "UNKNOWN_REGION";

// Persisted verbatim to PharmacyImportRow.safeErrorCode — a small,
// stable identifier, never the raw uploaded cell text, so the preview
// page can reconstruct a Turkish message after a redirect without
// retaining more of the original file's content than necessary.
export type PharmacyRowErrorCode =
  | "PHARMACY_NAME_REQUIRED"
  | "PHARMACY_NAME_INVALID_CHARACTERS"
  | "PHARMACY_NAME_TOO_LONG"
  | "PHARMACIST_NAME_REQUIRED"
  | "PHARMACIST_NAME_INVALID_CHARACTERS"
  | "PHARMACIST_NAME_TOO_LONG"
  | "PHONE_MISSING_DEFAULT_AREA_CODE"
  | "PHONE_INVALID_DEFAULT_AREA_CODE"
  | "PHONE_UNRECOGNIZED"
  | "AKTIF_UNRECOGNIZED"
  | "REGION_REQUIRED"
  | "REGION_NOT_FOUND"
  | "DUPLICATE_IN_FILE"
  | "ALREADY_EXISTS";

export type AnalyzedPharmacyImportRow = {
  rowNumber: number;
  rawBolge: string;
  rawEczaneAdi: string;
  rawEczaciAdi: string;
  rawTelefon: string;
  rawAktif: string;
  normalizedPharmacyName: string | null;
  pharmacistName: string | null;
  phone: string | null;
  isActive: boolean;
  matchedRegionId: string | null;
  matchedRegionName: string | null;
  status: PharmacyImportRowStatus;
  errorCode: PharmacyRowErrorCode | null;
  messages: string[];
};

export type PharmacyImportAnalysis = {
  rows: AnalyzedPharmacyImportRow[];
  totalCount: number;
  readyCount: number;
  invalidCount: number;
  // All-or-nothing: every row must resolve to READY before the batch may
  // be imported (mirrors the historical-duty-import convention of
  // canImport = errorCount === 0, generalized to every non-READY status
  // here since this feature has no "importable with warnings" state).
  canImport: boolean;
};

export type PharmacyImportMatchContext = {
  regions: { id: string; name: string }[];
  // Existing pharmacies for THIS organization only, keyed by
  // normalizedName + regionId — never a global/cross-tenant lookup.
  existingPharmacies: { normalizedName: string; regionId: string }[];
  defaultAreaCode: string | null;
};

function parseAktifValue(raw: string): boolean | null {
  const value = raw.trim().toLocaleLowerCase("tr");
  if (value === "") return true;
  if (["evet", "true", "1", "aktif"].includes(value)) return true;
  if (["hayır", "hayir", "false", "0", "pasif"].includes(value)) return false;
  return null;
}

export function analyzePharmacyImportRows(
  inputRows: PharmacyImportRawRow[],
  context: PharmacyImportMatchContext
): PharmacyImportAnalysis {
  const regionByName = new Map(
    context.regions.map((region) => [normalizeText(region.name), region])
  );
  const existingKeys = new Set(
    context.existingPharmacies.map((p) => `${p.regionId}|${p.normalizedName}`)
  );
  const seenInFile = new Set<string>();

  const rows: AnalyzedPharmacyImportRow[] = inputRows.map((input) => {
    const messages: string[] = [];
    let fieldsValid = true;
    let errorCode: PharmacyRowErrorCode | null = null;
    const markInvalid = (code: PharmacyRowErrorCode, message: string) => {
      messages.push(message);
      if (fieldsValid) errorCode = code; // first failure wins
      fieldsValid = false;
    };

    const eczaneAdi = input.eczaneAdi.trim().replace(/\s+/g, " ");
    const eczaciAdi = input.eczaciAdi.trim().replace(/\s+/g, " ");
    const bolge = input.bolge.trim().replace(/\s+/g, " ");

    if (!eczaneAdi) {
      markInvalid("PHARMACY_NAME_REQUIRED", "Eczane adı boş olamaz.");
    } else if (CONTROL_CHAR_PATTERN.test(eczaneAdi)) {
      markInvalid("PHARMACY_NAME_INVALID_CHARACTERS", "Eczane adı geçersiz karakter içeriyor.");
    } else if (eczaneAdi.length > NAME_MAX_LENGTH) {
      markInvalid("PHARMACY_NAME_TOO_LONG", `Eczane adı en fazla ${NAME_MAX_LENGTH} karakter olabilir.`);
    }

    if (!eczaciAdi) {
      markInvalid("PHARMACIST_NAME_REQUIRED", "Eczacı adı soyadı boş olamaz.");
    } else if (CONTROL_CHAR_PATTERN.test(eczaciAdi)) {
      markInvalid("PHARMACIST_NAME_INVALID_CHARACTERS", "Eczacı adı soyadı geçersiz karakter içeriyor.");
    } else if (eczaciAdi.length > NAME_MAX_LENGTH) {
      markInvalid(
        "PHARMACIST_NAME_TOO_LONG",
        `Eczacı adı soyadı en fazla ${NAME_MAX_LENGTH} karakter olabilir.`
      );
    }

    let normalizedPhone: string | null = null;
    const phoneResult = normalizePhoneNumber(input.telefon.trim(), context.defaultAreaCode);
    if (!phoneResult.ok) {
      if (phoneResult.errorCode === "missing_default_area_code") {
        markInvalid(
          "PHONE_MISSING_DEFAULT_AREA_CODE",
          "Telefon numarası 7 haneli ve alan kodu içermiyor; İçe Aktarma formunda Varsayılan Alan Kodu girilmelidir."
        );
      } else if (phoneResult.errorCode === "invalid_default_area_code") {
        markInvalid("PHONE_INVALID_DEFAULT_AREA_CODE", "Varsayılan Alan Kodu 3 haneli bir sayı olmalıdır.");
      } else {
        markInvalid("PHONE_UNRECOGNIZED", "Telefon numarası anlaşılamadı.");
      }
    } else {
      normalizedPhone = phoneResult.value;
    }

    const aktifValue = parseAktifValue(input.aktif);
    let isActive = true;
    if (aktifValue === null) {
      markInvalid(
        "AKTIF_UNRECOGNIZED",
        'Aktif sütunu anlaşılamadı. Kabul edilen değerler: "Evet/Hayır", "true/false", "1/0", "Aktif/Pasif" veya boş.'
      );
    } else {
      isActive = aktifValue;
    }

    let matchedRegion: { id: string; name: string } | null = null;
    if (!bolge) {
      markInvalid("REGION_REQUIRED", "Bölge boş olamaz.");
    } else {
      matchedRegion = regionByName.get(normalizeText(bolge)) ?? null;
      if (!matchedRegion) {
        // Never auto-created — an unmatched region name is always
        // blocking, and only ever matched against this organization's
        // own region list (context.regions), so an identically-named
        // region in another organization can never satisfy this.
        messages.push(`"${bolge}" bölgesi bu odada tanımlı değil.`);
      }
    }

    const normalizedPharmacyName = eczaneAdi ? normalizeText(eczaneAdi) : null;

    let status: PharmacyImportRowStatus;
    if (!fieldsValid) {
      status = "INVALID";
    } else if (!matchedRegion) {
      status = "UNKNOWN_REGION";
      errorCode = "REGION_NOT_FOUND";
    } else {
      const key = `${matchedRegion.id}|${normalizedPharmacyName}`;
      if (seenInFile.has(key)) {
        status = "DUPLICATE_IN_FILE";
        errorCode = "DUPLICATE_IN_FILE";
        messages.push("Bu eczane, dosyada aynı bölge için daha önce de yer alıyor.");
      } else if (existingKeys.has(key)) {
        status = "ALREADY_EXISTS";
        errorCode = "ALREADY_EXISTS";
        messages.push("Bu eczane, seçilen bölgede zaten kayıtlı (V1'de mevcut kayıtlar güncellenmez).");
      } else {
        status = "READY";
        seenInFile.add(key);
      }
    }

    return {
      rowNumber: input.rowNumber,
      rawBolge: bolge,
      rawEczaneAdi: eczaneAdi,
      rawEczaciAdi: eczaciAdi,
      rawTelefon: input.telefon.trim(),
      rawAktif: input.aktif.trim(),
      normalizedPharmacyName,
      pharmacistName: fieldsValid ? eczaciAdi : null,
      phone: normalizedPhone,
      isActive,
      matchedRegionId: matchedRegion?.id ?? null,
      matchedRegionName: matchedRegion?.name ?? null,
      status,
      errorCode,
      messages,
    };
  });

  const readyCount = rows.filter((r) => r.status === "READY").length;
  const invalidCount = rows.length - readyCount;

  return {
    rows,
    totalCount: rows.length,
    readyCount,
    invalidCount,
    canImport: rows.length > 0 && readyCount === rows.length,
  };
}

const ERROR_CODE_MESSAGES: Record<PharmacyRowErrorCode, string> = {
  PHARMACY_NAME_REQUIRED: "Eczane adı boş olamaz.",
  PHARMACY_NAME_INVALID_CHARACTERS: "Eczane adı geçersiz karakter içeriyor.",
  PHARMACY_NAME_TOO_LONG: `Eczane adı en fazla ${NAME_MAX_LENGTH} karakter olabilir.`,
  PHARMACIST_NAME_REQUIRED: "Eczacı adı soyadı boş olamaz.",
  PHARMACIST_NAME_INVALID_CHARACTERS: "Eczacı adı soyadı geçersiz karakter içeriyor.",
  PHARMACIST_NAME_TOO_LONG: `Eczacı adı soyadı en fazla ${NAME_MAX_LENGTH} karakter olabilir.`,
  PHONE_MISSING_DEFAULT_AREA_CODE:
    "Telefon numarası 7 haneli ve alan kodu içermiyor; İçe Aktarma formunda Varsayılan Alan Kodu girilmelidir.",
  PHONE_INVALID_DEFAULT_AREA_CODE: "Varsayılan Alan Kodu 3 haneli bir sayı olmalıdır.",
  PHONE_UNRECOGNIZED: "Telefon numarası anlaşılamadı.",
  AKTIF_UNRECOGNIZED:
    'Aktif sütunu anlaşılamadı. Kabul edilen değerler: "Evet/Hayır", "true/false", "1/0", "Aktif/Pasif" veya boş.',
  REGION_REQUIRED: "Bölge boş olamaz.",
  REGION_NOT_FOUND: "Belirtilen bölge bu odada tanımlı değil.",
  DUPLICATE_IN_FILE: "Bu eczane, dosyada aynı bölge için daha önce de yer alıyor.",
  ALREADY_EXISTS: "Bu eczane, seçilen bölgede zaten kayıtlı (V1'de mevcut kayıtlar güncellenmez).",
};

// Reconstructs a Turkish message from a persisted (status, errorCode)
// pair — used by the preview page after a redirect, when only the
// PharmacyImportRow's stored columns (never the original raw cell text)
// are available.
export function describePharmacyImportRowStatus(
  status: PharmacyImportRowStatus,
  errorCode: PharmacyRowErrorCode | null
): string {
  if (status === "READY") return "Aktarıma hazır.";
  if (errorCode) return ERROR_CODE_MESSAGES[errorCode];
  return "Bilinmeyen bir doğrulama hatası.";
}
