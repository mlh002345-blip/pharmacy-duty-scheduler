"use server";

import { requireOrganizationMember } from "@/lib/auth/tenant";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { migrateV1RegionToV2 } from "@/lib/duty-rules-v2/migration/migrate-v1-region-to-v2";

const ADMIN_ONLY_MESSAGE = "Bu işlem için yönetici yetkisi gereklidir.";

const MIGRATE_ERROR_MESSAGE: Record<string, string> = {
  REGION_NOT_FOUND: "Bölge bulunamadı.",
  NO_DUTY_RULE: "Bu bölge için tanımlı bir V1 nöbet kuralı bulunamadığından taşınacak bir yapılandırma yok.",
  ALREADY_HAS_PLAN: "Bu bölge için zaten bir V2 planı var.",
};

// Bundles plan/version creation AND activation into one click — the same
// "consequential" shape as activatePlanVersionAction (see
// versions/[versionId]/actions.ts), so it gets the same direct ADMIN-only
// gate rather than the broader managePlanConfiguration permission that
// plain configuration edits use.
export async function migrateV1RegionToV2Action(regionId: string): Promise<void> {
  const user = await requireOrganizationMember();
  if (user.role !== "ADMIN") {
    redirectWithMessage("/cizelgeler/v2/planlar/v1-tasi", "error", ADMIN_ONLY_MESSAGE);
  }

  const result = await migrateV1RegionToV2({
    organizationId: user.organizationId,
    regionId,
    userId: user.id,
  });

  if (!result.ok) {
    redirectWithMessage(
      "/cizelgeler/v2/planlar/v1-tasi",
      "error",
      MIGRATE_ERROR_MESSAGE[result.code] ?? "Taşıma sırasında bir hata oluştu."
    );
  }

  if (result.activated) {
    redirectWithMessage(
      `/cizelgeler/v2/planlar/${result.planId}/versions/${result.versionId}`,
      "success",
      `Bölge V2'ye taşındı ve etkinleştirildi (${result.memberCount} eczane). Artık V2 taslak oluşturabilirsiniz.`
    );
  }

  redirectWithMessage(
    `/cizelgeler/v2/planlar/${result.planId}/versions/${result.versionId}`,
    "success",
    "Bölge V2'ye taşındı ancak otomatik etkinleştirilemedi — aşağıdaki engelleyici sorunları çözüp elle etkinleştirin."
  );
}
