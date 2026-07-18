// Duty Rules V2 — Phase 11: create a new DRAFT DutyPlanVersion under an
// existing DutyPlan, tenant-checked, with the next versionNumber.

import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export type CreatePlanVersionInput = {
  organizationId: string;
  planId: string;
  userId: string;
  /** "YYYY-MM-DD" — defaults to today (UTC) when omitted. */
  validFrom?: string;
};

export type CreatePlanVersionSuccess = {
  ok: true;
  versionId: string;
  versionNumber: number;
};

export type CreatePlanVersionErrorCode = "PLAN_NOT_FOUND" | "INVALID_INPUT";

export type CreatePlanVersionFailure = {
  ok: false;
  code: CreatePlanVersionErrorCode;
  message: string;
};

export type CreatePlanVersionResult = CreatePlanVersionSuccess | CreatePlanVersionFailure;

function fail(code: CreatePlanVersionErrorCode, message: string): CreatePlanVersionFailure {
  return { ok: false, code, message };
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function createPlanVersion(
  input: CreatePlanVersionInput
): Promise<CreatePlanVersionResult> {
  const { organizationId, planId, userId } = input;

  if (input.validFrom !== undefined && !ISO_DATE_PATTERN.test(input.validFrom)) {
    return fail("INVALID_INPUT", "Geçerlilik başlangıç tarihi geçersiz.");
  }

  const plan = await prisma.dutyPlan.findFirst({
    where: { id: planId, organizationId },
    select: { id: true },
  });
  if (!plan) {
    return fail("PLAN_NOT_FOUND", "Plan bulunamadı.");
  }

  const validFrom = input.validFrom ? new Date(`${input.validFrom}T00:00:00.000Z`) : new Date();

  const result = await prisma.$transaction(async (tx) => {
    const maxVersion = await tx.dutyPlanVersion.aggregate({
      where: { planId },
      _max: { versionNumber: true },
    });
    const nextVersionNumber = (maxVersion._max.versionNumber ?? 0) + 1;

    const version = await tx.dutyPlanVersion.create({
      data: {
        planId,
        versionNumber: nextVersionNumber,
        status: "DRAFT",
        validFrom,
      },
    });
    await writeAuditLog(tx, {
      organizationId,
      userId,
      action: "CREATE",
      entity: "DutyPlanVersion",
      entityId: version.id,
      after: { planId, versionNumber: nextVersionNumber, status: "DRAFT" },
    });
    return { versionId: version.id, versionNumber: nextVersionNumber };
  });

  return { ok: true, versionId: result.versionId, versionNumber: result.versionNumber };
}
