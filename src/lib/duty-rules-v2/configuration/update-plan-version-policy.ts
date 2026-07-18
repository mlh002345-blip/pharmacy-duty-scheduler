// Duty Rules V2 — Phase 12: set/clear a plan version's OWN native
// scheduling policy (minimum interval, relaxation, same-day-assignment
// rule, holiday-eve weight source, holiday-overlap resolution mode).
//
// Same shape/conventions as update-day-type-rules.ts: tenant + DRAFT
// guard via requireDraftPlanVersion, a single prisma.dutyPlanVersion.update
// wrapped with writeAuditLog, typed Turkish-message result.
//
// minDaysBetweenDuties: null is an EXPLICIT choice ("clear/unset this
// version's native policy, fall back to V1-compatibility mode at
// generation time"), never treated as "leave untouched" — the caller
// always supplies the full desired value, exactly like
// setDayTypeRules' "input array is the full desired state" convention.

import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { requireDraftPlanVersion, type PlanVersionGuardFailure } from "./plan-version-guard";

export type SetPlanVersionPolicyInput = {
  organizationId: string;
  versionId: string;
  /** null = "clear/unset", an explicit choice, not "don't touch". */
  minDaysBetweenDuties: number | null;
  relaxMinIntervalWhenInsufficient: boolean;
  sameDaySecondAssignmentAllowed: boolean;
  holidayEveWeightSource: "CONFIGURED" | "UNDERLYING_WEEKDAY";
  holidayOverlapResolutionMode: "NATIVE_PRECEDENCE" | "V1_LAST_INPUT_WINS";
  userId: string;
};

export type SetPlanVersionPolicySuccess = { ok: true };

export type SetPlanVersionPolicyErrorCode =
  | PlanVersionGuardFailure["code"]
  | "INVALID_MIN_DAYS_BETWEEN_DUTIES";

export type SetPlanVersionPolicyFailure = {
  ok: false;
  code: SetPlanVersionPolicyErrorCode;
  message: string;
};

export type SetPlanVersionPolicyResult = SetPlanVersionPolicySuccess | SetPlanVersionPolicyFailure;

function fail(
  code: SetPlanVersionPolicyErrorCode,
  message: string
): SetPlanVersionPolicyFailure {
  return { ok: false, code, message };
}

export async function setPlanVersionPolicy(
  input: SetPlanVersionPolicyInput
): Promise<SetPlanVersionPolicyResult> {
  const { organizationId, versionId, minDaysBetweenDuties, userId } = input;

  if (
    minDaysBetweenDuties !== null &&
    (!Number.isInteger(minDaysBetweenDuties) || minDaysBetweenDuties < 0)
  ) {
    return fail(
      "INVALID_MIN_DAYS_BETWEEN_DUTIES",
      "Asgari nöbet aralığı boş bırakılmalı veya negatif olmayan bir tam sayı olmalıdır."
    );
  }

  const guard = await requireDraftPlanVersion(organizationId, versionId);
  if (!guard.ok) return fail(guard.code, guard.message);

  await prisma.$transaction(async (tx) => {
    await tx.dutyPlanVersion.update({
      where: { id: versionId },
      data: {
        minDaysBetweenDuties,
        relaxMinIntervalWhenInsufficient: input.relaxMinIntervalWhenInsufficient,
        sameDaySecondAssignmentAllowed: input.sameDaySecondAssignmentAllowed,
        holidayEveWeightSource: input.holidayEveWeightSource,
        holidayOverlapResolutionMode: input.holidayOverlapResolutionMode,
      },
    });
    await writeAuditLog(tx, {
      organizationId,
      userId,
      action: "UPDATE",
      entity: "DutyPlanVersion",
      entityId: versionId,
      after: {
        policy: {
          minDaysBetweenDuties,
          relaxMinIntervalWhenInsufficient: input.relaxMinIntervalWhenInsufficient,
          sameDaySecondAssignmentAllowed: input.sameDaySecondAssignmentAllowed,
          holidayEveWeightSource: input.holidayEveWeightSource,
          holidayOverlapResolutionMode: input.holidayOverlapResolutionMode,
        },
      },
    });
  });

  return { ok: true };
}
