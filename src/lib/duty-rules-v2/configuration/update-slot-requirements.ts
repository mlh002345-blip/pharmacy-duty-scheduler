// Duty Rules V2 — Phase 11: declarative replace of a plan version's
// SlotRequirement rows, matched by id (same upsert-by-id pattern as
// update-shift-definitions.ts). Validates that every dayTypeRuleId /
// shiftDefinitionId belongs to THIS version, and every rotationPoolId (if
// not null) belongs to the same organization and is either org-wide
// (regionId === null) or scoped to this version's own region — mirroring
// the exact validation commit-complete-draft.ts's validateReferences
// performs for committed drafts, applied here at configuration time.

import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { requireDraftPlanVersion, type PlanVersionGuardFailure } from "./plan-version-guard";

export type SlotRequirementInput = {
  id?: string;
  name?: string | null;
  dayTypeRuleId: string;
  shiftDefinitionId: string;
  rotationPoolId: string | null;
  requiredCount: number;
  sortOrder: number;
};

export type SetSlotRequirementsInput = {
  organizationId: string;
  versionId: string;
  slots: SlotRequirementInput[];
  userId: string;
};

export type SetSlotRequirementsSuccess = { ok: true; count: number };

export type SetSlotRequirementsErrorCode =
  | PlanVersionGuardFailure["code"]
  | "INVALID_INPUT"
  | "UNKNOWN_SLOT_ID"
  | "UNKNOWN_DAY_TYPE_RULE"
  | "UNKNOWN_SHIFT_DEFINITION"
  | "UNKNOWN_ROTATION_POOL";

export type SetSlotRequirementsFailure = {
  ok: false;
  code: SetSlotRequirementsErrorCode;
  message: string;
};

export type SetSlotRequirementsResult = SetSlotRequirementsSuccess | SetSlotRequirementsFailure;

function fail(code: SetSlotRequirementsErrorCode, message: string): SetSlotRequirementsFailure {
  return { ok: false, code, message };
}

export async function setSlotRequirements(
  input: SetSlotRequirementsInput
): Promise<SetSlotRequirementsResult> {
  const { organizationId, versionId, userId } = input;

  for (const slot of input.slots) {
    if (!Number.isInteger(slot.requiredCount) || slot.requiredCount < 1) {
      return fail("INVALID_INPUT", "Gereken eczane sayısı en az 1 olmalıdır.");
    }
  }

  const guard = await requireDraftPlanVersion(organizationId, versionId);
  if (!guard.ok) return fail(guard.code, guard.message);

  const [dayTypeRules, shifts, existingSlots] = await Promise.all([
    prisma.dayTypeRule.findMany({ where: { planVersionId: versionId }, select: { id: true } }),
    prisma.shiftDefinition.findMany({ where: { planVersionId: versionId }, select: { id: true } }),
    prisma.slotRequirement.findMany({
      where: { dayTypeRule: { planVersionId: versionId } },
      select: { id: true },
    }),
  ]);
  const validDayTypeRuleIds = new Set(dayTypeRules.map((r) => r.id));
  const validShiftIds = new Set(shifts.map((s) => s.id));
  const existingSlotIds = new Set(existingSlots.map((s) => s.id));

  const poolIds = [...new Set(input.slots.map((s) => s.rotationPoolId).filter((id): id is string => id !== null))];
  const pools =
    poolIds.length > 0
      ? await prisma.rotationPool.findMany({
          where: { id: { in: poolIds } },
          select: { id: true, organizationId: true, regionId: true },
        })
      : [];
  const poolById = new Map(pools.map((p) => [p.id, p]));

  for (const slot of input.slots) {
    if (slot.id && !existingSlotIds.has(slot.id)) {
      return fail("UNKNOWN_SLOT_ID", "Bilinmeyen slot gereksinimi kimliği.");
    }
    if (!validDayTypeRuleIds.has(slot.dayTypeRuleId)) {
      return fail("UNKNOWN_DAY_TYPE_RULE", "Slot, bu sürüme ait olmayan bir gün tipine referans veriyor.");
    }
    if (!validShiftIds.has(slot.shiftDefinitionId)) {
      return fail("UNKNOWN_SHIFT_DEFINITION", "Slot, bu sürüme ait olmayan bir vardiyaya referans veriyor.");
    }
    if (slot.rotationPoolId !== null) {
      const pool = poolById.get(slot.rotationPoolId);
      if (
        !pool ||
        pool.organizationId !== organizationId ||
        (pool.regionId !== null && pool.regionId !== guard.version.regionId)
      ) {
        return fail(
          "UNKNOWN_ROTATION_POOL",
          "Slot, çağıranın organizasyon/bölgesine ait olmayan bir rotasyon havuzuna referans veriyor."
        );
      }
    }
  }

  const inputIds = input.slots.filter((s) => s.id).map((s) => s.id as string);
  const toDeleteIds = [...existingSlotIds].filter((id) => !inputIds.includes(id));

  const count = await prisma.$transaction(async (tx) => {
    if (toDeleteIds.length > 0) {
      await tx.slotRequirement.deleteMany({ where: { id: { in: toDeleteIds } } });
    }
    for (const slot of input.slots) {
      const data = {
        name: slot.name ?? null,
        dayTypeRuleId: slot.dayTypeRuleId,
        shiftDefinitionId: slot.shiftDefinitionId,
        rotationPoolId: slot.rotationPoolId,
        requiredCount: slot.requiredCount,
        sortOrder: slot.sortOrder,
      };
      if (slot.id) {
        await tx.slotRequirement.update({ where: { id: slot.id }, data });
      } else {
        await tx.slotRequirement.create({ data });
      }
    }
    await writeAuditLog(tx, {
      organizationId,
      userId,
      action: "UPDATE",
      entity: "DutyPlanVersion",
      entityId: versionId,
      after: { slotRequirements: input.slots, deletedCount: toDeleteIds.length },
    });
    return input.slots.length;
  });

  return { ok: true, count };
}
