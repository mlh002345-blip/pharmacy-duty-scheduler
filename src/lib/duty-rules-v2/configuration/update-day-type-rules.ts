// Duty Rules V2 — Phase 11: declarative replace of a plan version's
// DayTypeRule rows.
//
// The input array is the FULL desired state for this version — rows
// matched by (dayType, customDayCategory) are updated IN PLACE (preserving
// id and any child SlotRequirements); rows genuinely absent from the
// input are deleted (an intentional "remove this day type" — cascades to
// its SlotRequirements via DayTypeRule.onDelete: Cascade, which is the
// only sane behavior for a removed day type); rows with no existing match
// are created. A delete-all-then-recreate approach was deliberately
// rejected — it would cascade-delete SlotRequirements belonging to day
// types that are STILL present in the new input, silently destroying
// configuration the caller never asked to remove.

import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { requireDraftPlanVersion, type PlanVersionGuardFailure } from "./plan-version-guard";
import { BUILTIN_DAY_TYPES, type BuiltinDayType } from "../domain/loaded-plan";

export type DayTypeRuleInput = {
  dayType: BuiltinDayType;
  isServed: boolean;
  /** Deliberately left null in this phase's UI (documented future
   *  extensibility field) — accepted here so the service itself doesn't
   *  hard-block a future caller that does supply it. */
  customDayCategory?: string | null;
  /** Duty Rules V2 — Phase 12: this day type's own weight, independent
   *  of any V1 DutyRule. null (or omitted — undefined is treated the
   *  same as null) = "not yet configured." Since this is a
   *  declarative-replace service (the input array is the full desired
   *  state), a caller that cares about weight must pass it on every
   *  call; omitting the field is only appropriate for callers that
   *  genuinely have no weight concept (e.g. earlier-phase test fixtures)
   *  and are fine with null. Allowed on isServed:false rows too — an
   *  admin may toggle a day off and back on without losing a
   *  previously-entered weight; it's simply unused while isServed is
   *  false. */
  weight?: number | null;
};

export type SetDayTypeRulesInput = {
  organizationId: string;
  versionId: string;
  rules: DayTypeRuleInput[];
  userId: string;
};

export type SetDayTypeRulesSuccess = { ok: true; count: number };

export type SetDayTypeRulesErrorCode =
  | PlanVersionGuardFailure["code"]
  | "INVALID_INPUT"
  | "DUPLICATE_DAY_TYPE"
  | "INVALID_WEIGHT";

export type SetDayTypeRulesFailure = {
  ok: false;
  code: SetDayTypeRulesErrorCode;
  message: string;
};

export type SetDayTypeRulesResult = SetDayTypeRulesSuccess | SetDayTypeRulesFailure;

function fail(code: SetDayTypeRulesErrorCode, message: string): SetDayTypeRulesFailure {
  return { ok: false, code, message };
}

function ruleKey(dayType: string, customDayCategory: string | null): string {
  return `${dayType}|${customDayCategory ?? ""}`;
}

export async function setDayTypeRules(input: SetDayTypeRulesInput): Promise<SetDayTypeRulesResult> {
  const { organizationId, versionId, userId } = input;

  for (const rule of input.rules) {
    if (!(BUILTIN_DAY_TYPES as readonly string[]).includes(rule.dayType)) {
      return fail("INVALID_INPUT", "Geçersiz gün tipi.");
    }
    if (
      rule.weight !== null &&
      rule.weight !== undefined &&
      (!Number.isFinite(rule.weight) || rule.weight <= 0)
    ) {
      return fail("INVALID_WEIGHT", "Gün tipi ağırlığı pozitif bir sayı olmalıdır.");
    }
  }
  const keys = input.rules.map((r) => ruleKey(r.dayType, r.customDayCategory ?? null));
  if (new Set(keys).size !== keys.length) {
    return fail("DUPLICATE_DAY_TYPE", "Aynı gün tipi (ve kategorisi) birden fazla kez gönderildi.");
  }

  const guard = await requireDraftPlanVersion(organizationId, versionId);
  if (!guard.ok) return fail(guard.code, guard.message);

  const existingRules = await prisma.dayTypeRule.findMany({
    where: { planVersionId: versionId },
    select: { id: true, dayType: true, customDayCategory: true },
  });
  const existingByKey = new Map(
    existingRules.map((r) => [ruleKey(r.dayType, r.customDayCategory), r.id])
  );
  const desiredKeys = new Set(keys);

  const toDelete = existingRules.filter(
    (r) => !desiredKeys.has(ruleKey(r.dayType, r.customDayCategory))
  );

  const count = await prisma.$transaction(async (tx) => {
    if (toDelete.length > 0) {
      await tx.dayTypeRule.deleteMany({ where: { id: { in: toDelete.map((r) => r.id) } } });
    }
    for (const rule of input.rules) {
      const key = ruleKey(rule.dayType, rule.customDayCategory ?? null);
      const existingId = existingByKey.get(key);
      if (existingId) {
        await tx.dayTypeRule.update({
          where: { id: existingId },
          data: { isServed: rule.isServed, weight: rule.weight ?? null },
        });
      } else {
        await tx.dayTypeRule.create({
          data: {
            planVersionId: versionId,
            dayType: rule.dayType,
            isServed: rule.isServed,
            customDayCategory: rule.customDayCategory ?? null,
            weight: rule.weight ?? null,
          },
        });
      }
    }
    await writeAuditLog(tx, {
      organizationId,
      userId,
      action: "UPDATE",
      entity: "DutyPlanVersion",
      entityId: versionId,
      after: { dayTypeRules: input.rules, deletedCount: toDelete.length },
    });
    return input.rules.length;
  });

  return { ok: true, count };
}
