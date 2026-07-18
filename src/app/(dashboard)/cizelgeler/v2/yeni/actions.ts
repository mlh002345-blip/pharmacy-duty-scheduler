"use server";

import { redirect } from "next/navigation";

import { requireOrganizationRole } from "@/lib/auth/tenant";
import { type ActionState, zodErrorState } from "@/lib/action-state";
import { generateV2DraftSchema } from "@/lib/validations/duty-schedule-v2";
import { assembleV1CompatibilityEngineInput } from "@/lib/duty-rules-v2/ui/assemble-v1-compatibility-engine-input";
import { saveDraftPreview } from "@/lib/duty-rules-v2/ui/draft-preview-store";
import { ASSEMBLE_ENGINE_INPUT_ERROR_FIELD } from "@/lib/duty-rules-v2/ui/lifecycle-error-messages";
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

  const assembled = await assembleV1CompatibilityEngineInput({
    organizationId: user.organizationId,
    regionId,
    periodStart,
    periodEnd,
  });
  if (!assembled.ok) {
    const field = ASSEMBLE_ENGINE_INPUT_ERROR_FIELD[assembled.code];
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
