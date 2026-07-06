"use server";

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
    mapUrl: formData.get("mapUrl"),
    isActive: formData.get("isActive") === "on",
  });
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

  const { mapUrl, ...rest } = parsed.data;
  const pharmacy = await prisma.pharmacy.create({
    data: { ...rest, mapUrl: mapUrl || null },
  });

  await writeAuditLog({
    userId: user.id,
    action: "CREATE",
    entity: "Pharmacy",
    entityId: pharmacy.id,
    after: pharmacy,
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

  const { mapUrl, ...rest } = parsed.data;
  const pharmacy = await prisma.pharmacy.update({
    where: { id },
    data: { ...rest, mapUrl: mapUrl || null },
  });

  await writeAuditLog({
    userId: user.id,
    action: "UPDATE",
    entity: "Pharmacy",
    entityId: pharmacy.id,
    before,
    after: pharmacy,
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
    before: pharmacy,
    after: updated,
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
    before: pharmacy,
  });

  revalidatePath("/eczaneler");
  redirectWithMessage("/eczaneler", "success", "Eczane silindi.");
}
