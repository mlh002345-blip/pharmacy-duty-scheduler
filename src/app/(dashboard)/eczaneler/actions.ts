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
  await prisma.$transaction(async (tx) => {
    const created = await tx.pharmacy.create({
      data: {
        ...rest,
        mapUrl: mapUrl || null,
        // Herkese açık nöbet talep formu bağlantısı için eczaneye özel token.
        requestToken: randomBytes(16).toString("hex"),
      },
    });
    await writeAuditLog(tx, {
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
  await prisma.$transaction(async (tx) => {
    const updated = await tx.pharmacy.update({
      where: { id },
      data: { ...rest, mapUrl: mapUrl || null },
    });
    await writeAuditLog(tx, {
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
  const user = await requirePermissionOrRedirect("manageSetupData", "/eczaneler");

  const pharmacy = await prisma.pharmacy.findUnique({ where: { id } });
  if (!pharmacy) {
    redirectWithMessage("/eczaneler", "error", "Eczane bulunamadı.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.pharmacy.update({
      where: { id },
      data: { isActive },
    });
    await writeAuditLog(tx, {
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
  const user = await requirePermissionOrRedirect("deleteSetupData", "/eczaneler");

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

  await prisma.$transaction(async (tx) => {
    await tx.pharmacy.delete({ where: { id } });
    await writeAuditLog(tx, {
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
