"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";

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
import { recomputeAndPersistBatch } from "@/lib/pharmacy-import/batch-recompute";
import { isValidDefaultAreaCode } from "@/lib/pharmacy-import/phone";
import { normalizeText } from "@/lib/historical/normalize";
import { type ActionState } from "@/lib/action-state";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const IMPORT_BATCH_TTL_MINUTES = 30;

// Controlled, user-facing failure inside the final import transaction —
// always a safe Turkish message, never a raw Prisma error.
class PharmacyImportBlockedError extends Error {
  constructor(
    message: string,
    public readonly reasonCode: string
  ) {
    super(message);
  }
}

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
  const [regions, existingPharmacies, organization] = await Promise.all([
    prisma.region.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, name: true, district: true, isActive: true },
    }),
    prisma.pharmacy.findMany({
      where: { region: { organizationId: user.organizationId } },
      select: { normalizedName: true, regionId: true },
    }),
    prisma.organization.findUniqueOrThrow({
      where: { id: user.organizationId },
      select: { province: true },
    }),
  ]);

  const analysis = analyzePharmacyImportRows(rows, {
    regions,
    existingPharmacies,
    defaultAreaCode,
  });

  const sanitizedFileName = sanitizeFileName(file.name);
  const expiresAt = new Date(Date.now() + IMPORT_BATCH_TTL_MINUTES * 60 * 1000);

  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.pharmacyImportBatch.create({
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
        regionCandidates: {
          create: analysis.candidates.map((candidate) => ({
            sourceValue: candidate.sourceValue,
            normalizedSourceValue: candidate.normalizedSourceValue,
            sourceType: candidate.sourceType,
            status: candidate.status,
            proposedName: candidate.proposedName,
            normalizedProposedName: normalizeText(candidate.proposedName),
            // Proposed city defaults to the authenticated organization's
            // own province — never a hardcoded value; the ADMIN can edit
            // it before approving.
            proposedCity: organization.province,
            proposedDistrict: candidate.proposedDistrict,
            proposedIsActive: candidate.proposedIsActive,
            matchedRegionId: candidate.matchedRegionId,
          })),
        },
      },
      include: {
        regionCandidates: { select: { id: true, normalizedSourceValue: true } },
      },
    });

    const candidateIdByKey = new Map(
      created.regionCandidates.map((candidate) => [candidate.normalizedSourceValue, candidate.id])
    );

    await tx.pharmacyImportRow.createMany({
      data: analysis.rows.map((row) => ({
        batchId: created.id,
        rowNumber: row.rowNumber,
        pharmacyName: row.rawEczaneAdi,
        normalizedPharmacyName: row.normalizedPharmacyName ?? "",
        pharmacistName: row.pharmacistName,
        phone: row.phone,
        isActive: row.isActive,
        status: row.status,
        safeErrorCode: row.errorCode,
        regionId: row.matchedRegionId,
        sourceRegionText: row.rawBolge || null,
        sourceDistrictText: row.rawIlce || null,
        address: row.address,
        candidateId: row.candidateKey ? (candidateIdByKey.get(row.candidateKey) ?? null) : null,
      })),
    });

    return created;
  });

  logger.info("pharmacy_import_previewed", {
    requestId: await getRequestId(),
    userId: user.id,
    batchId: batch.id,
    totalRows: analysis.totalCount,
    readyRows: analysis.readyCount,
    ignoredColumnCount: ignoredColumnWarnings.length,
  });
  logger.info("pharmacy_import_region_candidates_discovered", {
    requestId: await getRequestId(),
    organizationId: user.organizationId,
    batchId: batch.id,
    candidateCount: analysis.candidates.length,
    matchedRegionCount: analysis.candidates.filter((c) => c.matchedRegionId !== null).length,
    newRegionCount: analysis.candidates.filter((c) => c.status === "NEW_REGION_CANDIDATE").length,
    suggestionCount: analysis.candidates.filter((c) => c.status === "ADDRESS_SUGGESTION").length,
    unresolvedCount: analysis.totalCount - analysis.rows.filter((r) => r.candidateKey).length,
  });

  redirectWithMessage(
    `/eczaneler/ice-aktar/onizleme/${batch.id}`,
    "success",
    analysis.canImport
      ? `Önizleme hazır: ${analysis.totalCount} satır analiz edildi, tümü aktarıma hazır.`
      : `Önizleme hazır: ${analysis.totalCount} satır analiz edildi. Bölge Eşleştirme bölümündeki kararlar tamamlanmadan içe aktarım yapılamaz.`
  );
}

export async function importPharmacyBatchAction(batchId: string) {
  const guard = await requireOrganizationRole("importPharmacies");
  if (!guard.user) {
    redirectWithMessage("/eczaneler/ice-aktar", "error", guard.state.message);
  }
  const { user } = guard;

  // Organization-scoped AND creator-scoped: only the ADMIN who uploaded
  // the file may consume the batch (its region decisions are theirs).
  const batch = await prisma.pharmacyImportBatch.findFirst({
    where: { id: batchId, organizationId: user.organizationId, createdById: user.id },
    select: { id: true, status: true, expiresAt: true, sanitizedFileName: true, totalRows: true },
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

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: user.organizationId },
    select: { province: true },
  });

  let createdCount = 0;
  let createdRegionCount = 0;
  let reactivatedRegionCount = 0;
  try {
    await prisma.$transaction(async (tx) => {
      // Consume-first: the conditional update takes a row lock, so a
      // concurrent double-submit of the same batch deterministically
      // fails this condition and rolls back without writing anything.
      const consumed = await tx.pharmacyImportBatch.updateMany({
        where: { id: batch.id, status: "PREVIEWED" },
        data: { status: "IMPORTED", consumedAt: new Date() },
      });
      if (consumed.count === 0) {
        throw new PharmacyImportBlockedError(
          "Bu içe aktarma zaten tamamlanmış veya süresi dolmuş.",
          "already_consumed"
        );
      }

      // Everything below is reloaded from the database INSIDE the
      // transaction — nothing from the preview render or the client is
      // trusted.
      const recompute = await recomputeAndPersistBatch(tx, batch.id, user.organizationId);
      if (!recompute.canImport) {
        throw new PharmacyImportBlockedError(
          "Bu içe aktarmada bölge kararı tamamlanmamış veya aktarıma hazır olmayan satırlar var; içe aktarım engellendi.",
          "resolution_incomplete"
        );
      }

      const [rows, candidates, orgRegions] = await Promise.all([
        tx.pharmacyImportRow.findMany({ where: { batchId: batch.id } }),
        tx.pharmacyImportRegionCandidate.findMany({ where: { batchId: batch.id } }),
        tx.region.findMany({
          where: { organizationId: user.organizationId },
          select: { id: true, name: true, district: true, isActive: true },
        }),
      ]);
      const orgRegionById = new Map(orgRegions.map((r) => [r.id, r]));
      const orgRegionByNormalizedName = new Map(
        orgRegions.map((r) => [normalizeText(r.name), r])
      );

      // Re-verify every matched candidate still points at a region this
      // organization owns, with the activity state the decision assumed.
      for (const candidate of candidates) {
        if (
          (candidate.status === "MATCHED_EXISTING_ACTIVE" ||
            candidate.status === "MATCHED_EXISTING_INACTIVE") &&
          (!candidate.matchedRegionId || !orgRegionById.has(candidate.matchedRegionId))
        ) {
          throw new PharmacyImportBlockedError(
            "Önizlemeden bu yana bölge bilgileri değişmiş; lütfen dosyayı yeniden yükleyin.",
            "stale_region"
          );
        }
        if (
          candidate.status === "MATCHED_EXISTING_ACTIVE" &&
          candidate.matchedRegionId &&
          !orgRegionById.get(candidate.matchedRegionId)!.isActive
        ) {
          throw new PharmacyImportBlockedError(
            "Eşleştirilen bir bölge önizlemeden sonra pasif yapılmış; lütfen ön izlemeyi yenileyin.",
            "region_deactivated_since_preview"
          );
        }
      }

      // Create approved new regions — one Region per unique normalized
      // proposed name. If an identically-named ACTIVE region appeared
      // since preview (manual creation racing this import), use it
      // instead of creating a duplicate; an identically-named INACTIVE
      // one needs a human decision, so abort. The DB unique constraint
      // (organizationId, name) stays the final authority underneath.
      const regionIdByCandidateId = new Map<string, string>();
      const createdRegionByNormalizedName = new Map<string, { id: string; district: string }>();
      for (const candidate of candidates) {
        if (candidate.status === "EXCLUDED_BY_ADMIN") continue;
        if (candidate.matchedRegionId && orgRegionById.has(candidate.matchedRegionId)) {
          regionIdByCandidateId.set(candidate.id, candidate.matchedRegionId);
          continue;
        }
        if (candidate.status !== "NEW_REGION_CANDIDATE" || !candidate.approvedAt) continue;

        const normalizedName = candidate.normalizedProposedName;
        const alreadyCreated = createdRegionByNormalizedName.get(normalizedName);
        if (alreadyCreated) {
          regionIdByCandidateId.set(candidate.id, alreadyCreated.id);
          continue;
        }
        const existingRegion = orgRegionByNormalizedName.get(normalizedName);
        if (existingRegion) {
          if (!existingRegion.isActive) {
            throw new PharmacyImportBlockedError(
              `"${candidate.proposedName}" adında pasif bir bölge zaten var; ön izlemede bu bölgeyle eşleştirme kararı verilmelidir.`,
              "concurrent_inactive_region"
            );
          }
          regionIdByCandidateId.set(candidate.id, existingRegion.id);
          continue;
        }

        const createdRegion = await tx.region.create({
          data: {
            name: candidate.proposedName,
            district: candidate.proposedDistrict,
            isActive: candidate.proposedIsActive,
            organizationId: user.organizationId,
          },
        });
        createdRegionCount += 1;
        createdRegionByNormalizedName.set(normalizedName, {
          id: createdRegion.id,
          district: createdRegion.district,
        });
        regionIdByCandidateId.set(candidate.id, createdRegion.id);
        orgRegionById.set(createdRegion.id, {
          id: createdRegion.id,
          name: createdRegion.name,
          district: createdRegion.district,
          isActive: createdRegion.isActive,
        });
        await writeAuditLog(tx, {
          organizationId: user.organizationId,
          userId: user.id,
          action: "CREATE",
          entity: "Region",
          entityId: createdRegion.id,
          after: {
            name: createdRegion.name,
            district: createdRegion.district,
            isActive: createdRegion.isActive,
            source: "pharmacy_import",
          },
        });
      }

      // Explicitly approved reactivations — never silent, always inside
      // this same transaction, always audited.
      for (const candidate of candidates) {
        if (
          candidate.status === "MATCHED_EXISTING_INACTIVE" &&
          candidate.approvedAt &&
          candidate.reactivateOnImport &&
          candidate.matchedRegionId
        ) {
          await tx.region.update({
            where: { id: candidate.matchedRegionId },
            data: { isActive: true },
          });
          reactivatedRegionCount += 1;
          const region = orgRegionById.get(candidate.matchedRegionId);
          await writeAuditLog(tx, {
            organizationId: user.organizationId,
            userId: user.id,
            action: "UPDATE",
            entity: "Region",
            entityId: candidate.matchedRegionId,
            before: { isActive: false },
            after: { isActive: true, name: region?.name, source: "pharmacy_import_reactivation" },
          });
        }
      }

      // Create the pharmacies: only READY rows (EXCLUDED rows are
      // skipped by design); each row's final region is either its
      // recomputed matched regionId or its candidate's newly created
      // region. Pharmacy uniqueness is rechecked by the DB's
      // (regionId, normalizedName) constraint — any violation rolls
      // back everything above, including created regions.
      const candidateById = new Map(candidates.map((c) => [c.id, c]));
      const readyRowIds = new Set(
        recompute.rows.filter((r) => r.status === "READY").map((r) => r.id)
      );
      for (const row of rows) {
        if (!readyRowIds.has(row.id)) continue;
        const candidate = row.candidateId ? candidateById.get(row.candidateId) : undefined;
        const finalRegionId =
          (candidate ? regionIdByCandidateId.get(candidate.id) : undefined) ?? row.regionId;
        if (!finalRegionId || !orgRegionById.has(finalRegionId)) {
          throw new PharmacyImportBlockedError(
            "Önizlemeden bu yana bölge bilgileri değişmiş; lütfen dosyayı yeniden yükleyin.",
            "stale_region"
          );
        }
        const finalRegion = orgRegionById.get(finalRegionId)!;
        const isNewlyCreatedRegion = createdRegionByNormalizedName.has(
          normalizeText(finalRegion.name)
        );

        await tx.pharmacy.create({
          data: {
            name: row.pharmacyName,
            normalizedName: row.normalizedPharmacyName,
            pharmacistName: row.pharmacistName ?? "",
            phone: row.phone ?? "",
            // Address comes from the validated optional Adres column
            // (blank stays the application-compatible empty string).
            // City: the ADMIN-approved candidate city for regions created
            // by this import, the organization's own province otherwise.
            // District: always the final region's own district.
            address: row.address ?? "",
            city:
              isNewlyCreatedRegion && candidate?.proposedCity
                ? candidate.proposedCity
                : organization.province,
            district: finalRegion.district,
            isActive: row.isActive,
            regionId: finalRegionId,
            requestToken: randomBytes(16).toString("hex"),
          },
        });
        await tx.pharmacyImportRow.update({
          where: { id: row.id },
          data: { regionId: finalRegionId },
        });
        createdCount += 1;
      }

      if (createdCount === 0) {
        throw new PharmacyImportBlockedError(
          "Aktarıma hazır satır kalmadı; içe aktarım yapılmadı.",
          "nothing_to_import"
        );
      }

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
          createdRegionCount,
          reactivatedRegionCount,
          excludedCount: recompute.excludedCount,
        },
      });
    });
  } catch (error) {
    if (error instanceof PharmacyImportBlockedError) {
      logger.warn("pharmacy_import_region_resolution_failed", {
        requestId: await getRequestId(),
        organizationId: user.organizationId,
        userId: user.id,
        batchId: batch.id,
        safeErrorCode: error.reasonCode,
      });
      redirectWithMessage(`/eczaneler/ice-aktar/onizleme/${batch.id}`, "error", error.message);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      logger.warn("pharmacy_import_failed", {
        requestId: await getRequestId(),
        userId: user.id,
        batchId: batch.id,
        reason: "unique_constraint_conflict",
      });
      redirectWithMessage(
        `/eczaneler/ice-aktar/onizleme/${batch.id}`,
        "error",
        "İçe aktarım sırasında aynı adlı bir bölge veya eczane kaydı oluşturuldu; hiçbir değişiklik yapılmadı. Lütfen ön izlemeyi yenileyip tekrar deneyin."
      );
    }
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

  if (createdRegionCount > 0) {
    logger.info("pharmacy_import_regions_created", {
      requestId: await getRequestId(),
      organizationId: user.organizationId,
      batchId: batch.id,
      newRegionCount: createdRegionCount,
    });
  }
  if (reactivatedRegionCount > 0) {
    logger.info("pharmacy_import_regions_reactivated", {
      requestId: await getRequestId(),
      organizationId: user.organizationId,
      batchId: batch.id,
      reactivatedRegionCount,
    });
  }
  logger.info("pharmacy_import_completed", {
    requestId: await getRequestId(),
    userId: user.id,
    batchId: batch.id,
    createdCount,
    createdRegionCount,
    reactivatedRegionCount,
  });

  revalidatePath("/eczaneler");
  revalidatePath("/bolgeler");
  const regionSummary =
    createdRegionCount > 0 ? `, ${createdRegionCount} yeni bölge oluşturuldu` : "";
  redirectWithMessage(
    "/eczaneler",
    "success",
    `Excel içe aktarımı tamamlandı: ${createdCount} eczane oluşturuldu${regionSummary}.`
  );
}
