// Geçmiş nöbet Excel satırlarının analizi: normalizasyon, bölge/eczane
// eşleştirme, ağırlık hesabı, kritik hata ve uyarı üretimi. Saf fonksiyondur;
// veritabanı erişimi çağıran katmandadır.

import { toDateKey } from "@/lib/scheduling/date-tr";
import {
  calculateHistoricalDutyWeight,
  normalizeText,
  parseHistoricalDate,
  type HolidayLookup,
} from "./normalize";

export type ImportRowInput = {
  rowNumber: number;
  tarih: string;
  bolge: string;
  eczaneAdi: string;
  nobetTuru: string;
  telefon: string;
  adres: string;
  not: string;
};

export type MatchContext = {
  pharmacies: { id: string; name: string; regionId: string }[];
  regions: { id: string; name: string }[];
  holidayLookup?: HolidayLookup;
};

export type AnalyzedRowStatus = "OK" | "WARNING" | "ERROR";

export type AnalyzedImportRow = {
  rowNumber: number;
  rawDate: string;
  dutyDate: Date | null;
  rawPharmacyName: string;
  rawRegionName: string;
  rawDutyType: string;
  rawPhone: string;
  rawAddress: string;
  rawNote: string;
  matchedPharmacyId: string | null;
  matchedPharmacyName: string | null;
  matchedRegionId: string | null;
  matchedRegionName: string | null;
  weight: number;
  status: AnalyzedRowStatus;
  messages: string[];
};

export type ImportAnalysis = {
  rows: AnalyzedImportRow[];
  totalCount: number;
  okCount: number;
  warningCount: number;
  errorCount: number;
  matchedCount: number;
  canImport: boolean;
};

export function analyzeImportRows(
  inputRows: ImportRowInput[],
  context: MatchContext
): ImportAnalysis {
  const regionByName = new Map(
    context.regions.map((region) => [normalizeText(region.name), region])
  );

  const pharmacyByNameAndRegion = new Map<
    string,
    { id: string; name: string; regionId: string }
  >();
  const pharmaciesByName = new Map<
    string,
    { id: string; name: string; regionId: string }[]
  >();
  for (const pharmacy of context.pharmacies) {
    const nameKey = normalizeText(pharmacy.name);
    pharmacyByNameAndRegion.set(`${nameKey}|${pharmacy.regionId}`, pharmacy);
    const list = pharmaciesByName.get(nameKey) ?? [];
    list.push(pharmacy);
    pharmaciesByName.set(nameKey, list);
  }
  const regionNameById = new Map(context.regions.map((r) => [r.id, r.name]));

  // Dosya içi tekrar kontrolü: aynı tarih + aynı (normalize) eczane adı.
  const seenDatePharmacy = new Set<string>();

  const rows: AnalyzedImportRow[] = inputRows.map((input) => {
    const messages: string[] = [];
    // Nesne sarmalayıcı: closure içinden atanan let değişkeninde TS'in
    // daraltması yanlış pozitif verdiği için durum bir alanda tutulur.
    const result = { status: "OK" as AnalyzedRowStatus };
    const markWarning = (message: string) => {
      messages.push(message);
      if (result.status === "OK") result.status = "WARNING";
    };
    const markError = (message: string) => {
      messages.push(message);
      result.status = "ERROR";
    };

    const rawDate = input.tarih.trim();
    const dutyDate = parseHistoricalDate(rawDate);
    if (!rawDate) {
      markError("Tarih boş olamaz.");
    } else if (!dutyDate) {
      markError(
        "Tarih anlaşılamadı. Desteklenen biçimler: GG.AA.YYYY, GG/AA/YYYY, YYYY-AA-GG."
      );
    }

    const pharmacyNameKey = normalizeText(input.eczaneAdi);
    if (!pharmacyNameKey) {
      markError("Eczane adı boş olamaz.");
    }

    // Bölge eşleştirme
    let matchedRegion: { id: string; name: string } | null = null;
    const regionKey = normalizeText(input.bolge);
    if (regionKey) {
      matchedRegion = regionByName.get(regionKey) ?? null;
      if (!matchedRegion) {
        markWarning(`"${input.bolge.trim()}" bölgesi sistemde bulunamadı.`);
      }
    }

    // Eczane eşleştirme: önce ad + bölge, sonra tekil ad.
    let matchedPharmacy: { id: string; name: string; regionId: string } | null = null;
    if (pharmacyNameKey) {
      if (matchedRegion) {
        matchedPharmacy =
          pharmacyByNameAndRegion.get(`${pharmacyNameKey}|${matchedRegion.id}`) ?? null;
      }
      if (!matchedPharmacy) {
        const candidates = pharmaciesByName.get(pharmacyNameKey) ?? [];
        if (candidates.length === 1) {
          matchedPharmacy = candidates[0];
          if (matchedRegion && matchedPharmacy.regionId !== matchedRegion.id) {
            markWarning(
              "Eczane, belirtilen bölgede değil; ada göre tek eşleşme kullanıldı."
            );
          } else if (!matchedRegion && regionKey === "") {
            markWarning("Bölge belirtilmedi; eczane yalnızca ada göre eşleştirildi.");
          } else if (!matchedRegion) {
            markWarning("Eczane yalnızca ada göre eşleştirildi.");
          }
        } else if (candidates.length > 1) {
          markError(
            "Aynı ada sahip birden fazla eczane var; bölge bilgisi olmadan güvenli eşleştirme yapılamıyor."
          );
        } else {
          markError("Bu ada sahip bir eczane sistemde bulunamadı.");
        }
      }
    }

    // Dosya içi tekrar: aynı tarih + eczane adı.
    if (dutyDate && pharmacyNameKey) {
      const duplicateKey = `${toDateKey(dutyDate)}|${pharmacyNameKey}`;
      if (seenDatePharmacy.has(duplicateKey)) {
        markError("Bu tarih ve eczane için dosyada birden fazla satır var.");
      } else {
        seenDatePharmacy.add(duplicateKey);
      }
    }

    if (!normalizeText(input.nobetTuru) && dutyDate) {
      markWarning("Nöbet türü boş; tarihe göre varsayılan puan uygulandı.");
    }

    const weight = dutyDate
      ? calculateHistoricalDutyWeight(dutyDate, input.nobetTuru, context.holidayLookup)
      : 1.0;

    const effectiveRegionId =
      matchedRegion?.id ?? matchedPharmacy?.regionId ?? null;

    return {
      rowNumber: input.rowNumber,
      rawDate,
      dutyDate,
      rawPharmacyName: input.eczaneAdi.trim(),
      rawRegionName: input.bolge.trim(),
      rawDutyType: input.nobetTuru.trim(),
      rawPhone: input.telefon.trim(),
      rawAddress: input.adres.trim(),
      rawNote: input.not.trim(),
      matchedPharmacyId: result.status === "ERROR" ? null : (matchedPharmacy?.id ?? null),
      matchedPharmacyName: result.status === "ERROR" ? null : (matchedPharmacy?.name ?? null),
      matchedRegionId: result.status === "ERROR" ? null : effectiveRegionId,
      matchedRegionName:
        result.status === "ERROR"
          ? null
          : effectiveRegionId
            ? (regionNameById.get(effectiveRegionId) ?? null)
            : null,
      weight,
      status: result.status,
      messages,
    };
  });

  const okCount = rows.filter((r) => r.status === "OK").length;
  const warningCount = rows.filter((r) => r.status === "WARNING").length;
  const errorCount = rows.filter((r) => r.status === "ERROR").length;
  const matchedCount = rows.filter((r) => r.matchedPharmacyId).length;

  return {
    rows,
    totalCount: rows.length,
    okCount,
    warningCount,
    errorCount,
    matchedCount,
    canImport: rows.length > 0 && errorCount === 0,
  };
}
