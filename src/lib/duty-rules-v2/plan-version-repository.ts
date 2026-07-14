// Duty Rules V2 — Phase 3: the repository (the ONLY module in the loader
// stack that touches Prisma).
//
// Server-only by construction: it imports "@/lib/prisma" (which validates
// env and constructs the client at module load), exactly like every other
// server-side data module in this codebase — no client component can
// import it without the build failing on the Prisma engine.
//
// READ-ONLY: this module contains exactly one findFirst. No create/
// update/delete/upsert/raw SQL exists anywhere in the loader stack.
//
// TENANT SCOPING FROM THE ROOT: the version is looked up by id AND
// plan.organizationId AND plan.regionId in ONE where clause. There is no
// unscoped findUnique(planVersionId), no fallback query when the scoped
// lookup misses, no "first matching plan" selection, and no default
// organization or region — a version from another organization or region
// is indistinguishable from a nonexistent id (both return null).

import type { PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { PlanVersionRecord, RotationPoolRecord } from "./plan-version-record";

export type FetchDutyPlanVersionInput = {
  organizationId: string;
  regionId: string;
  planVersionId: string;
};

const poolSelect = {
  id: true,
  name: true,
  strategy: true,
  organizationId: true,
  regionId: true,
  memberships: {
    select: {
      id: true,
      pharmacyId: true,
      joinedAt: true,
      leftAt: true,
      sortIndex: true,
      pharmacy: {
        select: {
          id: true,
          name: true,
          isActive: true,
          regionId: true,
          region: { select: { organizationId: true } },
        },
      },
    },
  },
  rotationStates: {
    select: {
      id: true,
      dayTypeScope: true,
      currentRound: true,
      carriedForward: true,
      lockVersion: true,
      lastServedMembershipId: true,
    },
  },
} as const;

/**
 * Fetch one plan version graph as a plain persistence DTO, or null when
 * no version with this id exists inside the requested organization and
 * region (deliberately the same answer for "does not exist" and "exists
 * but belongs to another tenant").
 */
export async function fetchDutyPlanVersionRecord(
  input: FetchDutyPlanVersionInput,
  db: PrismaClient = prisma
): Promise<PlanVersionRecord | null> {
  const row = await db.dutyPlanVersion.findFirst({
    where: {
      id: input.planVersionId,
      plan: {
        organizationId: input.organizationId,
        regionId: input.regionId,
      },
    },
    select: {
      id: true,
      versionNumber: true,
      status: true,
      validFrom: true,
      validTo: true,
      updatedAt: true,
      plan: {
        select: {
          id: true,
          name: true,
          organizationId: true,
          regionId: true,
          region: { select: { id: true, organizationId: true, isActive: true } },
        },
      },
      dayTypeRules: {
        select: {
          id: true,
          dayType: true,
          isServed: true,
          customDayCategory: true,
          slotRequirements: {
            select: {
              id: true,
              name: true,
              requiredCount: true,
              sortOrder: true,
              dayTypeRuleId: true,
              shiftDefinitionId: true,
              rotationPoolId: true,
              rotationPool: { select: poolSelect },
            },
          },
        },
      },
      shiftDefinitions: {
        select: {
          id: true,
          name: true,
          startMinute: true,
          endMinute: true,
          spansMidnight: true,
          defaultWeight: true,
          sortOrder: true,
        },
      },
    },
  });

  if (row === null) return null;

  // Deduplicate pools (several slots may reference the same pool — the
  // nested include repeats the full payload per slot) and flatten the
  // pharmacy's region-derived organization for tenant validation. NO
  // FILTERING happens here: cross-tenant pools/pharmacies are returned
  // verbatim so the validators can reject the load with a typed error
  // instead of the reference silently vanishing.
  const poolsById = new Map<string, RotationPoolRecord>();
  for (const dayTypeRule of row.dayTypeRules) {
    for (const slot of dayTypeRule.slotRequirements) {
      const pool = slot.rotationPool;
      if (pool === null || poolsById.has(pool.id)) continue;
      poolsById.set(pool.id, {
        id: pool.id,
        name: pool.name,
        strategy: pool.strategy,
        organizationId: pool.organizationId,
        regionId: pool.regionId,
        memberships: pool.memberships.map((membership) => ({
          id: membership.id,
          pharmacyId: membership.pharmacyId,
          joinedAt: membership.joinedAt,
          leftAt: membership.leftAt,
          sortIndex: membership.sortIndex,
          pharmacy: {
            id: membership.pharmacy.id,
            name: membership.pharmacy.name,
            isActive: membership.pharmacy.isActive,
            regionId: membership.pharmacy.regionId,
            regionOrganizationId: membership.pharmacy.region.organizationId,
          },
        })),
        rotationStates: pool.rotationStates.map((state) => ({
          id: state.id,
          dayTypeScope: state.dayTypeScope,
          currentRound: state.currentRound,
          carriedForward: state.carriedForward,
          lockVersion: state.lockVersion,
          lastServedMembershipId: state.lastServedMembershipId,
        })),
      });
    }
  }

  return {
    id: row.id,
    versionNumber: row.versionNumber,
    status: row.status,
    validFrom: row.validFrom,
    validTo: row.validTo,
    updatedAt: row.updatedAt,
    plan: {
      id: row.plan.id,
      name: row.plan.name,
      organizationId: row.plan.organizationId,
      regionId: row.plan.regionId,
      region: {
        id: row.plan.region.id,
        organizationId: row.plan.region.organizationId,
        isActive: row.plan.region.isActive,
      },
    },
    dayTypeRules: row.dayTypeRules.map((rule) => ({
      id: rule.id,
      dayType: rule.dayType,
      isServed: rule.isServed,
      customDayCategory: rule.customDayCategory,
      slotRequirements: rule.slotRequirements.map((slot) => ({
        id: slot.id,
        name: slot.name,
        requiredCount: slot.requiredCount,
        sortOrder: slot.sortOrder,
        dayTypeRuleId: slot.dayTypeRuleId,
        shiftDefinitionId: slot.shiftDefinitionId,
        rotationPoolId: slot.rotationPoolId,
      })),
    })),
    shiftDefinitions: row.shiftDefinitions.map((shift) => ({
      id: shift.id,
      name: shift.name,
      startMinute: shift.startMinute,
      endMinute: shift.endMinute,
      spansMidnight: shift.spansMidnight,
      defaultWeight: shift.defaultWeight,
      sortOrder: shift.sortOrder,
    })),
    rotationPools: [...poolsById.values()],
  };
}
