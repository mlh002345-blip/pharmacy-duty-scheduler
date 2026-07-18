// Duty Rules V2 — Phase 11: RotationPoolMembership mutations. Three
// focused functions, each tenant-checked through the pool's own
// organizationId (never trusting a client-supplied poolId/membershipId
// blindly). Pools are not DRAFT-gated (see create-rotation-pool.ts) —
// membership can be edited regardless of which plan version(s) currently
// reference the pool, since membership is a temporal, pool-owned fact,
// not a plan-version-owned one.

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

// ---------------------------------------------------------------------------
// addPoolMembership
// ---------------------------------------------------------------------------

export type AddPoolMembershipInput = {
  organizationId: string;
  poolId: string;
  pharmacyId: string;
  /** "YYYY-MM-DD" */
  joinedAt: string;
  userId: string;
};

export type AddPoolMembershipSuccess = { ok: true; membershipId: string };

export type AddPoolMembershipErrorCode =
  | "POOL_NOT_FOUND"
  | "PHARMACY_NOT_FOUND"
  | "PHARMACY_ALREADY_MEMBER"
  | "INVALID_INPUT"
  | "DUPLICATE_MEMBERSHIP";

export type AddPoolMembershipFailure = {
  ok: false;
  code: AddPoolMembershipErrorCode;
  message: string;
};

export type AddPoolMembershipResult = AddPoolMembershipSuccess | AddPoolMembershipFailure;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function failAdd(code: AddPoolMembershipErrorCode, message: string): AddPoolMembershipFailure {
  return { ok: false, code, message };
}

export async function addPoolMembership(
  input: AddPoolMembershipInput
): Promise<AddPoolMembershipResult> {
  const { organizationId, poolId, pharmacyId, userId } = input;

  if (!ISO_DATE_PATTERN.test(input.joinedAt)) {
    return failAdd("INVALID_INPUT", "Katılım tarihi geçersiz.");
  }

  const pool = await prisma.rotationPool.findFirst({
    where: { id: poolId, organizationId },
    select: { id: true, regionId: true },
  });
  if (!pool) {
    return failAdd("POOL_NOT_FOUND", "Rotasyon havuzu bulunamadı.");
  }

  // Pharmacy must belong to the pool's org, and (if the pool is
  // region-scoped, not org-wide) the pool's own region.
  const pharmacy = await prisma.pharmacy.findFirst({
    where: {
      id: pharmacyId,
      region: { organizationId, ...(pool.regionId ? { id: pool.regionId } : {}) },
    },
    select: { id: true },
  });
  if (!pharmacy) {
    return failAdd(
      "PHARMACY_NOT_FOUND",
      "Eczane bulunamadı veya bu havuzun bölgesine ait değil."
    );
  }

  const openMembership = await prisma.rotationPoolMembership.findFirst({
    where: { poolId, pharmacyId, leftAt: null },
    select: { id: true },
  });
  if (openMembership) {
    return failAdd(
      "PHARMACY_ALREADY_MEMBER",
      "Bu eczanenin bu havuzda zaten açık bir üyeliği var."
    );
  }

  const joinedAt = new Date(`${input.joinedAt}T00:00:00.000Z`);

  try {
    const membership = await prisma.$transaction(async (tx) => {
      const created = await tx.rotationPoolMembership.create({
        data: { poolId, pharmacyId, joinedAt },
      });
      await writeAuditLog(tx, {
        organizationId,
        userId,
        action: "CREATE",
        entity: "RotationPoolMembership",
        entityId: created.id,
        after: { poolId, pharmacyId, joinedAt: input.joinedAt },
      });
      return created;
    });
    return { ok: true, membershipId: membership.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return failAdd(
        "DUPLICATE_MEMBERSHIP",
        "Bu eczane için bu tarihte zaten bir üyelik kaydı var."
      );
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// endPoolMembership
// ---------------------------------------------------------------------------

export type EndPoolMembershipInput = {
  organizationId: string;
  membershipId: string;
  /** "YYYY-MM-DD" */
  leftAt: string;
  userId: string;
};

export type EndPoolMembershipSuccess = { ok: true };

export type EndPoolMembershipErrorCode =
  | "MEMBERSHIP_NOT_FOUND"
  | "ALREADY_CLOSED"
  | "INVALID_INPUT";

export type EndPoolMembershipFailure = {
  ok: false;
  code: EndPoolMembershipErrorCode;
  message: string;
};

export type EndPoolMembershipResult = EndPoolMembershipSuccess | EndPoolMembershipFailure;

function failEnd(code: EndPoolMembershipErrorCode, message: string): EndPoolMembershipFailure {
  return { ok: false, code, message };
}

export async function endPoolMembership(
  input: EndPoolMembershipInput
): Promise<EndPoolMembershipResult> {
  const { organizationId, membershipId, userId } = input;

  if (!ISO_DATE_PATTERN.test(input.leftAt)) {
    return failEnd("INVALID_INPUT", "Ayrılma tarihi geçersiz.");
  }

  const membership = await prisma.rotationPoolMembership.findFirst({
    where: { id: membershipId, pool: { organizationId } },
    select: { id: true, leftAt: true, poolId: true, pharmacyId: true },
  });
  if (!membership) {
    return failEnd("MEMBERSHIP_NOT_FOUND", "Üyelik kaydı bulunamadı.");
  }
  if (membership.leftAt !== null) {
    return failEnd("ALREADY_CLOSED", "Bu üyelik zaten kapatılmış.");
  }

  const leftAt = new Date(`${input.leftAt}T00:00:00.000Z`);

  // Conditional update so two concurrent close attempts on the same
  // membership can't both "win" — mirrors the updateMany+count idiom used
  // throughout Phase 8/9 (see commit-complete-draft.ts / approve-generated-draft.ts).
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.rotationPoolMembership.updateMany({
      where: { id: membershipId, leftAt: null },
      data: { leftAt },
    });
    if (updated.count !== 1) {
      return null;
    }
    await writeAuditLog(tx, {
      organizationId,
      userId,
      action: "UPDATE",
      entity: "RotationPoolMembership",
      entityId: membershipId,
      before: { leftAt: null },
      after: { leftAt: input.leftAt },
    });
    return true;
  });

  if (result === null) {
    return failEnd("ALREADY_CLOSED", "Bu üyelik zaten kapatılmış.");
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// reorderPoolMemberships
// ---------------------------------------------------------------------------

export type ReorderPoolMembershipsInput = {
  organizationId: string;
  poolId: string;
  orderedMembershipIds: string[];
  userId: string;
};

export type ReorderPoolMembershipsSuccess = { ok: true; count: number };

export type ReorderPoolMembershipsErrorCode = "POOL_NOT_FOUND" | "UNKNOWN_MEMBERSHIP_ID";

export type ReorderPoolMembershipsFailure = {
  ok: false;
  code: ReorderPoolMembershipsErrorCode;
  message: string;
};

export type ReorderPoolMembershipsResult =
  | ReorderPoolMembershipsSuccess
  | ReorderPoolMembershipsFailure;

function failReorder(
  code: ReorderPoolMembershipsErrorCode,
  message: string
): ReorderPoolMembershipsFailure {
  return { ok: false, code, message };
}

export async function reorderPoolMemberships(
  input: ReorderPoolMembershipsInput
): Promise<ReorderPoolMembershipsResult> {
  const { organizationId, poolId, orderedMembershipIds, userId } = input;

  const pool = await prisma.rotationPool.findFirst({
    where: { id: poolId, organizationId },
    select: { id: true },
  });
  if (!pool) {
    return failReorder("POOL_NOT_FOUND", "Rotasyon havuzu bulunamadı.");
  }

  const memberships = await prisma.rotationPoolMembership.findMany({
    where: { poolId },
    select: { id: true },
  });
  const validIds = new Set(memberships.map((m) => m.id));
  for (const id of orderedMembershipIds) {
    if (!validIds.has(id)) {
      return failReorder("UNKNOWN_MEMBERSHIP_ID", "Bilinmeyen üyelik kimliği.");
    }
  }

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < orderedMembershipIds.length; i++) {
      await tx.rotationPoolMembership.update({
        where: { id: orderedMembershipIds[i] },
        data: { sortIndex: i },
      });
    }
    await writeAuditLog(tx, {
      organizationId,
      userId,
      action: "UPDATE",
      entity: "RotationPool",
      entityId: poolId,
      after: { reorderedMembershipIds: orderedMembershipIds },
    });
  });

  return { ok: true, count: orderedMembershipIds.length };
}
