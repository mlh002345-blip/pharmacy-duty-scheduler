"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireOrganizationRole, requireOrganizationRoleOrRedirect } from "@/lib/auth/tenant";
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
  const guard = await requireOrganizationRole("manageSetupData");
  if (!guard.user) return guard.state;
  const { user } = guard;

  const parsed = parseUnavailabilityForm(formData);
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  // Cross-tenant relation validation: pharmacyId is client-supplied.
  const pharmacy = await prisma.pharmacy.findFirst({
    where: { id: parsed.data.pharmacyId, region: { organizationId: user.organizationId } },
    select: { id: true },
  });
  if (!pharmacy) {
    return {
      success: false,
      message: "Lütfen formdaki hataları düzeltin.",
      errors: { pharmacyId: ["Seçilen eczane bulunamadı."] },
    };
  }

  await prisma.$transaction(async (tx) => {
    const created = await tx.unavailability.create({
      data: {
        pharmacyId: parsed.data.pharmacyId,
        startDate: new Date(parsed.data.startDate),
        endDate: new Date(parsed.data.endDate),
        reason: parsed.data.reason || null,
      },
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "CREATE",
      entity: "Unavailability",
      entityId: created.id,
      after: created,
    });
  });

  revalidatePath("/mazeretler");
  redirectWithMessage("/mazeretler", "success", "Mazeret kaydı oluşturuldu.");
}

export async function updateUnavailabilityAction(
  id: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requireOrganizationRole("manageSetupData");
  if (!guard.user) return guard.state;
  const { user } = guard;

  const parsed = parseUnavailabilityForm(formData);
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const before = await prisma.unavailability.findFirst({
    where: { id, pharmacy: { region: { organizationId: user.organizationId } } },
  });
  if (!before) {
    return { success: false, message: "Mazeret kaydı bulunamadı." };
  }

  // Cross-tenant relation validation: pharmacyId is client-supplied.
  const pharmacy = await prisma.pharmacy.findFirst({
    where: { id: parsed.data.pharmacyId, region: { organizationId: user.organizationId } },
    select: { id: true },
  });
  if (!pharmacy) {
    return {
      success: false,
      message: "Lütfen formdaki hataları düzeltin.",
      errors: { pharmacyId: ["Seçilen eczane bulunamadı."] },
    };
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.unavailability.update({
      where: { id },
      data: {
        pharmacyId: parsed.data.pharmacyId,
        startDate: new Date(parsed.data.startDate),
        endDate: new Date(parsed.data.endDate),
        reason: parsed.data.reason || null,
      },
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "UPDATE",
      entity: "Unavailability",
      entityId: updated.id,
      before,
      after: updated,
    });
  });

  revalidatePath("/mazeretler");
  redirectWithMessage("/mazeretler", "success", "Mazeret kaydı güncellendi.");
}

export async function deleteUnavailabilityAction(id: string) {
  const user = await requireOrganizationRoleOrRedirect("manageSetupData", "/mazeretler");

  const unavailability = await prisma.unavailability.findFirst({
    where: { id, pharmacy: { region: { organizationId: user.organizationId } } },
  });
  if (!unavailability) {
    redirectWithMessage("/mazeretler", "error", "Mazeret kaydı bulunamadı.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.unavailability.delete({ where: { id } });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "DELETE",
      entity: "Unavailability",
      entityId: id,
      before: unavailability,
    });
  });

  revalidatePath("/mazeretler");
  redirectWithMessage("/mazeretler", "success", "Mazeret kaydı silindi.");
}
