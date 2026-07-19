"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { requireOrganizationRole, requireOrganizationRoleOrRedirect } from "@/lib/auth/tenant";
import { writeAuditLog } from "@/lib/audit";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { type ActionState, zodErrorState } from "@/lib/action-state";

const serviceAreaNameSchema = z.object({
  name: z.string().trim().min(1, "Hizmet alanı adı gereklidir.").max(100),
});

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// Bir bölgenin içinde eczaneleri konuma göre etiketlemek için (bkz.
// prisma/schema.prisma'daki ServiceArea yorumu). Aynı yetki
// (manageRegions) — bölgeyi düzenleyebilen biri onun hizmet alanlarını da
// düzenleyebilir; ayrı bir izin türü icat edilmedi.
export async function createServiceAreaAction(
  regionId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requireOrganizationRole("manageRegions");
  if (!guard.user) return guard.state;
  const { user } = guard;

  const parsed = serviceAreaNameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  // Tenant-scoped: regionId is client-supplied via the bound server
  // action — only trusted once confirmed to belong to the caller's own
  // organization.
  const region = await prisma.region.findFirst({
    where: { id: regionId, organizationId: user.organizationId },
    select: { id: true },
  });
  if (!region) {
    return { success: false, message: "Bölge bulunamadı." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.serviceArea.create({
        data: { name: parsed.data.name, regionId },
      });
      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        action: "CREATE",
        entity: "ServiceArea",
        entityId: created.id,
        after: created,
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return {
        success: false,
        message: "Bu isimde bir hizmet alanı zaten mevcut.",
        errors: { name: ["Bu isimde bir hizmet alanı zaten mevcut."] },
      };
    }
    throw error;
  }

  revalidatePath(`/bolgeler/${regionId}/duzenle`);
  return { success: true, message: "Hizmet alanı oluşturuldu." };
}

export async function deleteServiceAreaAction(regionId: string, serviceAreaId: string) {
  const user = await requireOrganizationRoleOrRedirect(
    "manageRegions",
    `/bolgeler/${regionId}/duzenle`
  );

  const serviceArea = await prisma.serviceArea.findFirst({
    where: { id: serviceAreaId, regionId, region: { organizationId: user.organizationId } },
  });
  if (!serviceArea) {
    redirectWithMessage(`/bolgeler/${regionId}/duzenle`, "error", "Hizmet alanı bulunamadı.");
  }

  // Etiketlenmiş eczaneler silinmez, yalnızca etiketleri kalkar
  // (Pharmacy.serviceAreaId onDelete: SetNull) — bilinçli olarak
  // engellenmiyor, ServiceArea salt bir etiketleme katmanı.
  await prisma.$transaction(async (tx) => {
    await tx.serviceArea.delete({ where: { id: serviceAreaId } });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "DELETE",
      entity: "ServiceArea",
      entityId: serviceAreaId,
      before: serviceArea,
    });
  });

  revalidatePath(`/bolgeler/${regionId}/duzenle`);
  redirectWithMessage(`/bolgeler/${regionId}/duzenle`, "success", "Hizmet alanı silindi.");
}
