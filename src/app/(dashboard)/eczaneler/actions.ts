"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requirePermissionOrRedirect, requirePermissionOrState } from "@/lib/auth/guard";
import { writeAuditLog } from "@/lib/audit";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { pharmacySchema } from "@/lib/validations/pharmacy";
import { type ActionState, zodErrorState } from "@/lib/action-state";

function parsePharmacyForm(formData: FormData) {
  return pharmacySchema.safeParse({
    name: formData.get("name"),
    pharmacistName: formData.get("pharmacistName"),
    phone: formData.get("phone"),
    address: formData.get("address"),
    city: formData.get("city"),
    district: formData.get("district"),
    regionId: formData.get("regionId"),
    email: formData.get("email"),
    mapUrl: formData.get("mapUrl"),
    isActive: formData.get("isActive") === "on",
  });
}

// Denetim kaydına yazılacak alanlar: requestToken gibi gizli alanlar
// bilinçli olarak dışarıda bırakılır.
function pharmacyAuditPayload(pharmacy: {
  name: string;
  pharmacistName: string;
  phone: string;
  address: string;
  city: string;
  district: string;
  email: string | null;
  mapUrl: string | null;
  isActive: boolean;
  regionId: string;
}) {
  return {
    name: pharmacy.name,
    pharmacistName: pharmacy.pharmacistName,
    phone: pharmacy.phone,
    address: pharmacy.address,
    city: pharmacy.city,
    district: pharmacy.district,
    email: pharmacy.email,
    mapUrl: pharmacy.mapUrl,
    isActive: pharmacy.isActive,
    regionId: pharmacy.regionId,
  };
}

export async function createPharmacyAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requirePermissionOrState("manageSetupData");
  if (!guard.user) return guard.state;
  const { user } = guard;

  const parsed = parsePharmacyForm(formData);
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const { mapUrl, email, ...rest } = parsed.data;
  const pharmacy = await prisma.pharmacy.create({
    data: {
      ...rest,
      mapUrl: mapUrl || null,
      email: email || null,
      // Herkese açık nöbet talep formu bağlantısı için eczaneye özel token.
      requestToken: randomBytes(16).toString("hex"),
    },
  });

  await writeAuditLog({
    userId: user.id,
    action: "CREATE",
    entity: "Pharmacy",
    entityId: pharmacy.id,
    after: pharmacyAuditPayload(pharmacy),
  });

  revalidatePath("/eczaneler");
  redirectWithMessage("/eczaneler", "success", "Eczane oluşturuldu.");
}

export async function updatePharmacyAction(
  id: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requirePermissionOrState("manageSetupData");
  if (!guard.user) return guard.state;
  const { user } = guard;

  const parsed = parsePharmacyForm(formData);
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const before = await prisma.pharmacy.findUnique({ where: { id } });
  if (!before) {
    return { success: false, message: "Eczane bulunamadı." };
  }

  const { mapUrl, email, ...rest } = parsed.data;
  const pharmacy = await prisma.pharmacy.update({
    where: { id },
    data: { ...rest, mapUrl: mapUrl || null, email: email || null },
  });

  await writeAuditLog({
    userId: user.id,
    action: "UPDATE",
    entity: "Pharmacy",
    entityId: pharmacy.id,
    before: pharmacyAuditPayload(before),
    after: pharmacyAuditPayload(pharmacy),
  });

  revalidatePath("/eczaneler");
  redirectWithMessage("/eczaneler", "success", "Eczane güncellendi.");
}

export async function togglePharmacyStatusAction(id: string) {
  const user = await requirePermissionOrRedirect("manageSetupData", "/eczaneler");

  const pharmacy = await prisma.pharmacy.findUnique({ where: { id } });
  if (!pharmacy) {
    redirectWithMessage("/eczaneler", "error", "Eczane bulunamadı.");
  }

  const updated = await prisma.pharmacy.update({
    where: { id },
    data: { isActive: !pharmacy.isActive },
  });

  await writeAuditLog({
    userId: user.id,
    action: "UPDATE",
    entity: "Pharmacy",
    entityId: id,
    before: pharmacyAuditPayload(pharmacy),
    after: pharmacyAuditPayload(updated),
  });

  revalidatePath("/eczaneler");
  redirectWithMessage(
    "/eczaneler",
    "success",
    updated.isActive ? "Eczane aktif yapıldı." : "Eczane pasif yapıldı."
  );
}

export async function deletePharmacyAction(id: string) {
  const user = await requirePermissionOrRedirect("manageSetupData", "/eczaneler");

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

  const pharmacy = await prisma.pharmacy.findUnique({ where: { id } });
  if (!pharmacy) {
    redirectWithMessage("/eczaneler", "error", "Eczane bulunamadı.");
  }

  await prisma.pharmacy.delete({ where: { id } });

  await writeAuditLog({
    userId: user.id,
    action: "DELETE",
    entity: "Pharmacy",
    entityId: id,
    before: pharmacyAuditPayload(pharmacy),
  });

  revalidatePath("/eczaneler");
  redirectWithMessage("/eczaneler", "success", "Eczane silindi.");
}
