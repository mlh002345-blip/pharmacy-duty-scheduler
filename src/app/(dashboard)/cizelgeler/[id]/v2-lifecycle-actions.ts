"use server";

import { revalidatePath } from "next/cache";

import { requireOrganizationMember } from "@/lib/auth/tenant";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { approveGeneratedDraft } from "@/lib/duty-rules-v2/persistence/approve-generated-draft";
import { publishApprovedSchedule } from "@/lib/duty-rules-v2/persistence/publish-approved-schedule";
import {
  APPROVE_DRAFT_ERROR_MESSAGES,
  PUBLISH_SCHEDULE_ERROR_MESSAGES,
} from "@/lib/duty-rules-v2/ui/lifecycle-error-messages";

const ADMIN_ONLY_MESSAGE = "Bu işlem için yönetici yetkisi gereklidir.";

// Duty Rules V2 Phase 9 lifecycle actions. Deliberately gated on
// `user.role === "ADMIN"` directly (not hasPermission("publishSchedule"),
// which STAFF also holds for the V1 flow) — V2 approve/publish is
// ADMIN-only regardless of STAFF's V1 publish grant.
export async function approveV2DraftAction(scheduleId: string) {
  const user = await requireOrganizationMember();
  if (user.role !== "ADMIN") {
    redirectWithMessage(`/cizelgeler/${scheduleId}`, "error", ADMIN_ONLY_MESSAGE);
  }

  const result = await approveGeneratedDraft({
    dutyScheduleId: scheduleId,
    organizationId: user.organizationId,
    userId: user.id,
  });
  if (!result.ok) {
    redirectWithMessage(
      `/cizelgeler/${scheduleId}`,
      "error",
      APPROVE_DRAFT_ERROR_MESSAGES[result.code]
    );
  }

  revalidatePath(`/cizelgeler/${scheduleId}`);
  redirectWithMessage(
    `/cizelgeler/${scheduleId}`,
    "success",
    result.outcome === "APPROVED" ? "Taslak onaylandı." : "Bu taslak zaten onaylanmıştı."
  );
}

export async function publishV2ScheduleAction(scheduleId: string) {
  const user = await requireOrganizationMember();
  if (user.role !== "ADMIN") {
    redirectWithMessage(`/cizelgeler/${scheduleId}`, "error", ADMIN_ONLY_MESSAGE);
  }

  const result = await publishApprovedSchedule({
    dutyScheduleId: scheduleId,
    organizationId: user.organizationId,
    userId: user.id,
  });
  if (!result.ok) {
    redirectWithMessage(
      `/cizelgeler/${scheduleId}`,
      "error",
      PUBLISH_SCHEDULE_ERROR_MESSAGES[result.code]
    );
  }

  revalidatePath(`/cizelgeler/${scheduleId}`);
  revalidatePath("/cizelgeler");
  revalidatePath("/vatandas");
  redirectWithMessage(
    `/cizelgeler/${scheduleId}`,
    "success",
    result.outcome === "PUBLISHED" ? "Çizelge yayınlandı." : "Bu çizelge zaten yayınlanmıştı."
  );
}
