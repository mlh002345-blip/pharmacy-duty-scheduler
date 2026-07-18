"use server";

import { revalidatePath } from "next/cache";

import { requireOrganizationRoleOrRedirect } from "@/lib/auth/tenant";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { loadDraftPreview, markDraftPreviewConsumed } from "@/lib/duty-rules-v2/ui/draft-preview-store";
import { commitCompleteDraft } from "@/lib/duty-rules-v2/persistence/commit-complete-draft";
import { COMMIT_DRAFT_ERROR_MESSAGES } from "@/lib/duty-rules-v2/ui/lifecycle-error-messages";

const PREVIEW_LOAD_ERROR_MESSAGES: Record<"NOT_FOUND" | "EXPIRED" | "ALREADY_CONSUMED", string> = {
  NOT_FOUND: "Taslak önizlemesi bulunamadı.",
  EXPIRED: "Taslak önizlemesinin süresi doldu. Lütfen yeniden oluşturun.",
  ALREADY_CONSUMED: "Bu taslak önizlemesi zaten kaydedilmiş.",
};

export async function commitV2DraftAction(previewId: string) {
  const user = await requireOrganizationRoleOrRedirect(
    "generateSchedule",
    `/cizelgeler/v2/onizleme/${previewId}`
  );

  const loaded = await loadDraftPreview({ previewId, organizationId: user.organizationId });
  if (!loaded.ok) {
    redirectWithMessage(
      "/cizelgeler/v2/yeni",
      "error",
      PREVIEW_LOAD_ERROR_MESSAGES[loaded.code]
    );
  }

  const result = await commitCompleteDraft({
    draft: loaded.draft,
    organizationId: user.organizationId,
    regionId: loaded.row.regionId,
    userId: user.id,
  });
  if (!result.ok) {
    redirectWithMessage(
      `/cizelgeler/v2/onizleme/${previewId}`,
      "error",
      COMMIT_DRAFT_ERROR_MESSAGES[result.code]
    );
  }

  await markDraftPreviewConsumed(previewId);
  revalidatePath("/cizelgeler");

  redirectWithMessage(
    `/cizelgeler/${result.dutyScheduleId}`,
    "success",
    result.outcome === "CREATED" ? "V2 taslağı kaydedildi." : "Bu taslak zaten kaydedilmişti."
  );
}
