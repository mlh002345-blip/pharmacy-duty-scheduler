// Duty Rules V2 — Phase 11: create a new DutyPlan and its first DRAFT
// DutyPlanVersion, tenant-scoped. This is the FIRST write in the
// configuration flow — every other configuration service in this
// directory operates on a plan/version this created (or an additional
// version created by create-plan-version.ts).
//
// Deliberately does NOT touch anything under src/lib/duty-rules-v2/engine,
// draft, rules, selection, or persistence — see CLAUDE.md/the Phase 11
// task spec's hard constraints.

import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export type CreateDutyPlanInput = {
  organizationId: string;
  regionId: string;
  name: string;
  userId: string;
  /** "YYYY-MM-DD" — defaults to today (UTC) when omitted. */
  validFrom?: string;
};

export type CreateDutyPlanSuccess = {
  ok: true;
  planId: string;
  versionId: string;
};

export type CreateDutyPlanErrorCode = "REGION_NOT_FOUND" | "INVALID_INPUT";

export type CreateDutyPlanFailure = {
  ok: false;
  code: CreateDutyPlanErrorCode;
  message: string;
};

export type CreateDutyPlanResult = CreateDutyPlanSuccess | CreateDutyPlanFailure;

function fail(code: CreateDutyPlanErrorCode, message: string): CreateDutyPlanFailure {
  return { ok: false, code, message };
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function createDutyPlan(input: CreateDutyPlanInput): Promise<CreateDutyPlanResult> {
  const { organizationId, regionId, userId } = input;
  const name = input.name.trim();

  if (name.length === 0) {
    return fail("INVALID_INPUT", "Plan adı boş olamaz.");
  }
  if (input.validFrom !== undefined && !ISO_DATE_PATTERN.test(input.validFrom)) {
    return fail("INVALID_INPUT", "Geçerlilik başlangıç tarihi geçersiz.");
  }

  // Tenant-scoped: regionId is client-supplied and only trusted once
  // confirmed to belong to the caller's own organization.
  const region = await prisma.region.findFirst({
    where: { id: regionId, organizationId },
    select: { id: true },
  });
  if (!region) {
    return fail("REGION_NOT_FOUND", "Bölge bulunamadı.");
  }

  const validFrom = input.validFrom ? new Date(`${input.validFrom}T00:00:00.000Z`) : new Date();

  const result = await prisma.$transaction(async (tx) => {
    const plan = await tx.dutyPlan.create({
      data: { name, organizationId, regionId },
    });
    const version = await tx.dutyPlanVersion.create({
      data: {
        planId: plan.id,
        versionNumber: 1,
        status: "DRAFT",
        validFrom,
      },
    });
    await writeAuditLog(tx, {
      organizationId,
      userId,
      action: "CREATE",
      entity: "DutyPlan",
      entityId: plan.id,
      after: { name, regionId, firstVersionId: version.id },
    });
    return { planId: plan.id, versionId: version.id };
  });

  return { ok: true, planId: result.planId, versionId: result.versionId };
}
