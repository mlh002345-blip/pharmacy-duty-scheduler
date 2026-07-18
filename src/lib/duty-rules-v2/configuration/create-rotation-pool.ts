// Duty Rules V2 — Phase 11: create a RotationPool for a region, tenant
// checked. Note pools are NOT owned by a plan version — they're owned by
// the organization (optionally scoped to a region) — so there is no
// DRAFT-status gate here, only tenant checks. Respects
// @@unique([organizationId, name]) with a typed error instead of a raw
// P2002 escaping.

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { ROTATION_STRATEGIES, type RotationStrategyValue } from "../domain/loaded-plan";

export type CreateRotationPoolInput = {
  organizationId: string;
  regionId: string;
  name: string;
  strategy: RotationStrategyValue;
  userId: string;
};

export type CreateRotationPoolSuccess = { ok: true; poolId: string };

export type CreateRotationPoolErrorCode = "REGION_NOT_FOUND" | "INVALID_INPUT" | "POOL_NAME_TAKEN";

export type CreateRotationPoolFailure = {
  ok: false;
  code: CreateRotationPoolErrorCode;
  message: string;
};

export type CreateRotationPoolResult = CreateRotationPoolSuccess | CreateRotationPoolFailure;

function fail(code: CreateRotationPoolErrorCode, message: string): CreateRotationPoolFailure {
  return { ok: false, code, message };
}

export async function createRotationPool(
  input: CreateRotationPoolInput
): Promise<CreateRotationPoolResult> {
  const { organizationId, regionId, userId } = input;
  const name = input.name.trim();

  if (name.length === 0) {
    return fail("INVALID_INPUT", "Havuz adı boş olamaz.");
  }
  if (!(ROTATION_STRATEGIES as readonly string[]).includes(input.strategy)) {
    return fail("INVALID_INPUT", "Geçersiz rotasyon stratejisi.");
  }

  const region = await prisma.region.findFirst({
    where: { id: regionId, organizationId },
    select: { id: true },
  });
  if (!region) {
    return fail("REGION_NOT_FOUND", "Bölge bulunamadı.");
  }

  try {
    const pool = await prisma.$transaction(async (tx) => {
      const created = await tx.rotationPool.create({
        data: { name, strategy: input.strategy, organizationId, regionId },
      });
      await writeAuditLog(tx, {
        organizationId,
        userId,
        action: "CREATE",
        entity: "RotationPool",
        entityId: created.id,
        after: { name, strategy: input.strategy, regionId },
      });
      return created;
    });
    return { ok: true, poolId: pool.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail("POOL_NAME_TAKEN", "Bu isimde bir rotasyon havuzu zaten mevcut.");
    }
    throw error;
  }
}
