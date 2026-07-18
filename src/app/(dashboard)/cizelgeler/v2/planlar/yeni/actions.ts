"use server";

import { redirect } from "next/navigation";

import { requireOrganizationRole } from "@/lib/auth/tenant";
import { type ActionState, zodErrorState } from "@/lib/action-state";
import { z } from "zod";
import { createDutyPlan } from "@/lib/duty-rules-v2/configuration/create-duty-plan";

const GENERIC_ERROR_MESSAGE = "Lütfen formdaki hataları düzeltin.";

const createPlanSchema = z.object({
  regionId: z.string().min(1, "Bölge seçiniz."),
  name: z.string().min(1, "Plan adı gereklidir.").max(200),
});

const CREATE_DUTY_PLAN_ERROR_FIELD: Record<string, string> = {
  REGION_NOT_FOUND: "regionId",
  INVALID_INPUT: "name",
};

export async function createDutyPlanAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requireOrganizationRole("managePlanConfiguration");
  if (!guard.user) return guard.state;
  const { user } = guard;

  const parsed = createPlanSchema.safeParse({
    regionId: formData.get("regionId"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return zodErrorState(parsed.error, GENERIC_ERROR_MESSAGE);
  }

  const result = await createDutyPlan({
    organizationId: user.organizationId,
    regionId: parsed.data.regionId,
    name: parsed.data.name,
    userId: user.id,
  });
  if (!result.ok) {
    const field = CREATE_DUTY_PLAN_ERROR_FIELD[result.code] ?? "name";
    return { success: false, message: GENERIC_ERROR_MESSAGE, errors: { [field]: [result.message] } };
  }

  redirect(`/cizelgeler/v2/planlar/${result.planId}/versions/${result.versionId}`);
}
