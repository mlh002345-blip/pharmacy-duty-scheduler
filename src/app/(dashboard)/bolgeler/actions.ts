"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { writeAuditLog } from "@/lib/audit";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { regionSchema } from "@/lib/validations/region";
import { type ActionState, zodErrorState } from "@/lib/action-state";

function parseRegionForm(formData: FormData) {
  return regionSchema.safeParse({
    name: formData.get("name"),
    district: formData.get("district"),
    dailyDutyCount: formData.get("dailyDutyCount"),
    isActive: formData.get("isActive") === "on",
  });
}

export async function createRegionAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = parseRegionForm(formData);
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const existing = await prisma.region.findUnique({
    where: { name: parsed.data.name },
  });
  if (existing) {
    return {
      success: false,
      message: "Bu isimde bir bölge zaten mevcut.",
      errors: { name: ["Bu isimde bir bölge zaten mevcut."] },
    };
  }

  const region = await prisma.region.create({ data: parsed.data });

  const userId = await getCurrentUserId();
  await writeAuditLog({
    userId,
    action: "CREATE",
    entity: "Region",
    entityId: region.id,
    after: region,
  });

  revalidatePath("/bolgeler");
  redirectWithMessage("/bolgeler", "success", "Bölge oluşturuldu.");
}

export async function updateRegionAction(
  id: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = parseRegionForm(formData);
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const before = await prisma.region.findUnique({ where: { id } });
  if (!before) {
    return { success: false, message: "Bölge bulunamadı." };
  }

  const duplicate = await prisma.region.findFirst({
    where: { name: parsed.data.name, NOT: { id } },
  });
  if (duplicate) {
    return {
      success: false,
      message: "Bu isimde bir bölge zaten mevcut.",
      errors: { name: ["Bu isimde bir bölge zaten mevcut."] },
    };
  }

  const region = await prisma.region.update({
    where: { id },
    data: parsed.data,
  });

  const userId = await getCurrentUserId();
  await writeAuditLog({
    userId,
    action: "UPDATE",
    entity: "Region",
    entityId: region.id,
    before,
    after: region,
  });

  revalidatePath("/bolgeler");
  redirectWithMessage("/bolgeler", "success", "Bölge güncellendi.");
}

export async function toggleRegionStatusAction(id: string) {
  const region = await prisma.region.findUnique({ where: { id } });
  if (!region) {
    redirectWithMessage("/bolgeler", "error", "Bölge bulunamadı.");
  }

  const updated = await prisma.region.update({
    where: { id },
    data: { isActive: !region.isActive },
  });

  const userId = await getCurrentUserId();
  await writeAuditLog({
    userId,
    action: "UPDATE",
    entity: "Region",
    entityId: id,
    before: region,
    after: updated,
  });

  revalidatePath("/bolgeler");
  redirectWithMessage(
    "/bolgeler",
    "success",
    updated.isActive ? "Bölge aktif yapıldı." : "Bölge pasif yapıldı."
  );
}

export async function deleteRegionAction(id: string) {
  const pharmacyCount = await prisma.pharmacy.count({ where: { regionId: id } });
  if (pharmacyCount > 0) {
    redirectWithMessage(
      "/bolgeler",
      "error",
      "Bu bölgeye kayıtlı eczaneler olduğu için silinemez."
    );
  }

  const region = await prisma.region.findUnique({ where: { id } });
  if (!region) {
    redirectWithMessage("/bolgeler", "error", "Bölge bulunamadı.");
  }

  await prisma.region.delete({ where: { id } });

  const userId = await getCurrentUserId();
  await writeAuditLog({
    userId,
    action: "DELETE",
    entity: "Region",
    entityId: id,
    before: region,
  });

  revalidatePath("/bolgeler");
  redirectWithMessage("/bolgeler", "success", "Bölge silindi.");
}
