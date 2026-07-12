"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { requireOrganizationRole, requireOrganizationRoleOrRedirect } from "@/lib/auth/tenant";
import { writeAuditLog } from "@/lib/audit";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { holidaySchema } from "@/lib/validations/holiday";
import { type ActionState, zodErrorState } from "@/lib/action-state";

const DUPLICATE_HOLIDAY_STATE: ActionState = {
  success: false,
  message: "Bu tarih ve tür için tatil günü zaten kayıtlı.",
  errors: { date: ["Bu tarih ve tür için tatil günü zaten kayıtlı."] },
};

// Holiday tablosunun tek benzersizlik kısıtı (date, type) çiftidir, bu
// yüzden bu işlemlerin yazdığı transaction'larda oluşabilecek herhangi bir
// P2002 bu kısıttan kaynaklanır.
function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function parseHolidayForm(formData: FormData) {
  return holidaySchema.safeParse({
    date: formData.get("date"),
    name: formData.get("name"),
    type: formData.get("type"),
  });
}

export async function createHolidayAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requireOrganizationRole("manageSetupData");
  if (!guard.user) return guard.state;
  const { user } = guard;

  const parsed = parseHolidayForm(formData);
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.holiday.create({
        data: {
          name: parsed.data.name,
          date: new Date(parsed.data.date),
          type: parsed.data.type,
        },
      });
      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        action: "CREATE",
        entity: "Holiday",
        entityId: created.id,
        after: created,
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return DUPLICATE_HOLIDAY_STATE;
    }
    throw error;
  }

  revalidatePath("/tatil-gunleri");
  redirectWithMessage("/tatil-gunleri", "success", "Tatil günü oluşturuldu.");
}

export async function updateHolidayAction(
  id: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requireOrganizationRole("manageSetupData");
  if (!guard.user) return guard.state;
  const { user } = guard;

  const parsed = parseHolidayForm(formData);
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const before = await prisma.holiday.findUnique({ where: { id } });
  if (!before) {
    return { success: false, message: "Tatil günü bulunamadı." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.holiday.update({
        where: { id },
        data: {
          name: parsed.data.name,
          date: new Date(parsed.data.date),
          type: parsed.data.type,
        },
      });
      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        action: "UPDATE",
        entity: "Holiday",
        entityId: updated.id,
        before,
        after: updated,
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return DUPLICATE_HOLIDAY_STATE;
    }
    throw error;
  }

  revalidatePath("/tatil-gunleri");
  redirectWithMessage("/tatil-gunleri", "success", "Tatil günü güncellendi.");
}

export async function deleteHolidayAction(id: string) {
  const user = await requireOrganizationRoleOrRedirect("manageSetupData", "/tatil-gunleri");

  const holiday = await prisma.holiday.findUnique({ where: { id } });
  if (!holiday) {
    redirectWithMessage("/tatil-gunleri", "error", "Tatil günü bulunamadı.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.holiday.delete({ where: { id } });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: "DELETE",
      entity: "Holiday",
      entityId: id,
      before: holiday,
    });
  });

  revalidatePath("/tatil-gunleri");
  redirectWithMessage("/tatil-gunleri", "success", "Tatil günü silindi.");
}
