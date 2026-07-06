"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { writeAuditLog } from "@/lib/audit";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { holidaySchema } from "@/lib/validations/holiday";
import { type ActionState, zodErrorState } from "@/lib/action-state";

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
  const parsed = parseHolidayForm(formData);
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const holiday = await prisma.holiday.create({
    data: {
      name: parsed.data.name,
      date: new Date(parsed.data.date),
      type: parsed.data.type,
    },
  });

  const userId = await getCurrentUserId();
  await writeAuditLog({
    userId,
    action: "CREATE",
    entity: "Holiday",
    entityId: holiday.id,
    after: holiday,
  });

  revalidatePath("/tatil-gunleri");
  redirectWithMessage("/tatil-gunleri", "success", "Tatil günü oluşturuldu.");
}

export async function updateHolidayAction(
  id: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = parseHolidayForm(formData);
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const before = await prisma.holiday.findUnique({ where: { id } });
  if (!before) {
    return { success: false, message: "Tatil günü bulunamadı." };
  }

  const holiday = await prisma.holiday.update({
    where: { id },
    data: {
      name: parsed.data.name,
      date: new Date(parsed.data.date),
      type: parsed.data.type,
    },
  });

  const userId = await getCurrentUserId();
  await writeAuditLog({
    userId,
    action: "UPDATE",
    entity: "Holiday",
    entityId: holiday.id,
    before,
    after: holiday,
  });

  revalidatePath("/tatil-gunleri");
  redirectWithMessage("/tatil-gunleri", "success", "Tatil günü güncellendi.");
}

export async function deleteHolidayAction(id: string) {
  const holiday = await prisma.holiday.findUnique({ where: { id } });
  if (!holiday) {
    redirectWithMessage("/tatil-gunleri", "error", "Tatil günü bulunamadı.");
  }

  await prisma.holiday.delete({ where: { id } });

  const userId = await getCurrentUserId();
  await writeAuditLog({
    userId,
    action: "DELETE",
    entity: "Holiday",
    entityId: id,
    before: holiday,
  });

  revalidatePath("/tatil-gunleri");
  redirectWithMessage("/tatil-gunleri", "success", "Tatil günü silindi.");
}
