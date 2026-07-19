"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireOrganizationRole, requireOrganizationRoleOrRedirect } from "@/lib/auth/tenant";
import { writeAuditLog } from "@/lib/audit";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { normalizeText } from "@/lib/historical/normalize";
import { pharmacySchema } from "@/lib/validations/pharmacy";
import { type ActionState, zodErrorState } from "@/lib/action-state";

const PHARMACY_NOT_FOUND_STATE: ActionState = { success: false, message: "Eczane bulunamadı." };
const REGION_NOT_FOUND_STATE: ActionState = {
  success: false,
  message: "Seçilen bölge bulunamadı.",
  errors: { regionId: ["Seçilen bölge bulunamadı."] },
};
const SERVICE_AREA_NOT_FOUND_STATE: ActionState = {
  success: false,
  message: "Seçilen hizmet alanı bu bölgeye ait değil.",
  errors: { serviceAreaId: ["Seçilen hizmet alanı bu bölgeye ait değil."] },
};

function parsePharmacyForm(formData: FormData) {
  return pharmacySchema.safeParse({
    name: formData.get("name"),
    pharmacistName: formData.get("pharmacistName"),
    phone: formData.get("phone"),
    address: formData.get("address"),
    city: formData.get("city"),
    district: formData.get("district"),
    regionId: formData.get("regionId"),
    // A caller that never renders/sets this field (an unset FormData entry
    // is null, not undefined) must be treated the same as an explicit "" —
    // both mean untagged — rather than failing schema validation.
    serviceAreaId: formData.get("serviceAreaId") ?? "",
    mapUrl: formData.get("mapUrl"),
    isActive: formData.get("isActive") === "on",
  });
}

// Cross-tenant relation validation: a client-supplied regionId is only
// ever trusted after confirming it belongs to the authenticated user's
// own organization — never a bare existence check. Prevents Organization
// A from submitting Organization B's real regionId.
async function findOwnedRegion(regionId: string, organizationId: string) {
  return prisma.region.findFirst({ where: { id: regionId, organizationId } });
}

// A client-supplied serviceAreaId is only trusted after confirming it
// belongs to BOTH the caller's own organization AND the exact region the
// pharmacy is being placed in — a service area from a different region
// (even within the same organization) is never accepted, since
// ServiceArea is a sub-grouping of one specific region, not the org.
async function findOwnedServiceArea(serviceAreaId: string, regionId: string, organizationId: string) {
  return prisma.serviceArea.findFirst({
    where: { id: serviceAreaId, regionId, region: { organizationId } },
  });
}

export async function createPharmacyAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requireOrganizationRole("manageSetupData");
  if (!guard.user) return guard.state;
  const { user } = guard;

  const parsed = parsePharmacyForm(formData);
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const region = await findOwnedRegion(parsed.data.regionId, user.organizationId);
  if (!region) {
    return REGION_NOT_FOUND_STATE;
  }
  if (parsed.data.serviceAreaId) {
    const serviceArea = await findOwnedServiceArea(
      parsed.data.serviceAreaId,
      parsed.data.regionId,
      user.organizationId
    );
    if (!serviceArea) {
      return SERVICE_AREA_NOT_FOUND_STATE;
    }
  }

  const { mapUrl, serviceAreaId, ...rest } = parsed.data;
  await prisma.$transaction(async (tx) => {
    const created = await tx.pharmacy.create({
      data: {
        ...rest,
        normalizedName: normalizeText(rest.name),
        mapUrl: mapUrl || null,
        serviceAreaId: serviceAreaId || null,
        // Herkese açık nöbet talep formu bağlantısı için eczaneye özel token.
        requestToken: randomBytes(16).toString("hex"),
      },
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "CREATE",
      entity: "Pharmacy",
      entityId: created.id,
      after: created,
    });
  });

  revalidatePath("/eczaneler");
  redirectWithMessage("/eczaneler", "success", "Eczane oluşturuldu.");
}

export async function updatePharmacyAction(
  id: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requireOrganizationRole("manageSetupData");
  if (!guard.user) return guard.state;
  const { user } = guard;

  const parsed = parsePharmacyForm(formData);
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  // Pharmacy has no direct organizationId column — ownership is derived
  // through region.organizationId. Verified here, before the mutating
  // call, in the same request/transaction — never fetched globally and
  // compared only in the UI.
  const before = await prisma.pharmacy.findFirst({
    where: { id, region: { organizationId: user.organizationId } },
  });
  if (!before) {
    return PHARMACY_NOT_FOUND_STATE;
  }

  const region = await findOwnedRegion(parsed.data.regionId, user.organizationId);
  if (!region) {
    return REGION_NOT_FOUND_STATE;
  }
  if (parsed.data.serviceAreaId) {
    const serviceArea = await findOwnedServiceArea(
      parsed.data.serviceAreaId,
      parsed.data.regionId,
      user.organizationId
    );
    if (!serviceArea) {
      return SERVICE_AREA_NOT_FOUND_STATE;
    }
  }

  const { mapUrl, serviceAreaId, ...rest } = parsed.data;
  await prisma.$transaction(async (tx) => {
    const updated = await tx.pharmacy.update({
      where: { id },
      data: {
        ...rest,
        normalizedName: normalizeText(rest.name),
        mapUrl: mapUrl || null,
        serviceAreaId: serviceAreaId || null,
      },
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "UPDATE",
      entity: "Pharmacy",
      entityId: updated.id,
      before,
      after: updated,
    });
  });

  revalidatePath("/eczaneler");
  redirectWithMessage("/eczaneler", "success", "Eczane güncellendi.");
}

// Bu, eskiden mevcut DB değerini okuyup tersine çeviren bir "toggle" idi;
// çift gönderimde (çift tıklama, form yeniden gönderimi) iki kez tersine
// çevrilip kullanıcının amaçladığı değişikliği sessizce iptal edebiliyordu.
// Artık istenen hedef durum doğrudan çağrıdan alınır (buton, render anındaki
// mevcut durumun tersini sabit bir değer olarak gönderir), böylece aynı
// isteğin tekrarı her zaman aynı sonuca yakınsar.
export async function setPharmacyStatusAction(id: string, isActive: boolean) {
  const user = await requireOrganizationRoleOrRedirect("manageSetupData", "/eczaneler");

  const pharmacy = await prisma.pharmacy.findFirst({
    where: { id, region: { organizationId: user.organizationId } },
  });
  if (!pharmacy) {
    redirectWithMessage("/eczaneler", "error", "Eczane bulunamadı.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.pharmacy.update({
      where: { id },
      data: { isActive },
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "UPDATE",
      entity: "Pharmacy",
      entityId: id,
      before: pharmacy,
      after: next,
    });
    return next;
  });

  revalidatePath("/eczaneler");
  redirectWithMessage(
    "/eczaneler",
    "success",
    updated.isActive ? "Eczane aktif yapıldı." : "Eczane pasif yapıldı."
  );
}

export async function deletePharmacyAction(id: string) {
  const user = await requireOrganizationRoleOrRedirect("deleteSetupData", "/eczaneler");

  const pharmacy = await prisma.pharmacy.findFirst({
    where: { id, region: { organizationId: user.organizationId } },
  });
  if (!pharmacy) {
    redirectWithMessage("/eczaneler", "error", "Eczane bulunamadı.");
  }

  const assignmentCount = await prisma.dutyAssignment.count({
    where: { pharmacyId: id },
  });
  if (assignmentCount > 0) {
    redirectWithMessage(
      "/eczaneler",
      "error",
      "Bu eczaneye ait nöbet ataması olduğu için silinemez."
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.pharmacy.delete({ where: { id } });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "DELETE",
      entity: "Pharmacy",
      entityId: id,
      before: pharmacy,
    });
  });

  revalidatePath("/eczaneler");
  redirectWithMessage("/eczaneler", "success", "Eczane silindi.");
}
