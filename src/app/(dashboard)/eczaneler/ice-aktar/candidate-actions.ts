"use server";

// Region-candidate decisions during Pharmacy Excel Import preview.
// Every action here:
//   - requires the importPharmacies permission (ADMIN only),
//   - loads the candidate/batch org-scoped AND creator-scoped (the
//     preview session belongs to the ADMIN who uploaded the file),
//   - refuses consumed/expired batches,
//   - re-derives every affected row status via the shared pure recompute
//     engine inside one transaction,
//   - never writes a Region row (that happens only inside the final
//     import transaction in actions.ts),
//   - never logs raw candidate text, pharmacy data, or addresses.

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireOrganizationRole } from "@/lib/auth/tenant";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { logger } from "@/lib/observability/logger";
import { getRequestId } from "@/lib/observability/request-id";
import { normalizeText } from "@/lib/historical/normalize";
import { recomputeAndPersistBatch } from "@/lib/pharmacy-import/batch-recompute";
import { regionCandidateEditSchema } from "@/lib/validations/region-candidate";
import type { OrganizationUser } from "@/lib/auth/tenant";

function previewPath(batchId: string): string {
  return `/eczaneler/ice-aktar/onizleme/${batchId}`;
}

// Loads a candidate together with its batch, enforcing tenant + creator
// ownership and the editable (PREVIEWED, unexpired) state. Returns null
// when anything fails — callers redirect with a controlled message and
// never learn whether a foreign id exists.
async function loadEditableCandidate(candidateId: string, user: OrganizationUser) {
  const candidate = await prisma.pharmacyImportRegionCandidate.findFirst({
    where: {
      id: candidateId,
      batch: { organizationId: user.organizationId, createdById: user.id },
    },
    include: { batch: { select: { id: true, status: true, expiresAt: true } } },
  });
  if (!candidate) return null;
  if (candidate.batch.status !== "PREVIEWED" || candidate.batch.expiresAt.getTime() < Date.now()) {
    return { candidate, editable: false } as const;
  }
  return { candidate, editable: true } as const;
}

async function guardedUser() {
  const guard = await requireOrganizationRole("importPharmacies");
  if (!guard.user) {
    redirectWithMessage("/eczaneler/ice-aktar", "error", guard.state.message);
  }
  return guard.user;
}

function candidateNotEditableRedirect(batchId?: string): never {
  redirectWithMessage(
    batchId ? previewPath(batchId) : "/eczaneler/ice-aktar",
    "error",
    "Bu ön izleme artık düzenlenemez (tamamlanmış veya süresi dolmuş)."
  );
}

async function logCandidateEvent(
  event: string,
  user: OrganizationUser,
  batchId: string,
  extra: Record<string, string | number | boolean> = {}
) {
  logger.info(event, {
    requestId: await getRequestId(),
    organizationId: user.organizationId,
    batchId,
    ...extra,
  });
}

// Detects a proposed name that collides with an existing region of this
// organization or with another candidate of the same batch. Returns a
// Turkish message, or null when the name is free.
async function findProposedNameConflict(
  organizationId: string,
  batchId: string,
  candidateIdToIgnore: string | null,
  proposedName: string
): Promise<string | null> {
  const normalized = normalizeText(proposedName);
  const orgRegions = await prisma.region.findMany({
    where: { organizationId },
    select: { name: true },
  });
  if (orgRegions.some((region) => normalizeText(region.name) === normalized)) {
    return `"${proposedName}" adında bir bölge bu odada zaten var; "Mevcut bölgeyle eşleştir" seçeneğini kullanın.`;
  }
  const sibling = await prisma.pharmacyImportRegionCandidate.findFirst({
    where: {
      batchId,
      normalizedProposedName: normalized,
      ...(candidateIdToIgnore ? { id: { not: candidateIdToIgnore } } : {}),
    },
    select: { id: true },
  });
  if (sibling) {
    return `"${proposedName}" adı bu dosyadaki başka bir bölge adayında zaten kullanılıyor.`;
  }
  return null;
}

// --- Edit the proposed name / city / district / active state -------------

export async function updateRegionCandidateAction(candidateId: string, formData: FormData) {
  const user = await guardedUser();
  const loaded = await loadEditableCandidate(candidateId, user);
  if (!loaded) {
    redirectWithMessage("/eczaneler/ice-aktar", "error", "Bölge adayı bulunamadı.");
  }
  if (!loaded.editable) candidateNotEditableRedirect(loaded.candidate.batchId);
  const { candidate } = loaded;

  const parsed = regionCandidateEditSchema.safeParse({
    proposedName: formData.get("proposedName"),
    proposedCity: formData.get("proposedCity"),
    proposedDistrict: formData.get("proposedDistrict"),
    proposedIsActive: formData.get("proposedIsActive") === "on",
  });
  if (!parsed.success) {
    redirectWithMessage(
      previewPath(candidate.batchId),
      "error",
      parsed.error.issues[0]?.message ?? "Lütfen bölge adayı alanlarını düzeltin."
    );
  }

  const conflict = await findProposedNameConflict(
    user.organizationId,
    candidate.batchId,
    candidate.id,
    parsed.data.proposedName
  );
  if (conflict) {
    redirectWithMessage(previewPath(candidate.batchId), "error", conflict);
  }

  await prisma.$transaction(async (tx) => {
    await tx.pharmacyImportRegionCandidate.update({
      where: { id: candidate.id },
      data: {
        proposedName: parsed.data.proposedName,
        normalizedProposedName: normalizeText(parsed.data.proposedName),
        proposedCity: parsed.data.proposedCity,
        proposedDistrict: parsed.data.proposedDistrict,
        proposedIsActive: parsed.data.proposedIsActive,
        // Editing invalidates any earlier decision — the ADMIN re-approves
        // the edited candidate explicitly. A matched candidate stays
        // matched only via the match action, so clear it here too.
        approvedAt: null,
        reactivateOnImport: false,
        matchedRegionId: null,
        status:
          candidate.sourceType === "ADDRESS_SUGGESTION" && candidate.status === "ADDRESS_SUGGESTION"
            ? "ADDRESS_SUGGESTION"
            : "NEW_REGION_CANDIDATE",
      },
    });
    await recomputeAndPersistBatch(tx, candidate.batchId, user.organizationId);
  });

  await logCandidateEvent("pharmacy_import_region_candidate_updated", user, candidate.batchId);
  revalidatePath(previewPath(candidate.batchId));
  redirectWithMessage(previewPath(candidate.batchId), "success", "Bölge adayı güncellendi.");
}

// --- Approve (new region / address suggestion / inactive decision) -------

export async function approveRegionCandidateAction(candidateId: string, formData: FormData) {
  const user = await guardedUser();
  const loaded = await loadEditableCandidate(candidateId, user);
  if (!loaded) {
    redirectWithMessage("/eczaneler/ice-aktar", "error", "Bölge adayı bulunamadı.");
  }
  if (!loaded.editable) candidateNotEditableRedirect(loaded.candidate.batchId);
  const { candidate } = loaded;

  const mode = formData.get("mode");

  await prisma.$transaction(async (tx) => {
    if (candidate.status === "MATCHED_EXISTING_INACTIVE") {
      // The explicit inactive-region decision: keep it inactive (import
      // into it as-is) or reactivate it during the final transaction.
      if (mode !== "keep-inactive" && mode !== "reactivate") {
        redirectWithMessage(
          previewPath(candidate.batchId),
          "error",
          "Pasif bölge için karar seçilmelidir (pasif bırak veya yeniden aktifleştir)."
        );
      }
      await tx.pharmacyImportRegionCandidate.update({
        where: { id: candidate.id },
        data: { approvedAt: new Date(), reactivateOnImport: mode === "reactivate" },
      });
    } else if (candidate.status === "ADDRESS_SUGGESTION" && candidate.matchedRegionId) {
      // Accepting a suggestion that matches an existing region becomes a
      // normal match (active or inactive, decided by the region's state).
      const region = await tx.region.findFirst({
        where: { id: candidate.matchedRegionId, organizationId: user.organizationId },
        select: { isActive: true },
      });
      if (!region) {
        redirectWithMessage(
          previewPath(candidate.batchId),
          "error",
          "Önerinin eşleştiği bölge artık bulunamıyor; adayı düzenleyip yeniden onaylayın."
        );
      }
      await tx.pharmacyImportRegionCandidate.update({
        where: { id: candidate.id },
        data: {
          status: region.isActive ? "MATCHED_EXISTING_ACTIVE" : "MATCHED_EXISTING_INACTIVE",
          approvedAt: region.isActive ? new Date() : null,
        },
      });
    } else {
      // New-region approval (covers NEW_REGION_CANDIDATE, a non-matching
      // ADDRESS_SUGGESTION, and edited AMBIGUOUS/UNRESOLVED candidates).
      const conflict = await findProposedNameConflict(
        user.organizationId,
        candidate.batchId,
        candidate.id,
        candidate.proposedName
      );
      if (conflict) {
        redirectWithMessage(previewPath(candidate.batchId), "error", conflict);
      }
      await tx.pharmacyImportRegionCandidate.update({
        where: { id: candidate.id },
        data: { status: "NEW_REGION_CANDIDATE", approvedAt: new Date() },
      });
    }
    await recomputeAndPersistBatch(tx, candidate.batchId, user.organizationId);
  });

  await logCandidateEvent("pharmacy_import_region_candidate_approved", user, candidate.batchId);
  revalidatePath(previewPath(candidate.batchId));
  redirectWithMessage(previewPath(candidate.batchId), "success", "Bölge adayı onaylandı.");
}

// --- Match to an existing region of this organization --------------------

export async function matchRegionCandidateAction(candidateId: string, formData: FormData) {
  const user = await guardedUser();
  const loaded = await loadEditableCandidate(candidateId, user);
  if (!loaded) {
    redirectWithMessage("/eczaneler/ice-aktar", "error", "Bölge adayı bulunamadı.");
  }
  if (!loaded.editable) candidateNotEditableRedirect(loaded.candidate.batchId);
  const { candidate } = loaded;

  const regionId = formData.get("regionId");
  if (typeof regionId !== "string" || !regionId) {
    redirectWithMessage(previewPath(candidate.batchId), "error", "Lütfen bir bölge seçin.");
  }

  // Cross-tenant relation validation: regionId is client-supplied, only
  // trusted after confirming it belongs to this organization.
  const region = await prisma.region.findFirst({
    where: { id: regionId, organizationId: user.organizationId },
    select: { id: true, isActive: true },
  });
  if (!region) {
    redirectWithMessage(previewPath(candidate.batchId), "error", "Seçilen bölge bulunamadı.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.pharmacyImportRegionCandidate.update({
      where: { id: candidate.id },
      data: {
        matchedRegionId: region.id,
        status: region.isActive ? "MATCHED_EXISTING_ACTIVE" : "MATCHED_EXISTING_INACTIVE",
        // Matching an ACTIVE region is itself the complete decision; an
        // INACTIVE match still needs the keep-inactive/reactivate choice.
        approvedAt: region.isActive ? new Date() : null,
        reactivateOnImport: false,
      },
    });
    await recomputeAndPersistBatch(tx, candidate.batchId, user.organizationId);
  });

  await logCandidateEvent("pharmacy_import_region_candidate_updated", user, candidate.batchId, {
    action: "matched_existing",
  });
  revalidatePath(previewPath(candidate.batchId));
  redirectWithMessage(
    previewPath(candidate.batchId),
    "success",
    region.isActive
      ? "Aday mevcut bölgeyle eşleştirildi."
      : "Aday pasif bir bölgeyle eşleştirildi; pasif bırakma veya yeniden aktifleştirme kararı bekliyor."
  );
}

// --- Reset / reject (undo decision, reject suggestion, undo exclusion) ---

export async function resetRegionCandidateAction(candidateId: string, formData: FormData) {
  const user = await guardedUser();
  const loaded = await loadEditableCandidate(candidateId, user);
  if (!loaded) {
    redirectWithMessage("/eczaneler/ice-aktar", "error", "Bölge adayı bulunamadı.");
  }
  if (!loaded.editable) candidateNotEditableRedirect(loaded.candidate.batchId);
  const { candidate } = loaded;

  // Rejecting an address-derived suggestion leaves its rows UNRESOLVED —
  // the ADMIN then assigns or defines a region explicitly. The plain
  // reset re-classifies from the source value instead.
  if (formData.get("mode") === "reject-suggestion") {
    await prisma.$transaction(async (tx) => {
      await tx.pharmacyImportRegionCandidate.update({
        where: { id: candidate.id },
        data: {
          status: "UNRESOLVED",
          matchedRegionId: null,
          approvedAt: null,
          reactivateOnImport: false,
        },
      });
      await recomputeAndPersistBatch(tx, candidate.batchId, user.organizationId);
    });
    await logCandidateEvent("pharmacy_import_region_candidate_rejected", user, candidate.batchId, {
      action: "suggestion_rejected",
    });
    revalidatePath(previewPath(candidate.batchId));
    redirectWithMessage(previewPath(candidate.batchId), "success", "Adres önerisi reddedildi.");
  }

  await prisma.$transaction(async (tx) => {
    // Re-classify from scratch: does the source value match a current
    // region of this organization?
    const normalized = normalizeText(candidate.sourceValue);
    const orgRegions = await tx.region.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true, name: true, isActive: true },
    });
    const matched = orgRegions.find((region) => normalizeText(region.name) === normalized) ?? null;
    const status = matched
      ? matched.isActive
        ? "MATCHED_EXISTING_ACTIVE"
        : "MATCHED_EXISTING_INACTIVE"
      : candidate.sourceType === "ADDRESS_SUGGESTION"
        ? "ADDRESS_SUGGESTION"
        : candidate.sourceType === "MANUAL"
          ? "NEW_REGION_CANDIDATE"
          : "NEW_REGION_CANDIDATE";
    await tx.pharmacyImportRegionCandidate.update({
      where: { id: candidate.id },
      data: {
        matchedRegionId: matched?.id ?? null,
        status,
        approvedAt: null,
        reactivateOnImport: false,
      },
    });
    await recomputeAndPersistBatch(tx, candidate.batchId, user.organizationId);
  });

  await logCandidateEvent("pharmacy_import_region_candidate_rejected", user, candidate.batchId, {
    action: "reset",
  });
  revalidatePath(previewPath(candidate.batchId));
  redirectWithMessage(previewPath(candidate.batchId), "success", "Bölge adayı kararı geri alındı.");
}

// --- Exclude from this import --------------------------------------------

export async function excludeRegionCandidateAction(candidateId: string) {
  const user = await guardedUser();
  const loaded = await loadEditableCandidate(candidateId, user);
  if (!loaded) {
    redirectWithMessage("/eczaneler/ice-aktar", "error", "Bölge adayı bulunamadı.");
  }
  if (!loaded.editable) candidateNotEditableRedirect(loaded.candidate.batchId);
  const { candidate } = loaded;

  await prisma.$transaction(async (tx) => {
    await tx.pharmacyImportRegionCandidate.update({
      where: { id: candidate.id },
      data: { status: "EXCLUDED_BY_ADMIN", approvedAt: null, reactivateOnImport: false },
    });
    await recomputeAndPersistBatch(tx, candidate.batchId, user.organizationId);
  });

  await logCandidateEvent("pharmacy_import_region_candidate_rejected", user, candidate.batchId, {
    action: "excluded",
  });
  revalidatePath(previewPath(candidate.batchId));
  redirectWithMessage(
    previewPath(candidate.batchId),
    "success",
    "Bölge adayı ve bağlı satırlar bu içe aktarımın dışında bırakıldı."
  );
}

// --- Define a manual region candidate inside the preview -----------------

export async function createManualRegionCandidateAction(batchId: string, formData: FormData) {
  const user = await guardedUser();

  // Creator + tenant + state checks on the batch itself.
  const batch = await prisma.pharmacyImportBatch.findFirst({
    where: { id: batchId, organizationId: user.organizationId, createdById: user.id },
    select: { id: true, status: true, expiresAt: true },
  });
  if (!batch) {
    redirectWithMessage("/eczaneler/ice-aktar", "error", "İçe aktarma kaydı bulunamadı.");
  }
  if (batch.status !== "PREVIEWED" || batch.expiresAt.getTime() < Date.now()) {
    candidateNotEditableRedirect(batch.id);
  }

  const parsed = regionCandidateEditSchema.safeParse({
    proposedName: formData.get("proposedName"),
    proposedCity: formData.get("proposedCity"),
    proposedDistrict: formData.get("proposedDistrict"),
    proposedIsActive: formData.get("proposedIsActive") === "on",
  });
  if (!parsed.success) {
    redirectWithMessage(
      previewPath(batch.id),
      "error",
      parsed.error.issues[0]?.message ?? "Lütfen bölge alanlarını düzeltin."
    );
  }

  const conflict = await findProposedNameConflict(
    user.organizationId,
    batch.id,
    null,
    parsed.data.proposedName
  );
  if (conflict) {
    redirectWithMessage(previewPath(batch.id), "error", conflict);
  }

  const normalized = normalizeText(parsed.data.proposedName);
  // The batch-level unique constraint on normalizedSourceValue is the
  // final authority against a duplicate candidate racing this check.
  await prisma.pharmacyImportRegionCandidate.create({
    data: {
      batchId: batch.id,
      sourceValue: parsed.data.proposedName,
      normalizedSourceValue: normalized,
      sourceType: "MANUAL",
      status: "NEW_REGION_CANDIDATE",
      proposedName: parsed.data.proposedName,
      normalizedProposedName: normalized,
      proposedCity: parsed.data.proposedCity,
      proposedDistrict: parsed.data.proposedDistrict,
      proposedIsActive: parsed.data.proposedIsActive,
      // Manually defined by the ADMIN — explicitly approved by that act.
      approvedAt: new Date(),
    },
  });

  await logCandidateEvent("pharmacy_import_region_candidate_updated", user, batch.id, {
    action: "manual_created",
  });
  revalidatePath(previewPath(batch.id));
  redirectWithMessage(
    previewPath(batch.id),
    "success",
    "Manuel bölge adayı oluşturuldu; satırlara atayabilirsiniz."
  );
}

// --- Assign an unresolved row to a candidate ------------------------------

export async function assignRowToCandidateAction(rowId: string, formData: FormData) {
  const user = await guardedUser();

  const row = await prisma.pharmacyImportRow.findFirst({
    where: {
      id: rowId,
      batch: { organizationId: user.organizationId, createdById: user.id },
    },
    select: { id: true, batchId: true, batch: { select: { status: true, expiresAt: true } } },
  });
  if (!row) {
    redirectWithMessage("/eczaneler/ice-aktar", "error", "Satır bulunamadı.");
  }
  if (row.batch.status !== "PREVIEWED" || row.batch.expiresAt.getTime() < Date.now()) {
    candidateNotEditableRedirect(row.batchId);
  }

  const candidateId = formData.get("candidateId");
  if (typeof candidateId !== "string" || !candidateId) {
    redirectWithMessage(previewPath(row.batchId), "error", "Lütfen bir bölge adayı seçin.");
  }
  // The target candidate must belong to the SAME batch (and therefore
  // the same organization) — a foreign candidate id changes nothing.
  const candidate = await prisma.pharmacyImportRegionCandidate.findFirst({
    where: { id: candidateId, batchId: row.batchId },
    select: { id: true },
  });
  if (!candidate) {
    redirectWithMessage(previewPath(row.batchId), "error", "Seçilen bölge adayı bulunamadı.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.pharmacyImportRow.update({
      where: { id: row.id },
      data: { candidateId: candidate.id },
    });
    await recomputeAndPersistBatch(tx, row.batchId, user.organizationId);
  });

  await logCandidateEvent("pharmacy_import_region_candidate_updated", user, row.batchId, {
    action: "row_assigned",
  });
  revalidatePath(previewPath(row.batchId));
  redirectWithMessage(previewPath(row.batchId), "success", "Satır, seçilen bölge adayına atandı.");
}
