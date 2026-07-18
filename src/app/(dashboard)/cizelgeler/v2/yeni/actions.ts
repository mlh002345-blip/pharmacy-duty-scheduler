"use server";

import { redirect } from "next/navigation";

import { requireOrganizationRole } from "@/lib/auth/tenant";
import { type ActionState, zodErrorState } from "@/lib/action-state";
import { generateV2DraftSchema } from "@/lib/validations/duty-schedule-v2";
import { prisma } from "@/lib/prisma";
import { assembleV1CompatibilityEngineInput } from "@/lib/duty-rules-v2/ui/assemble-v1-compatibility-engine-input";
import { assembleV2NativeEngineInput } from "@/lib/duty-rules-v2/ui/assemble-v2-native-engine-input";
import { saveDraftPreview } from "@/lib/duty-rules-v2/ui/draft-preview-store";
import {
  ASSEMBLE_ENGINE_INPUT_ERROR_FIELD,
  ASSEMBLE_NATIVE_ENGINE_INPUT_ERROR_FIELD,
} from "@/lib/duty-rules-v2/ui/lifecycle-error-messages";
import { buildDutyEngineContext } from "@/lib/duty-rules-v2/engine/build-engine-context";
import { DutyEngineError } from "@/lib/duty-rules-v2/engine/domain/engine-input";
import { RuleEngineError } from "@/lib/duty-rules-v2/rules/rule-errors";
import { SelectionEngineError } from "@/lib/duty-rules-v2/selection/strategy-errors";
import { logger } from "@/lib/observability/logger";
import { getRequestId } from "@/lib/observability/request-id";

const GENERIC_ERROR_MESSAGE = "Lütfen formdaki hataları düzeltin.";

export async function generateV2DraftPreviewAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requireOrganizationRole("generateSchedule");
  if (!guard.user) return guard.state;
  const { user } = guard;

  const parsed = generateV2DraftSchema.safeParse({
    regionId: formData.get("regionId"),
    periodStart: formData.get("periodStart"),
    periodEnd: formData.get("periodEnd"),
  });
  if (!parsed.success) {
    return zodErrorState(parsed.error, GENERIC_ERROR_MESSAGE);
  }
  const { regionId, periodStart, periodEnd } = parsed.data;

  // Duty Rules V2 — Phase 12 mode selection: a small, cheap read of the
  // region's ACTIVE plan version's own minDaysBetweenDuties column
  // decides which assembler to use. Non-null -> native mode (the
  // version has its own policy). Null -> V1-compatibility mode, exactly
  // as before this phase. Every plan version created before Phase 12 has
  // minDaysBetweenDuties: null by construction (the column didn't
  // exist), so this branch is a no-op backward-compatibility guarantee:
  // such versions always take the V1-compatibility path, byte-identical
  // to pre-Phase-12 behavior.
  const activeVersion = await prisma.dutyPlanVersion.findFirst({
    where: { plan: { organizationId: user.organizationId, regionId }, status: "ACTIVE" },
    orderBy: { versionNumber: "desc" },
    select: { minDaysBetweenDuties: true },
  });
  const useNativeMode = activeVersion?.minDaysBetweenDuties !== null &&
    activeVersion?.minDaysBetweenDuties !== undefined;

  const assembled = useNativeMode
    ? await assembleV2NativeEngineInput({
        organizationId: user.organizationId,
        regionId,
        periodStart,
        periodEnd,
      })
    : await assembleV1CompatibilityEngineInput({
        organizationId: user.organizationId,
        regionId,
        periodStart,
        periodEnd,
      });
  if (!assembled.ok) {
    const field = useNativeMode
      ? ASSEMBLE_NATIVE_ENGINE_INPUT_ERROR_FIELD[
          assembled.code as keyof typeof ASSEMBLE_NATIVE_ENGINE_INPUT_ERROR_FIELD
        ]
      : ASSEMBLE_ENGINE_INPUT_ERROR_FIELD[
          assembled.code as keyof typeof ASSEMBLE_ENGINE_INPUT_ERROR_FIELD
        ];
    return {
      success: false,
      message: GENERIC_ERROR_MESSAGE,
      errors: { [field]: [assembled.message] },
    };
  }

  let previewId: string;
  try {
    const engineResult = buildDutyEngineContext(assembled.input);
    const saved = await saveDraftPreview({
      organizationId: user.organizationId,
      regionId,
      planVersionId: assembled.planVersionId,
      createdById: user.id,
      draft: engineResult.completeDraftSchedule,
    });
    previewId = saved.previewId;
  } catch (error) {
    if (
      error instanceof DutyEngineError ||
      error instanceof RuleEngineError ||
      error instanceof SelectionEngineError
    ) {
      logger.warn("v2_draft_generation_failed", {
        requestId: await getRequestId(),
        userId: user.id,
        regionId,
        reason: error.name,
      });
      return {
        success: false,
        message: GENERIC_ERROR_MESSAGE,
        errors: { regionId: [error.message] },
      };
    }
    logger.error(
      "v2_draft_generation_failed",
      {
        requestId: await getRequestId(),
        userId: user.id,
        regionId,
        reason: "unexpected_error",
      },
      error
    );
    throw error;
  }

  redirect(`/cizelgeler/v2/onizleme/${previewId}`);
}
