// Pure row-validation/matching for the Pharmacy Excel Import feature.
// No Prisma access here — the caller supplies this organization's own
// regions/pharmacies as plain arrays (already fetched org-scoped), so
// this module can never see, and therefore can never match against,
// another organization's data. See
// docs/features/PHARMACY_EXCEL_IMPORT.md and
// docs/features/AUTOMATIC_REGION_DISCOVERY.md.

import { normalizeText } from "@/lib/historical/normalize";
import { normalizePhoneNumber } from "./phone";
import type { PharmacyImportRawRow } from "./parse-excel";
import {
  discoverRegionCandidates,
  type DiscoveredRegionCandidate,
  type ExistingRegionForMatching,
  type RegionCandidateStatus,
} from "./region-discovery";

const CONTROL_CHAR_PATTERN = /[\x00-\x1f\x7f]/;

const NAME_MAX_LENGTH = 200;
export const ADDRESS_MAX_LENGTH = 500;

export type PharmacyImportRowStatus =
  | "READY"
  | "INVALID"
  | "DUPLICATE_IN_FILE"
  | "ALREADY_EXISTS"
  | "UNKNOWN_REGION"
  // Region-discovery statuses: the row's region candidate still needs an
  // ADMIN decision (approval, inactive-region acknowledgment, suggestion
  // confirmation, or manual assignment)…
  | "REGION_PENDING"
  // …or the ADMIN excluded the row's candidate from this import: the row
  // is skipped, never blocks, and is never imported.
  | "EXCLUDED";

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
  | "ADDRESS_INVALID_CHARACTERS"
  | "ADDRESS_TOO_LONG"
  | "REGION_REQUIRED"
  | "REGION_NOT_FOUND"
  | "REGION_UNRESOLVED"
  | "REGION_AMBIGUOUS"
  | "REGION_PENDING_APPROVAL"
  | "REGION_INACTIVE_PENDING"
  | "REGION_SUGGESTION_PENDING"
  | "REGION_EXCLUDED"
  | "DUPLICATE_IN_FILE"
  | "ALREADY_EXISTS";

export type AnalyzedPharmacyImportRow = {
  rowNumber: number;
  rawBolge: string;
  rawIlce: string;
  rawEczaneAdi: string;
  rawEczaciAdi: string;
  rawTelefon: string;
  rawAktif: string;
  address: string | null;
  normalizedPharmacyName: string | null;
  pharmacistName: string | null;
  phone: string | null;
  isActive: boolean;
  matchedRegionId: string | null;
  matchedRegionName: string | null;
  // Normalized key of the region candidate this row resolved to (see
  // region-discovery.ts); null when the row has no usable region source.
  candidateKey: string | null;
  status: PharmacyImportRowStatus;
  errorCode: PharmacyRowErrorCode | null;
  messages: string[];
};

export type PharmacyImportAnalysis = {
  rows: AnalyzedPharmacyImportRow[];
  candidates: DiscoveredRegionCandidate[];
  totalCount: number;
  readyCount: number;
  invalidCount: number;
  pendingRegionCount: number;
  canImport: boolean;
};

export type PharmacyImportMatchContext = {
  regions: ExistingRegionForMatching[];
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
  const existingKeys = new Set(
    context.existingPharmacies.map((p) => `${p.regionId}|${p.normalizedName}`)
  );
  const discovery = discoverRegionCandidates(inputRows, context.regions);
  const candidateByKey = new Map(
    discovery.candidates.map((candidate) => [candidate.normalizedSourceValue, candidate])
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
    const ilce = input.ilce.trim().replace(/\s+/g, " ");
    const adres = input.adres.trim().replace(/\s+/g, " ");

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

    // Adres is optional — validated only when present (Turkish characters
    // preserved; control characters rejected; length-capped).
    if (adres && CONTROL_CHAR_PATTERN.test(adres)) {
      markInvalid("ADDRESS_INVALID_CHARACTERS", "Adres geçersiz karakter içeriyor.");
    } else if (adres.length > ADDRESS_MAX_LENGTH) {
      markInvalid("ADDRESS_TOO_LONG", `Adres en fazla ${ADDRESS_MAX_LENGTH} karakter olabilir.`);
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

    const candidateKey = discovery.rowCandidateKeys.get(input.rowNumber) ?? null;
    const unresolvedReason = discovery.unresolvedReasons.get(input.rowNumber) ?? null;
    const candidate = candidateKey ? (candidateByKey.get(candidateKey) ?? null) : null;

    const normalizedPharmacyName = eczaneAdi ? normalizeText(eczaneAdi) : null;

    let status: PharmacyImportRowStatus;
    let matchedRegionId: string | null = null;
    let matchedRegionName: string | null = null;

    if (!fieldsValid) {
      status = "INVALID";
    } else if (!candidate) {
      status = "REGION_PENDING";
      if (unresolvedReason === "AMBIGUOUS_ADDRESS") {
        errorCode = "REGION_AMBIGUOUS";
        messages.push(
          "Adresteki bölge bilgisi tek bir değere indirgenemedi; ön izlemede bir bölge seçilmelidir."
        );
      } else {
        errorCode = "REGION_UNRESOLVED";
        messages.push(
          "Satırda Bölge veya İlçe değeri yok ve adresten bir öneri çıkarılamadı; ön izlemede bir bölge seçilmelidir."
        );
      }
    } else {
      // Duplicate detection is keyed by the row's FINAL region identity:
      // the matched region id for existing regions, or the candidate's
      // normalized key for regions that do not exist yet.
      const dedupeKey =
        candidate.status === "MATCHED_EXISTING_ACTIVE" || candidate.status === "MATCHED_EXISTING_INACTIVE"
          ? `region:${candidate.matchedRegionId}`
          : `candidate:${candidate.normalizedSourceValue}`;
      const pairKey = `${dedupeKey}|${normalizedPharmacyName}`;

      if (seenInFile.has(pairKey)) {
        status = "DUPLICATE_IN_FILE";
        errorCode = "DUPLICATE_IN_FILE";
        messages.push("Bu eczane, dosyada aynı bölge için daha önce de yer alıyor.");
      } else if (
        candidate.status === "MATCHED_EXISTING_ACTIVE" &&
        existingKeys.has(`${candidate.matchedRegionId}|${normalizedPharmacyName}`)
      ) {
        seenInFile.add(pairKey);
        status = "ALREADY_EXISTS";
        errorCode = "ALREADY_EXISTS";
        messages.push("Bu eczane, seçilen bölgede zaten kayıtlı (V1'de mevcut kayıtlar güncellenmez).");
      } else {
        seenInFile.add(pairKey);
        switch (candidate.status) {
          case "MATCHED_EXISTING_ACTIVE":
            status = "READY";
            matchedRegionId = candidate.matchedRegionId;
            matchedRegionName = candidate.matchedRegionName;
            break;
          case "MATCHED_EXISTING_INACTIVE":
            status = "REGION_PENDING";
            errorCode = "REGION_INACTIVE_PENDING";
            messages.push(
              `"${candidate.matchedRegionName}" bölgesi pasif durumda; ön izlemede bir karar verilmelidir.`
            );
            break;
          case "ADDRESS_SUGGESTION":
            status = "REGION_PENDING";
            errorCode = "REGION_SUGGESTION_PENDING";
            messages.push(
              "Bölge, adresten türetilen bir öneridir; ön izlemede onaylanması veya düzeltilmesi gerekir."
            );
            break;
          default:
            status = "REGION_PENDING";
            errorCode = "REGION_PENDING_APPROVAL";
            messages.push(
              `"${candidate.sourceValue}" bölgesi bu odada tanımlı değil; ön izlemede yeni bölge olarak onaylanabilir.`
            );
            break;
        }
      }
    }

    return {
      rowNumber: input.rowNumber,
      rawBolge: bolge,
      rawIlce: ilce,
      rawEczaneAdi: eczaneAdi,
      rawEczaciAdi: eczaciAdi,
      rawTelefon: input.telefon.trim(),
      rawAktif: input.aktif.trim(),
      address: adres || null,
      normalizedPharmacyName,
      pharmacistName: fieldsValid ? eczaciAdi : null,
      phone: normalizedPhone,
      isActive,
      matchedRegionId,
      matchedRegionName,
      candidateKey,
      status,
      errorCode,
      messages,
    };
  });

  const readyCount = rows.filter((r) => r.status === "READY").length;
  const pendingRegionCount = rows.filter((r) => r.status === "REGION_PENDING").length;
  const invalidCount = rows.length - readyCount;

  return {
    rows,
    candidates: discovery.candidates,
    totalCount: rows.length,
    readyCount,
    invalidCount,
    pendingRegionCount,
    canImport: rows.length > 0 && readyCount === rows.length,
  };
}

// ---------------------------------------------------------------------------
// Server-side recomputation after ADMIN candidate decisions.
// ---------------------------------------------------------------------------

// The persisted shapes the recompute needs — deliberately structural
// (id + the columns that drive resolution), so both the Server Actions
// and the final import transaction can call this with Prisma rows.
export type PersistedRowForRecompute = {
  id: string;
  rowNumber: number;
  normalizedPharmacyName: string;
  status: PharmacyImportRowStatus;
  safeErrorCode: string | null;
  candidateId: string | null;
  // The server-resolved region, when one was already assigned. Rows
  // carrying a regionId but no candidate (batches persisted before
  // region discovery existed) stay resolved to that region.
  regionId: string | null;
};

export type PersistedCandidateForRecompute = {
  id: string;
  status: RegionCandidateStatus;
  approvedAt: Date | null;
  matchedRegionId: string | null;
  normalizedProposedName: string;
};

export type RecomputedRow = {
  id: string;
  status: PharmacyImportRowStatus;
  errorCode: PharmacyRowErrorCode | null;
  // The concrete existing region the row resolves to, when its candidate
  // is matched to one; rows resolving to an approved-new candidate keep
  // null here until the final transaction creates the region.
  regionId: string | null;
};

export type RecomputeResult = {
  rows: RecomputedRow[];
  readyCount: number;
  excludedCount: number;
  blockedCount: number;
  // Import may proceed only when nothing is blocked and at least one row
  // is READY. EXCLUDED rows never block and are never imported.
  canImport: boolean;
};

type CandidateResolution =
  | { kind: "region"; regionId: string }
  | { kind: "new-region"; normalizedName: string }
  | { kind: "excluded" }
  | { kind: "pending"; errorCode: PharmacyRowErrorCode };

export function resolveCandidateForImport(
  candidate: PersistedCandidateForRecompute
): CandidateResolution {
  switch (candidate.status) {
    case "EXCLUDED_BY_ADMIN":
      return { kind: "excluded" };
    case "MATCHED_EXISTING_ACTIVE":
      return candidate.matchedRegionId
        ? { kind: "region", regionId: candidate.matchedRegionId }
        : { kind: "pending", errorCode: "REGION_UNRESOLVED" };
    case "MATCHED_EXISTING_INACTIVE":
      // An inactive match requires an explicit ADMIN decision (keep
      // inactive / reactivate) — recorded via approvedAt. Never silent.
      return candidate.approvedAt && candidate.matchedRegionId
        ? { kind: "region", regionId: candidate.matchedRegionId }
        : { kind: "pending", errorCode: "REGION_INACTIVE_PENDING" };
    case "NEW_REGION_CANDIDATE":
      return candidate.approvedAt
        ? { kind: "new-region", normalizedName: candidate.normalizedProposedName }
        : { kind: "pending", errorCode: "REGION_PENDING_APPROVAL" };
    case "ADDRESS_SUGGESTION":
      return { kind: "pending", errorCode: "REGION_SUGGESTION_PENDING" };
    case "AMBIGUOUS":
      return { kind: "pending", errorCode: "REGION_AMBIGUOUS" };
    default:
      return { kind: "pending", errorCode: "REGION_UNRESOLVED" };
  }
}

// Recomputes every row's status from the CURRENT candidate decisions —
// called after every candidate mutation and re-run inside the final
// import transaction (the persisted statuses are never trusted at import
// time). Field-invalid rows stay INVALID; everything region-dependent is
// recomputed from scratch, including duplicate detection keyed by each
// row's final region identity.
export function recomputePharmacyImportRows(
  rows: PersistedRowForRecompute[],
  candidates: PersistedCandidateForRecompute[],
  existingPharmacies: { regionId: string; normalizedName: string }[]
): RecomputeResult {
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const existingKeys = new Set(
    existingPharmacies.map((p) => `${p.regionId}|${p.normalizedName}`)
  );
  const seen = new Set<string>();

  const FIELD_ERROR_CODES: ReadonlySet<string> = new Set([
    "PHARMACY_NAME_REQUIRED",
    "PHARMACY_NAME_INVALID_CHARACTERS",
    "PHARMACY_NAME_TOO_LONG",
    "PHARMACIST_NAME_REQUIRED",
    "PHARMACIST_NAME_INVALID_CHARACTERS",
    "PHARMACIST_NAME_TOO_LONG",
    "PHONE_MISSING_DEFAULT_AREA_CODE",
    "PHONE_INVALID_DEFAULT_AREA_CODE",
    "PHONE_UNRECOGNIZED",
    "AKTIF_UNRECOGNIZED",
    "ADDRESS_INVALID_CHARACTERS",
    "ADDRESS_TOO_LONG",
  ]);

  const ordered = [...rows].sort((a, b) => a.rowNumber - b.rowNumber);
  const result: RecomputedRow[] = [];
  let readyCount = 0;
  let excludedCount = 0;
  let blockedCount = 0;

  for (const row of ordered) {
    // Field-level validity never changes after upload — an INVALID row
    // stays INVALID regardless of candidate decisions.
    if (row.status === "INVALID" && row.safeErrorCode && FIELD_ERROR_CODES.has(row.safeErrorCode)) {
      result.push({
        id: row.id,
        status: "INVALID",
        errorCode: row.safeErrorCode as PharmacyRowErrorCode,
        regionId: null,
      });
      blockedCount += 1;
      continue;
    }

    const candidate = row.candidateId ? (candidateById.get(row.candidateId) ?? null) : null;
    if (!candidate && !row.regionId) {
      const preserved =
        row.safeErrorCode === "REGION_AMBIGUOUS" ? "REGION_AMBIGUOUS" : "REGION_UNRESOLVED";
      result.push({ id: row.id, status: "REGION_PENDING", errorCode: preserved, regionId: null });
      blockedCount += 1;
      continue;
    }

    // A candidate decision drives resolution when present; otherwise the
    // row's server-assigned regionId (legacy batches) stands.
    const resolution: CandidateResolution = candidate
      ? resolveCandidateForImport(candidate)
      : { kind: "region", regionId: row.regionId! };
    if (resolution.kind === "excluded") {
      result.push({ id: row.id, status: "EXCLUDED", errorCode: "REGION_EXCLUDED", regionId: null });
      excludedCount += 1;
      continue;
    }
    if (resolution.kind === "pending") {
      result.push({
        id: row.id,
        status: "REGION_PENDING",
        errorCode: resolution.errorCode,
        regionId: null,
      });
      blockedCount += 1;
      continue;
    }

    const dedupeKey =
      resolution.kind === "region"
        ? `region:${resolution.regionId}`
        : `new:${resolution.normalizedName}`;
    const pairKey = `${dedupeKey}|${row.normalizedPharmacyName}`;

    if (seen.has(pairKey)) {
      result.push({
        id: row.id,
        status: "DUPLICATE_IN_FILE",
        errorCode: "DUPLICATE_IN_FILE",
        regionId: null,
      });
      blockedCount += 1;
      continue;
    }
    seen.add(pairKey);

    if (
      resolution.kind === "region" &&
      existingKeys.has(`${resolution.regionId}|${row.normalizedPharmacyName}`)
    ) {
      result.push({
        id: row.id,
        status: "ALREADY_EXISTS",
        errorCode: "ALREADY_EXISTS",
        regionId: null,
      });
      blockedCount += 1;
      continue;
    }

    result.push({
      id: row.id,
      status: "READY",
      errorCode: null,
      regionId: resolution.kind === "region" ? resolution.regionId : null,
    });
    readyCount += 1;
  }

  return {
    rows: result,
    readyCount,
    excludedCount,
    blockedCount,
    canImport: blockedCount === 0 && readyCount > 0,
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
  ADDRESS_INVALID_CHARACTERS: "Adres geçersiz karakter içeriyor.",
  ADDRESS_TOO_LONG: `Adres en fazla ${ADDRESS_MAX_LENGTH} karakter olabilir.`,
  REGION_REQUIRED: "Bölge boş olamaz.",
  REGION_NOT_FOUND: "Belirtilen bölge bu odada tanımlı değil.",
  REGION_UNRESOLVED:
    "Satır için bir bölge belirlenemedi; ön izlemenin Bölge Eşleştirme bölümünden bir bölge seçin.",
  REGION_AMBIGUOUS:
    "Adresteki bölge bilgisi tek bir değere indirgenemedi; ön izlemede bir bölge seçilmelidir.",
  REGION_PENDING_APPROVAL:
    "Bölge bu odada tanımlı değil; ön izlemede yeni bölge olarak onaylanması veya mevcut bir bölgeyle eşleştirilmesi gerekir.",
  REGION_INACTIVE_PENDING:
    "Eşleşen bölge pasif durumda; ön izlemede pasif bırakma, yeniden aktifleştirme veya başka bölgeyle eşleştirme kararı verilmelidir.",
  REGION_SUGGESTION_PENDING:
    "Bölge, adresten türetilen bir öneridir; ön izlemede onaylanması veya düzeltilmesi gerekir.",
  REGION_EXCLUDED: "Bu satırın bölgesi içe aktarım dışında bırakıldı; satır aktarılmayacak.",
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
