"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { writeAuditLog } from "@/lib/audit";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { unavailabilitySchema } from "@/lib/validations/unavailability";
import { type ActionState, zodErrorState } from "@/lib/action-state";

function parseUnavailabilityForm(formData: FormData) {
  return unavailabilitySchema.safeParse({
    pharmacyId: formData.get("pharmacyId"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    reason: formData.get("reason"),
  });
}

export async function createUnavailabilityAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = parseUnavailabilityForm(formData);
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const unavailability = await prisma.unavailability.create({
    data: {
      pharmacyId: parsed.data.pharmacyId,
      startDate: new Date(parsed.data.startDate),
      endDate: new Date(parsed.data.endDate),
      reason: parsed.data.reason || null,
    },
  });

  const userId = await getCurrentUserId();
  await writeAuditLog({
    userId,
    action: "CREATE",
    entity: "Unavailability",
    entityId: unavailability.id,
    after: unavailability,
  });

  revalidatePath("/mazeretler");
  redirectWithMessage("/mazeretler", "success", "Mazeret kaydı oluşturuldu.");
}

export async function updateUnavailabilityAction(
  id: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = parseUnavailabilityForm(formData);
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const before = await prisma.unavailability.findUnique({ where: { id } });
  if (!before) {
    return { success: false, message: "Mazeret kaydı bulunamadı." };
  }

  const unavailability = await prisma.unavailability.update({
    where: { id },
    data: {
      pharmacyId: parsed.data.pharmacyId,
      startDate: new Date(parsed.data.startDate),
      endDate: new Date(parsed.data.endDate),
      reason: parsed.data.reason || null,
    },
  });

  const userId = await getCurrentUserId();
  await writeAuditLog({
    userId,
    action: "UPDATE",
    entity: "Unavailability",
    entityId: unavailability.id,
    before,
    after: unavailability,
  });

  revalidatePath("/mazeretler");
  redirectWithMessage("/mazeretler", "success", "Mazeret kaydı güncellendi.");
}

export async function deleteUnavailabilityAction(id: string) {
  const unavailability = await prisma.unavailability.findUnique({ where: { id } });
  if (!unavailability) {
    redirectWithMessage("/mazeretler", "error", "Mazeret kaydı bulunamadı.");
  }

  await prisma.unavailability.delete({ where: { id } });

  const userId = await getCurrentUserId();
  await writeAuditLog({
    userId,
    action: "DELETE",
    entity: "Unavailability",
    entityId: id,
    before: unavailability,
  });

  revalidatePath("/mazeretler");
  redirectWithMessage("/mazeretler", "success", "Mazeret kaydı silindi.");
}
