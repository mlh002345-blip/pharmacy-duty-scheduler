"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requirePermissionOrState } from "@/lib/auth/guard";
import { writeAuditLog } from "@/lib/audit";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { dutyRuleSchema } from "@/lib/validations/duty-rule";
import { type ActionState, zodErrorState } from "@/lib/action-state";

export async function upsertDutyRuleAction(
  regionId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requirePermissionOrState("manageSetupData");
  if (!guard.user) return guard.state;
  const { user } = guard;

  const parsed = dutyRuleSchema.safeParse({
    minDaysBetweenDuties: formData.get("minDaysBetweenDuties"),
    weekdayWeight: formData.get("weekdayWeight"),
    saturdayWeight: formData.get("saturdayWeight"),
    sundayWeight: formData.get("sundayWeight"),
    officialHolidayWeight: formData.get("officialHolidayWeight"),
    religiousHolidayWeight: formData.get("religiousHolidayWeight"),
  });

  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const region = await prisma.region.findUnique({
    where: { id: regionId },
    include: { dutyRule: true },
  });
  if (!region) {
    return { success: false, message: "Bölge bulunamadı." };
  }

  const before = region.dutyRule;
  const rule = await prisma.dutyRule.upsert({
    where: { regionId },
    create: { ...parsed.data, regionId },
    update: parsed.data,
  });

  await writeAuditLog({
    userId: user.id,
    action: before ? "UPDATE" : "CREATE",
    entity: "DutyRule",
    entityId: rule.id,
    before: before ?? undefined,
    after: rule,
  });

  revalidatePath("/kurallar");
  redirectWithMessage("/kurallar", "success", "Nöbet kuralı kaydedildi.");
}
