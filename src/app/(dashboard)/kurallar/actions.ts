"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireOrganizationRole } from "@/lib/auth/tenant";
import { writeAuditLog } from "@/lib/audit";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { dutyRuleSchema } from "@/lib/validations/duty-rule";
import { type ActionState, zodErrorState } from "@/lib/action-state";

export async function upsertDutyRuleAction(
  regionId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requireOrganizationRole("manageSetupData");
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

  const region = await prisma.region.findFirst({
    where: { id: regionId, organizationId: user.organizationId },
    include: { dutyRule: true },
  });
  if (!region) {
    return { success: false, message: "Bölge bulunamadı." };
  }

  const before = region.dutyRule;
  await prisma.$transaction(async (tx) => {
    const rule = await tx.dutyRule.upsert({
      where: { regionId },
      create: { ...parsed.data, regionId },
      update: parsed.data,
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      action: before ? "UPDATE" : "CREATE",
      entity: "DutyRule",
      entityId: rule.id,
      before: before ?? undefined,
      after: rule,
    });
  });

  revalidatePath("/kurallar");
  redirectWithMessage("/kurallar", "success", "Nöbet kuralı kaydedildi.");
}
