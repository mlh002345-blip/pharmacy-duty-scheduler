"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireOrganizationRole } from "@/lib/auth/tenant";
import { writeAuditLog } from "@/lib/audit";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { logger } from "@/lib/observability/logger";
import { getRequestId } from "@/lib/observability/request-id";
import { preflightZipArchive, ZipPreflightError } from "@/lib/zip-preflight";
import {
  PharmacyExcelParseError,
  parsePharmacyImportExcel,
} from "@/lib/pharmacy-import/parse-excel";
import { analyzePharmacyImportRows } from "@/lib/pharmacy-import/analyze-import";
import { isValidDefaultAreaCode } from "@/lib/pharmacy-import/phone";
import { type ActionState } from "@/lib/action-state";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const IMPORT_BATCH_TTL_MINUTES = 30;

// Never a raw client-supplied path — only the base name, stripped of
// control characters and path separators, capped in length. Persisted
// as PharmacyImportBatch.sanitizedFileName (never the workbook itself).
function sanitizeFileName(rawName: string): string {
  const withoutPath = rawName.split(/[\\/]/).pop() ?? "";
  const cleaned = withoutPath.replace(/[\x00-\x1f\x7f]/g, "").trim();
  const truncated = cleaned.slice(0, 200);
  return truncated || "eczaneler.xlsx";
}

export async function previewPharmacyImportAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requireOrganizationRole("importPharmacies");
  if (!guard.user) return guard.state;
  const { user } = guard;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, message: "Lütfen bir Excel dosyası seçin." };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { success: false, message: "Dosya boyutu 5 MB'ı aşamaz." };
  }

  const defaultAreaCodeRaw = formData.get("defaultAreaCode");
  const defaultAreaCodeTrimmed =
    typeof defaultAreaCodeRaw === "string" ? defaultAreaCodeRaw.trim() : "";
  if (defaultAreaCodeTrimmed && !isValidDefaultAreaCode(defaultAreaCodeTrimmed)) {
    return {
      success: false,
      message: "Varsayılan Alan Kodu 3 haneli bir sayı olmalıdır.",
      errors: { defaultAreaCode: ["Varsayılan Alan Kodu 3 haneli bir sayı olmalıdır."] },
    };
  }
  const defaultAreaCode = defaultAreaCodeTrimmed || null;

  let rows: Awaited<ReturnType<typeof parsePharmacyImportExcel>>["rows"];
  let ignoredColumnWarnings: string[];
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    // Cheap ZIP-metadata preflight BEFORE exceljs decompresses any entry
    // content — see src/lib/zip-preflight.ts (same defense already
    // relied on by the historical-duty-import upload path).
    try {
      await preflightZipArchive(buffer);
    } catch (error) {
      if (error instanceof ZipPreflightError) {
        const isResourceLimit = [
          "too_many_entries",
          "entry_too_large",
          "total_too_large",
          "compression_ratio_too_high",
        ].includes(error.reasonCode);
        logger.warn(isResourceLimit ? "excel_resource_limit_exceeded" : "excel_upload_rejected", {
          requestId: await getRequestId(),
          reasonCode: error.reasonCode,
          fileSize: file.size,
          feature: "pharmacy_import",
        });
        return { success: false, message: error.message };
      }
      throw error;
    }
    const parsed = await parsePharmacyImportExcel(buffer);
    rows = parsed.rows;
    ignoredColumnWarnings = parsed.ignoredColumnWarnings;
  } catch (error) {
    if (error instanceof PharmacyExcelParseError) {
      return { success: false, message: error.message };
    }
    throw error;
  }

  // Region/pharmacy context is fetched org-scoped only — the analyzer
  // can never see, and therefore can never match against, another
  // organization's regions or pharmacies.
  const [regions, existingPharmacies] = await Promise.all([
    prisma.region.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, name: true },
    }),
    prisma.pharmacy.findMany({
      where: { region: { organizationId: user.organizationId } },
      select: { normalizedName: true, regionId: true },
    }),
  ]);

  const analysis = analyzePharmacyImportRows(rows, {
    regions,
    existingPharmacies,
    defaultAreaCode,
  });

  const sanitizedFileName = sanitizeFileName(file.name);
  const expiresAt = new Date(Date.now() + IMPORT_BATCH_TTL_MINUTES * 60 * 1000);

  const batch = await prisma.pharmacyImportBatch.create({
    data: {
      status: "PREVIEWED",
      sanitizedFileName,
      fileSize: file.size,
      totalRows: analysis.totalCount,
      readyRows: analysis.readyCount,
      invalidRows: analysis.invalidCount,
      expiresAt,
      organizationId: user.organizationId,
      createdById: user.id,
      rows: {
        create: analysis.rows.map((row) => ({
          rowNumber: row.rowNumber,
          pharmacyName: row.rawEczaneAdi,
          normalizedPharmacyName: row.normalizedPharmacyName ?? "",
          pharmacistName: row.pharmacistName,
          phone: row.phone,
          isActive: row.isActive,
          status: row.status,
          safeErrorCode: row.errorCode,
          regionId: row.matchedRegionId,
        })),
      },
    },
  });

  logger.info("pharmacy_import_previewed", {
    requestId: await getRequestId(),
    userId: user.id,
    batchId: batch.id,
    totalRows: analysis.totalCount,
    readyRows: analysis.readyCount,
    ignoredColumnCount: ignoredColumnWarnings.length,
  });

  redirectWithMessage(
    `/eczaneler/ice-aktar/onizleme/${batch.id}`,
    "success",
    analysis.canImport
      ? `Önizleme hazır: ${analysis.totalCount} satır analiz edildi, tümü aktarıma hazır.`
      : `Önizleme hazır: ${analysis.totalCount} satırın ${analysis.invalidCount} tanesi aktarıma hazır değil. İçe aktarım için tüm satırların düzeltilmesi gerekir.`
  );
}

export async function importPharmacyBatchAction(batchId: string) {
  const guard = await requireOrganizationRole("importPharmacies");
  if (!guard.user) {
    redirectWithMessage("/eczaneler/ice-aktar", "error", guard.state.message);
  }
  const { user } = guard;

  const batch = await prisma.pharmacyImportBatch.findFirst({
    where: { id: batchId, organizationId: user.organizationId },
    include: { rows: true },
  });
  if (!batch) {
    redirectWithMessage("/eczaneler/ice-aktar", "error", "İçe aktarma kaydı bulunamadı.");
  }

  if (batch.status !== "PREVIEWED") {
    redirectWithMessage(
      "/eczaneler/ice-aktar",
      "error",
      "Bu içe aktarma zaten tamamlanmış veya süresi dolmuş."
    );
  }
  if (batch.expiresAt.getTime() < Date.now()) {
    await prisma.pharmacyImportBatch.update({
      where: { id: batch.id },
      data: { status: "EXPIRED" },
    });
    redirectWithMessage(
      "/eczaneler/ice-aktar",
      "error",
      "Önizlemenin süresi doldu. Lütfen dosyayı yeniden yükleyin."
    );
  }
  if (batch.readyRows !== batch.totalRows || batch.totalRows === 0) {
    redirectWithMessage(
      "/eczaneler/ice-aktar",
      "error",
      "Bu içe aktarmada aktarıma hazır olmayan satırlar var; içe aktarım engellendi."
    );
  }

  // Re-validate every row's regionId still belongs to this organization
  // right before writing — defense in depth against a region having
  // been deleted (or, in principle, any other change) between preview
  // and final import; never trusted purely because it was true at
  // preview time.
  const regionIds = [...new Set(batch.rows.map((r) => r.regionId).filter((id): id is string => !!id))];
  const ownedRegions = await prisma.region.findMany({
    where: { id: { in: regionIds }, organizationId: user.organizationId },
    select: { id: true },
  });
  const ownedRegionIds = new Set(ownedRegions.map((r) => r.id));
  const staleRow = batch.rows.find((r) => !r.regionId || !ownedRegionIds.has(r.regionId));
  if (staleRow) {
    redirectWithMessage(
      "/eczaneler/ice-aktar",
      "error",
      "Önizlemeden bu yana bölge bilgileri değişmiş; lütfen dosyayı yeniden yükleyin."
    );
  }

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: user.organizationId },
    select: { province: true },
  });
  const regionDistrictById = new Map(
    (
      await prisma.region.findMany({
        where: { id: { in: regionIds } },
        select: { id: true, district: true },
      })
    ).map((r) => [r.id, r.district])
  );

  let createdCount = 0;
  try {
    await prisma.$transaction(async (tx) => {
      for (const row of batch.rows) {
        await tx.pharmacy.create({
          data: {
            name: row.pharmacyName,
            normalizedName: row.normalizedPharmacyName,
            pharmacistName: row.pharmacistName ?? "",
            phone: row.phone ?? "",
            // Not collected by the import template (see
            // docs/features/PHARMACY_EXCEL_IMPORT.md) — city/district are
            // derived from already-known, non-hardcoded values (the
            // organization's own province, the matched region's own
            // district); address is left blank for the ADMIN to fill in
            // later via the existing edit form.
            address: "",
            city: organization.province,
            district: regionDistrictById.get(row.regionId!) ?? "",
            isActive: row.isActive,
            regionId: row.regionId!,
            requestToken: randomBytes(16).toString("hex"),
          },
        });
        createdCount += 1;
      }

      await tx.pharmacyImportBatch.update({
        where: { id: batch.id },
        data: { status: "IMPORTED", consumedAt: new Date() },
      });

      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        action: "CREATE",
        entity: "PharmacyImportBatch",
        entityId: batch.id,
        after: {
          sanitizedFileName: batch.sanitizedFileName,
          totalRows: batch.totalRows,
          createdCount,
        },
      });
    });
  } catch (error) {
    logger.error(
      "pharmacy_import_failed",
      {
        requestId: await getRequestId(),
        userId: user.id,
        batchId: batch.id,
        reason: "unexpected_transaction_error",
      },
      error
    );
    throw error;
  }

  logger.info("pharmacy_import_completed", {
    requestId: await getRequestId(),
    userId: user.id,
    batchId: batch.id,
    createdCount,
  });

  revalidatePath("/eczaneler");
  redirectWithMessage(
    "/eczaneler",
    "success",
    `Excel içe aktarımı tamamlandı: ${createdCount} eczane oluşturuldu.`
  );
}
