"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { requirePermissionOrRedirect, requirePermissionOrState } from "@/lib/auth/guard";
import { writeAuditLog } from "@/lib/audit";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { regionSchema } from "@/lib/validations/region";
import { type ActionState, zodErrorState } from "@/lib/action-state";

const DUPLICATE_REGION_NAME_STATE: ActionState = {
  success: false,
  message: "Bu isimde bir bölge zaten mevcut.",
  errors: { name: ["Bu isimde bir bölge zaten mevcut."] },
};

// Region tablosunda değiştirilebilir tek benzersiz alan name olduğundan, bu
// işlemlerin yazdığı transaction'larda oluşabilecek herhangi bir P2002 bu
// alandan kaynaklanır.
function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

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
  const guard = await requirePermissionOrState("manageSetupData");
  if (!guard.user) return guard.state;
  const { user } = guard;

  const parsed = parseRegionForm(formData);
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const existing = await prisma.region.findUnique({
    where: { name: parsed.data.name },
  });
  if (existing) {
    return DUPLICATE_REGION_NAME_STATE;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.region.create({ data: parsed.data });
      await writeAuditLog(tx, {
        userId: user.id,
        action: "CREATE",
        entity: "Region",
        entityId: created.id,
        after: created,
      });
    });
  } catch (error) {
    // İki eşzamanlı istek aynı isimle bölge oluşturmaya çalışırsa,
    // yukarıdaki `existing` kontrolünü ikisi de geçebilir; ikinci yazma
    // DB'nin benzersizlik kısıtına çarpar.
    if (isUniqueConstraintError(error)) {
      return DUPLICATE_REGION_NAME_STATE;
    }
    throw error;
  }

  revalidatePath("/bolgeler");
  redirectWithMessage("/bolgeler", "success", "Bölge oluşturuldu.");
}

export async function updateRegionAction(
  id: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requirePermissionOrState("manageSetupData");
  if (!guard.user) return guard.state;
  const { user } = guard;

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
    return DUPLICATE_REGION_NAME_STATE;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.region.update({
        where: { id },
        data: parsed.data,
      });
      await writeAuditLog(tx, {
        userId: user.id,
        action: "UPDATE",
        entity: "Region",
        entityId: updated.id,
        before,
        after: updated,
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return DUPLICATE_REGION_NAME_STATE;
    }
    throw error;
  }

  revalidatePath("/bolgeler");
  redirectWithMessage("/bolgeler", "success", "Bölge güncellendi.");
}

// İstenen hedef durum çağrıdan doğrudan alınır (bkz. eczaneler/actions.ts
// setPharmacyStatusAction yorumu) — çift gönderimde amaçlanan değişikliği
// sessizce iptal eden bir "toggle" değildir.
export async function setRegionStatusAction(id: string, isActive: boolean) {
  const user = await requirePermissionOrRedirect("manageSetupData", "/bolgeler");

  const region = await prisma.region.findUnique({ where: { id } });
  if (!region) {
    redirectWithMessage("/bolgeler", "error", "Bölge bulunamadı.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.region.update({
      where: { id },
      data: { isActive },
    });
    await writeAuditLog(tx, {
      userId: user.id,
      action: "UPDATE",
      entity: "Region",
      entityId: id,
      before: region,
      after: next,
    });
    return next;
  });

  revalidatePath("/bolgeler");
  redirectWithMessage(
    "/bolgeler",
    "success",
    updated.isActive ? "Bölge aktif yapıldı." : "Bölge pasif yapıldı."
  );
}

export async function deleteRegionAction(id: string) {
  const user = await requirePermissionOrRedirect("deleteSetupData", "/bolgeler");

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

  await prisma.$transaction(async (tx) => {
    await tx.region.delete({ where: { id } });
    await writeAuditLog(tx, {
      userId: user.id,
      action: "DELETE",
      entity: "Region",
      entityId: id,
      before: region,
    });
  });

  revalidatePath("/bolgeler");
  redirectWithMessage("/bolgeler", "success", "Bölge silindi.");
}
