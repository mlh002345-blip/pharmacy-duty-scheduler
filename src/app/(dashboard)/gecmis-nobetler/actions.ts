"use server";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { requirePermissionOrState } from "@/lib/auth/guard";
import { zodErrorState, type ActionState } from "@/lib/action-state";
import { toDateKey } from "@/lib/scheduling/date-tr";
import {
  analyzeImportRows,
  type ImportAnalysis,
  type ImportRowInput,
} from "@/lib/historical/analyze-import";
import {
  HistoricalExcelParseError,
  MAX_IMPORT_ROWS,
  parseHistoricalExcel,
} from "@/lib/historical/parse-excel";
import type { ImportActionState } from "./import-state";

async function analyzeRows(inputRows: ImportRowInput[]): Promise<ImportAnalysis> {
  const [pharmacies, regions, holidays] = await Promise.all([
    prisma.pharmacy.findMany({ select: { id: true, name: true, regionId: true } }),
    prisma.region.findMany({ select: { id: true, name: true } }),
    prisma.holiday.findMany({ select: { date: true, type: true } }),
  ]);

  const holidayByDate = new Map(holidays.map((h) => [toDateKey(h.date), h.type]));

  return analyzeImportRows(inputRows, {
    pharmacies,
    regions,
    holidayLookup: (date) => holidayByDate.get(toDateKey(date)) ?? null,
  });
}

// Onay adımında dosyanın yeniden seçilmesini gerektirmemek için önizlemedeki
// ham satırlar gizli alanda taşınır ve içe aktarımda sunucuda YENİDEN analiz
// edilir (eşleştirme, tekrar ve tarih kontrolleri tekrar çalışır).
const rawRowSchema = z.object({
  rowNumber: z.number().int().min(1),
  tarih: z.string().max(50),
  bolge: z.string().max(200),
  eczaneAdi: z.string().max(200),
  nobetTuru: z.string().max(100),
  telefon: z.string().max(50),
  adres: z.string().max(500),
  not: z.string().max(500),
});
const rawRowsSchema = z.array(rawRowSchema).min(1).max(MAX_IMPORT_ROWS);

function toPreviewState(
  analysis: ImportAnalysis,
  fileName: string,
  message: string,
  success: boolean,
  rawRows?: ImportRowInput[]
): ImportActionState {
  return {
    success,
    message,
    rawRowsJson: rawRows ? JSON.stringify(rawRows) : undefined,
    fileName,
    preview: {
      fileName,
      rows: analysis.rows.map((row) => ({
        rowNumber: row.rowNumber,
        rawDate: row.rawDate,
        rawPharmacyName: row.rawPharmacyName,
        matchedPharmacyName: row.matchedPharmacyName,
        regionName: row.matchedRegionName ?? (row.rawRegionName || null),
        dutyType: row.rawDutyType,
        weight: row.weight,
        status: row.status,
        messages: row.messages,
      })),
      totalCount: analysis.totalCount,
      okCount: analysis.okCount,
      warningCount: analysis.warningCount,
      errorCount: analysis.errorCount,
      matchedCount: analysis.matchedCount,
      canImport: analysis.canImport,
    },
  };
}

export async function historicalImportAction(
  _state: ImportActionState,
  formData: FormData
): Promise<ImportActionState> {
  const guard = await requirePermissionOrState("manageSetupData");
  if (!guard.user) return { success: false, message: guard.state.message };

  const mode = formData.get("mode");

  let inputRows: ImportRowInput[];
  let fileName: string;

  if (mode === "import") {
    // Onay adımı: önizlemede taşınan ham satırlar üzerinden çalış.
    const rawRowsValue = formData.get("rawRows");
    const fileNameValue = formData.get("fileName");
    if (typeof rawRowsValue !== "string" || !rawRowsValue) {
      return {
        success: false,
        message: "Önce dosyayı yükleyip önizleme yapmalısınız.",
      };
    }
    let parsedRows: unknown;
    try {
      parsedRows = JSON.parse(rawRowsValue);
    } catch {
      return { success: false, message: "Önizleme verisi okunamadı. Lütfen dosyayı yeniden yükleyin." };
    }
    const validated = rawRowsSchema.safeParse(parsedRows);
    if (!validated.success) {
      return { success: false, message: "Önizleme verisi geçersiz. Lütfen dosyayı yeniden yükleyin." };
    }
    inputRows = validated.data;
    fileName = typeof fileNameValue === "string" && fileNameValue ? fileNameValue : "gecmis-nobetler.xlsx";
  } else {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { success: false, message: "Lütfen bir Excel dosyası seçin." };
    }
    if (file.size > 5 * 1024 * 1024) {
      return { success: false, message: "Dosya boyutu 5 MB'ı aşamaz." };
    }
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      inputRows = parseHistoricalExcel(buffer);
      fileName = file.name;
    } catch (error) {
      if (error instanceof HistoricalExcelParseError) {
        return { success: false, message: error.message };
      }
      throw error;
    }
  }

  // Analiz her iki modda da sunucuda yeniden çalışır (eşleştirme, tekrar ve
  // tarih kontrolleri dahil); istemciden gelen veriye güvenilmez.
  const analysis = await analyzeRows(inputRows);

  if (mode !== "import") {
    // Önizleme modu: hiçbir şey kaydedilmez.
    const message = analysis.canImport
      ? `Önizleme hazır: ${analysis.totalCount} satır analiz edildi, kritik hata yok. İçe aktarımı onaylayabilirsiniz.`
      : `Önizleme hazır: ${analysis.totalCount} satırın ${analysis.errorCount} tanesinde kritik hata var. Hatalar giderilmeden içe aktarım yapılamaz.`;
    return toPreviewState(analysis, fileName, message, analysis.canImport, inputRows);
  }

  // İçe aktarma modu: kritik hata varsa reddet.
  if (!analysis.canImport) {
    return toPreviewState(
      analysis,
      fileName,
      "Dosyada kritik hatalar var; içe aktarım engellendi. Lütfen hataları düzeltip yeniden yükleyin.",
      false
    );
  }

  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.historicalDutyImportBatch.create({
      data: {
        fileName,
        importedById: guard.user.id,
        rowCount: analysis.totalCount,
        matchedCount: analysis.matchedCount,
        unmatchedCount: analysis.totalCount - analysis.matchedCount,
        warningCount: analysis.warningCount,
      },
    });

    await tx.historicalDutyRecord.createMany({
      data: analysis.rows.map((row) => ({
        batchId: created.id,
        rowNumber: row.rowNumber,
        dutyDate: row.dutyDate!,
        rawPharmacyName: row.rawPharmacyName,
        rawRegionName: row.rawRegionName || null,
        rawDutyType: row.rawDutyType || null,
        rawPhone: row.rawPhone || null,
        rawAddress: row.rawAddress || null,
        rawNote: row.rawNote || null,
        dutyType: row.rawDutyType || "Normal",
        weight: row.weight,
        matchStatus: row.matchedPharmacyId ? "MATCHED" : "UNMATCHED",
        warningMessage: row.messages.length > 0 ? row.messages.join(" ") : null,
        pharmacyId: row.matchedPharmacyId,
        regionId: row.matchedRegionId,
      })),
    });

    return created;
  });

  await writeAuditLog({
    userId: guard.user.id,
    action: "CREATE",
    entity: "HistoricalDutyImportBatch",
    entityId: batch.id,
    after: {
      fileName,
      rowCount: analysis.totalCount,
      matchedCount: analysis.matchedCount,
      unmatchedCount: analysis.totalCount - analysis.matchedCount,
      warningCount: analysis.warningCount,
    },
  });

  redirectWithMessage(
    "/gecmis-nobetler",
    "success",
    `Geçmiş nöbet aktarımı tamamlandı: ${analysis.matchedCount} kayıt eşleşti${
      analysis.totalCount - analysis.matchedCount > 0
        ? `, ${analysis.totalCount - analysis.matchedCount} kayıt eşleşmedi (denge skorunu etkilemez)`
        : ""
    }.`
  );
}

const adjustmentSchema = z.object({
  pharmacyId: z.string().min(1, "Eczane seçimi zorunludur."),
  points: z.coerce
    .number({ message: "Puan sayısal olmalıdır." })
    .refine((v) => v !== 0, "Puan 0 olamaz.")
    .refine((v) => Math.abs(v) <= 1000, "Puan -1000 ile 1000 arasında olmalıdır."),
  reason: z.string().trim().min(5, "Gerekçe en az 5 karakter olmalıdır."),
});

export async function createBalanceAdjustmentAction(
  _state: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requirePermissionOrState("manageSetupData");
  if (!guard.user) return { success: false, message: guard.state.message };

  const parsed = adjustmentSchema.safeParse({
    pharmacyId: formData.get("pharmacyId"),
    points: formData.get("points"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id: parsed.data.pharmacyId },
    select: { id: true, name: true },
  });
  if (!pharmacy) {
    return { success: false, message: "Seçilen eczane bulunamadı." };
  }

  const adjustment = await prisma.dutyBalanceAdjustment.create({
    data: {
      pharmacyId: parsed.data.pharmacyId,
      points: parsed.data.points,
      reason: parsed.data.reason,
      createdById: guard.user.id,
    },
  });

  await writeAuditLog({
    userId: guard.user.id,
    action: "CREATE",
    entity: "DutyBalanceAdjustment",
    entityId: adjustment.id,
    after: {
      pharmacyName: pharmacy.name,
      points: parsed.data.points,
      reason: parsed.data.reason,
    },
  });

  redirectWithMessage(
    "/gecmis-nobetler",
    "success",
    `${pharmacy.name} için ${parsed.data.points > 0 ? "+" : ""}${parsed.data.points} puanlık manuel denge düzeltmesi eklendi.`
  );
}

export async function deleteBalanceAdjustmentAction(adjustmentId: string) {
  // Silme yalnızca ADMIN'e açıktır ve denetim kaydına yazılır.
  const guard = await requirePermissionOrState("manageUsers");
  if (!guard.user) {
    redirectWithMessage(
      "/gecmis-nobetler",
      "error",
      "Denge düzeltmesi silme yetkisi yalnızca yöneticidedir."
    );
  }

  const adjustment = await prisma.dutyBalanceAdjustment.findUnique({
    where: { id: adjustmentId },
    select: {
      id: true,
      points: true,
      reason: true,
      pharmacy: { select: { name: true } },
    },
  });
  if (!adjustment) {
    redirectWithMessage("/gecmis-nobetler", "error", "Düzeltme kaydı bulunamadı.");
  }

  await prisma.dutyBalanceAdjustment.delete({ where: { id: adjustmentId } });

  await writeAuditLog({
    userId: guard.user.id,
    action: "DELETE",
    entity: "DutyBalanceAdjustment",
    entityId: adjustmentId,
    before: {
      pharmacyName: adjustment.pharmacy.name,
      points: adjustment.points,
      reason: adjustment.reason,
    },
  });

  redirectWithMessage(
    "/gecmis-nobetler",
    "success",
    `${adjustment.pharmacy.name} için manuel denge düzeltmesi silindi.`
  );
}
