"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  requireOrganizationMember,
  requireOrganizationRole,
  requireOrganizationRoleOrRedirect,
} from "@/lib/auth/tenant";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { type ActionState } from "@/lib/action-state";
import { BUILTIN_DAY_TYPES } from "@/lib/duty-rules-v2/domain/loaded-plan";
import { setDayTypeRules } from "@/lib/duty-rules-v2/configuration/update-day-type-rules";
import { setPlanVersionPolicy } from "@/lib/duty-rules-v2/configuration/update-plan-version-policy";
import { setShiftDefinitions } from "@/lib/duty-rules-v2/configuration/update-shift-definitions";
import { setSlotRequirements } from "@/lib/duty-rules-v2/configuration/update-slot-requirements";
import { createRotationPool } from "@/lib/duty-rules-v2/configuration/create-rotation-pool";
import {
  addPoolMembership,
  endPoolMembership,
} from "@/lib/duty-rules-v2/configuration/update-pool-membership";
import { activatePlanVersion } from "@/lib/duty-rules-v2/configuration/activate-plan-version";

const GENERIC_ERROR_MESSAGE = "Lütfen formdaki hataları düzeltin.";
const ADMIN_ONLY_MESSAGE = "Bu işlem için yönetici yetkisi gereklidir.";

function versionPath(planId: string, versionId: string) {
  return `/cizelgeler/v2/planlar/${planId}/versions/${versionId}`;
}

// One plan version realistically holds, at most, a few dozen day types /
// shifts / slot requirements — 100 KB is already generous headroom (a
// deliberately configured version with hundreds of rows still fits
// comfortably under this). Rejecting an oversized raw string BEFORE
// calling JSON.parse bounds the parse-time cost itself; the zod schemas
// below additionally cap array length, so a payload that IS under 100 KB
// but crams in many tiny/deeply-nested elements is still rejected before
// any DB call.
const MAX_CONFIGURATION_JSON_FIELD_LENGTH = 100_000;
const PARSE_FAILED = Symbol("PARSE_FAILED");

function parseConfigurationJsonField(raw: FormDataEntryValue | null): unknown | typeof PARSE_FAILED {
  if (typeof raw !== "string" || raw.length > MAX_CONFIGURATION_JSON_FIELD_LENGTH) {
    return PARSE_FAILED;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return PARSE_FAILED;
  }
}

// ---------------------------------------------------------------------------
// Gün Tipleri
// ---------------------------------------------------------------------------

const dayTypeRulesSchema = z
  .array(
    z.object({
      dayType: z.enum(BUILTIN_DAY_TYPES),
      isServed: z.boolean(),
      weight: z.number().finite().positive().nullable(),
    })
  )
  // BUILTIN_DAY_TYPES itself is a short, fixed list — this cap is
  // deliberately generous headroom, not a tight fit to its current size.
  .max(100);

export async function updateDayTypeRulesAction(
  planId: string,
  versionId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requireOrganizationRole("managePlanConfiguration");
  if (!guard.user) return guard.state;
  const { user } = guard;

  const parsedJson = parseConfigurationJsonField(formData.get("rulesJson"));
  if (parsedJson === PARSE_FAILED) {
    return { success: false, message: GENERIC_ERROR_MESSAGE };
  }
  const parsed = dayTypeRulesSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { success: false, message: GENERIC_ERROR_MESSAGE };
  }

  const result = await setDayTypeRules({
    organizationId: user.organizationId,
    versionId,
    rules: parsed.data,
    userId: user.id,
  });
  if (!result.ok) {
    return { success: false, message: result.message };
  }

  revalidatePath(versionPath(planId, versionId));
  return { success: true, message: "Gün tipleri güncellendi." };
}

// ---------------------------------------------------------------------------
// Politika (Duty Rules V2 — Phase 12)
// ---------------------------------------------------------------------------

const planVersionPolicySchema = z.object({
  // Empty string from the number input's "unconfigured" state maps to
  // null — an explicit, honest empty state, never coerced to 0 (0 is a
  // legitimate "no interval restriction" value, semantically distinct
  // from "not configured").
  minDaysBetweenDuties: z
    .union([z.literal(""), z.coerce.number().int().min(0)])
    .transform((v) => (v === "" ? null : v)),
  relaxMinIntervalWhenInsufficient: z.boolean(),
  sameDaySecondAssignmentAllowed: z.boolean(),
  holidayEveWeightSource: z.enum(["CONFIGURED", "UNDERLYING_WEEKDAY"]),
  holidayOverlapResolutionMode: z.enum(["NATIVE_PRECEDENCE", "V1_LAST_INPUT_WINS"]),
});

export async function updatePlanVersionPolicyAction(
  planId: string,
  versionId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requireOrganizationRole("managePlanConfiguration");
  if (!guard.user) return guard.state;
  const { user } = guard;

  const rawMinDays = formData.get("minDaysBetweenDuties");
  const parsed = planVersionPolicySchema.safeParse({
    minDaysBetweenDuties: typeof rawMinDays === "string" ? rawMinDays : "",
    relaxMinIntervalWhenInsufficient: formData.get("relaxMinIntervalWhenInsufficient") === "on",
    sameDaySecondAssignmentAllowed: formData.get("sameDaySecondAssignmentAllowed") === "on",
    holidayEveWeightSource: formData.get("holidayEveWeightSource"),
    holidayOverlapResolutionMode: formData.get("holidayOverlapResolutionMode"),
  });
  if (!parsed.success) {
    return { success: false, message: GENERIC_ERROR_MESSAGE };
  }

  const result = await setPlanVersionPolicy({
    organizationId: user.organizationId,
    versionId,
    minDaysBetweenDuties: parsed.data.minDaysBetweenDuties,
    relaxMinIntervalWhenInsufficient: parsed.data.relaxMinIntervalWhenInsufficient,
    sameDaySecondAssignmentAllowed: parsed.data.sameDaySecondAssignmentAllowed,
    holidayEveWeightSource: parsed.data.holidayEveWeightSource,
    holidayOverlapResolutionMode: parsed.data.holidayOverlapResolutionMode,
    userId: user.id,
  });
  if (!result.ok) {
    return { success: false, message: result.message };
  }

  revalidatePath(versionPath(planId, versionId));
  return { success: true, message: "Nöbet politikası güncellendi." };
}

// ---------------------------------------------------------------------------
// Vardiyalar
// ---------------------------------------------------------------------------

const shiftDefinitionsSchema = z
  .array(
    z.object({
      id: z.string().optional(),
      name: z.string().min(1),
      startMinute: z.number().int().min(0).max(1439),
      endMinute: z.number().int().min(0).max(1439),
      spansMidnight: z.boolean(),
      defaultWeight: z.number().positive(),
      sortOrder: z.number().int(),
    })
  )
  .max(200);

export async function updateShiftDefinitionsAction(
  planId: string,
  versionId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requireOrganizationRole("managePlanConfiguration");
  if (!guard.user) return guard.state;
  const { user } = guard;

  const parsedJson = parseConfigurationJsonField(formData.get("shiftsJson"));
  if (parsedJson === PARSE_FAILED) {
    return { success: false, message: GENERIC_ERROR_MESSAGE };
  }
  const parsed = shiftDefinitionsSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { success: false, message: GENERIC_ERROR_MESSAGE };
  }

  const result = await setShiftDefinitions({
    organizationId: user.organizationId,
    versionId,
    shifts: parsed.data,
    userId: user.id,
  });
  if (!result.ok) {
    return { success: false, message: result.message };
  }

  revalidatePath(versionPath(planId, versionId));
  return { success: true, message: "Vardiyalar güncellendi." };
}

// ---------------------------------------------------------------------------
// Slot Gereksinimleri
// ---------------------------------------------------------------------------

const slotRequirementsSchema = z
  .array(
    z.object({
      id: z.string().optional(),
      name: z.string().nullable().optional(),
      dayTypeRuleId: z.string().min(1),
      shiftDefinitionId: z.string().min(1),
      rotationPoolId: z.string().nullable(),
      requiredCount: z.number().int().min(1),
      sortOrder: z.number().int(),
    })
  )
  .max(1000);

export async function updateSlotRequirementsAction(
  planId: string,
  versionId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requireOrganizationRole("managePlanConfiguration");
  if (!guard.user) return guard.state;
  const { user } = guard;

  const parsedJson = parseConfigurationJsonField(formData.get("slotsJson"));
  if (parsedJson === PARSE_FAILED) {
    return { success: false, message: GENERIC_ERROR_MESSAGE };
  }
  const parsed = slotRequirementsSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { success: false, message: GENERIC_ERROR_MESSAGE };
  }

  const result = await setSlotRequirements({
    organizationId: user.organizationId,
    versionId,
    slots: parsed.data.map((s) => ({ ...s, name: s.name ?? null })),
    userId: user.id,
  });
  if (!result.ok) {
    return { success: false, message: result.message };
  }

  revalidatePath(versionPath(planId, versionId));
  return { success: true, message: "Slot gereksinimleri güncellendi." };
}

// ---------------------------------------------------------------------------
// Rotasyon Havuzları
// ---------------------------------------------------------------------------

const createPoolSchema = z.object({
  name: z.string().min(1),
  strategy: z.enum(["SEQUENTIAL", "FAIRNESS_SCORE", "WEIGHTED", "MANUAL_ORDER"]),
});

export async function createRotationPoolAction(
  planId: string,
  versionId: string,
  regionId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requireOrganizationRole("managePlanConfiguration");
  if (!guard.user) return guard.state;
  const { user } = guard;

  const parsed = createPoolSchema.safeParse({
    name: formData.get("name"),
    strategy: formData.get("strategy"),
  });
  if (!parsed.success) {
    return { success: false, message: GENERIC_ERROR_MESSAGE };
  }

  const result = await createRotationPool({
    organizationId: user.organizationId,
    regionId,
    name: parsed.data.name,
    strategy: parsed.data.strategy,
    userId: user.id,
  });
  if (!result.ok) {
    return { success: false, message: result.message };
  }

  revalidatePath(versionPath(planId, versionId));
  return { success: true, message: "Rotasyon havuzu oluşturuldu." };
}

const addMembershipSchema = z.object({
  poolId: z.string().min(1),
  pharmacyId: z.string().min(1),
  joinedAt: z.string().min(1),
});

export async function addPoolMembershipAction(
  planId: string,
  versionId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requireOrganizationRole("managePlanConfiguration");
  if (!guard.user) return guard.state;
  const { user } = guard;

  const parsed = addMembershipSchema.safeParse({
    poolId: formData.get("poolId"),
    pharmacyId: formData.get("pharmacyId"),
    joinedAt: formData.get("joinedAt"),
  });
  if (!parsed.success) {
    return { success: false, message: GENERIC_ERROR_MESSAGE };
  }

  const result = await addPoolMembership({
    organizationId: user.organizationId,
    poolId: parsed.data.poolId,
    pharmacyId: parsed.data.pharmacyId,
    joinedAt: parsed.data.joinedAt,
    userId: user.id,
  });
  if (!result.ok) {
    return { success: false, message: result.message };
  }

  revalidatePath(versionPath(planId, versionId));
  return { success: true, message: "Eczane havuza eklendi." };
}

export async function endPoolMembershipAction(planId: string, versionId: string, membershipId: string) {
  const user = await requireOrganizationRoleOrRedirect(
    "managePlanConfiguration",
    versionPath(planId, versionId)
  );

  const result = await endPoolMembership({
    organizationId: user.organizationId,
    membershipId,
    leftAt: new Date().toISOString().slice(0, 10),
    userId: user.id,
  });
  if (!result.ok) {
    redirectWithMessage(versionPath(planId, versionId), "error", result.message);
  }

  revalidatePath(versionPath(planId, versionId));
  redirectWithMessage(versionPath(planId, versionId), "success", "Eczane havuzdan ayrıldı.");
}

// ---------------------------------------------------------------------------
// Etkinleştirme
// ---------------------------------------------------------------------------

export async function activatePlanVersionAction(planId: string, versionId: string, regionId: string) {
  const user = await requireOrganizationMember();
  if (user.role !== "ADMIN") {
    redirectWithMessage(versionPath(planId, versionId), "error", ADMIN_ONLY_MESSAGE);
  }

  const result = await activatePlanVersion({
    organizationId: user.organizationId,
    regionId,
    planVersionId: versionId,
    userId: user.id,
  });
  if (!result.ok) {
    redirectWithMessage(versionPath(planId, versionId), "error", result.message);
  }

  revalidatePath(versionPath(planId, versionId));
  revalidatePath("/cizelgeler/v2/planlar");
  redirectWithMessage(
    versionPath(planId, versionId),
    "success",
    result.outcome === "ACTIVATED" ? "Sürüm etkinleştirildi." : "Bu sürüm zaten etkindi."
  );
}
