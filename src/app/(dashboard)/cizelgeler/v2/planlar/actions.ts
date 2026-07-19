"use server";

import { revalidatePath } from "next/cache";

import { requireOrganizationRoleOrRedirect } from "@/lib/auth/tenant";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { deletePlanVersion } from "@/lib/duty-rules-v2/configuration/delete-plan-version";

const PLANLAR_PATH = "/cizelgeler/v2/planlar";

const DELETE_ERROR_MESSAGE: Record<string, string> = {
  VERSION_NOT_FOUND: "Plan sürümü bulunamadı.",
  VERSION_NOT_DRAFT: "Yalnızca taslak durumundaki bir sürüm silinebilir.",
};

// Same permission as every other create/edit service in
// src/lib/duty-rules-v2/configuration/ (managePlanConfiguration, granted
// to ADMIN and STAFF) — deleting a DRAFT you can already freely edit
// carries no more consequence than the edit itself, unlike activation
// (which is ADMIN-only because it retires other versions and unlocks
// real generation).
export async function deletePlanVersionAction(versionId: string): Promise<void> {
  const user = await requireOrganizationRoleOrRedirect("managePlanConfiguration", PLANLAR_PATH);

  const result = await deletePlanVersion({
    organizationId: user.organizationId,
    versionId,
    userId: user.id,
  });
  if (!result.ok) {
    redirectWithMessage(PLANLAR_PATH, "error", DELETE_ERROR_MESSAGE[result.code] ?? "Silme işlemi başarısız oldu.");
  }

  revalidatePath(PLANLAR_PATH);
  redirectWithMessage(
    PLANLAR_PATH,
    "success",
    result.planDeleted ? "Plan sürümü ve boş kalan plan silindi." : "Plan sürümü silindi."
  );
}
