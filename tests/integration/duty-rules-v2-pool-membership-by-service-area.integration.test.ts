// Duty Rules V2 — konum bazlı nöbet: addPoolMembershipsByServiceArea,
// against a real Postgres database. Proves the bulk-fill shortcut adds
// exactly the active pharmacies tagged with a given ServiceArea, skips
// inactive ones and already-open memberships, and stays tenant-scoped.

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  addPoolMembership,
  addPoolMembershipsByServiceArea,
} from "@/lib/duty-rules-v2/configuration/update-pool-membership";
import { createRotationPool } from "@/lib/duty-rules-v2/configuration/create-rotation-pool";

import {
  createTestOrganization,
  createTestPharmacy,
  createTestRegion,
  createTestUser,
  cleanupTrackedIds,
  newTrackedIds,
  testRunId,
} from "./helpers/fixtures";

describe("addPoolMembershipsByServiceArea (real Postgres)", () => {
  const tracked = newTrackedIds();
  const cleanupIds = { poolIds: [] as string[] };

  afterEach(async () => {
    if (cleanupIds.poolIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { entity: "RotationPool", entityId: { in: cleanupIds.poolIds } } });
      await prisma.rotationPool.deleteMany({ where: { id: { in: cleanupIds.poolIds } } });
      cleanupIds.poolIds.length = 0;
    }
    await cleanupTrackedIds(tracked);
  });

  it("adds every active tagged pharmacy, skips inactive ones, and reports the count", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const user = await createTestUser(tracked, { organizationId: organization.id, role: "ADMIN" });

    const serviceArea = await prisma.serviceArea.create({
      data: { name: `Üniversite Yakını ${testRunId()}`, regionId: region.id },
    });
    const activeA = await createTestPharmacy(tracked, region.id, { isActive: true });
    const activeB = await createTestPharmacy(tracked, region.id, { isActive: true });
    const inactive = await createTestPharmacy(tracked, region.id, { isActive: false });
    const untagged = await createTestPharmacy(tracked, region.id, { isActive: true });
    await prisma.pharmacy.updateMany({
      where: { id: { in: [activeA.id, activeB.id, inactive.id] } },
      data: { serviceAreaId: serviceArea.id },
    });

    const poolResult = await createRotationPool({
      organizationId: organization.id,
      regionId: region.id,
      name: `Havuz ${testRunId()}`,
      strategy: "SEQUENTIAL",
      userId: user.id,
    });
    expect(poolResult.ok).toBe(true);
    if (!poolResult.ok) return;
    cleanupIds.poolIds.push(poolResult.poolId);

    const result = await addPoolMembershipsByServiceArea({
      organizationId: organization.id,
      poolId: poolResult.poolId,
      serviceAreaId: serviceArea.id,
      joinedAt: "2031-01-01",
      userId: user.id,
    });
    expect(result).toEqual({ ok: true, addedCount: 2, skippedCount: 0 });

    const memberships = await prisma.rotationPoolMembership.findMany({
      where: { poolId: poolResult.poolId, leftAt: null },
      select: { pharmacyId: true },
    });
    const memberIds = new Set(memberships.map((m) => m.pharmacyId));
    expect(memberIds.has(activeA.id)).toBe(true);
    expect(memberIds.has(activeB.id)).toBe(true);
    expect(memberIds.has(inactive.id)).toBe(false);
    expect(memberIds.has(untagged.id)).toBe(false);
  });

  it("skips a pharmacy that's already an open member instead of failing the whole batch", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const user = await createTestUser(tracked, { organizationId: organization.id, role: "ADMIN" });

    const serviceArea = await prisma.serviceArea.create({
      data: { name: `Merkez ${testRunId()}`, regionId: region.id },
    });
    const pharmacyA = await createTestPharmacy(tracked, region.id, { isActive: true });
    const pharmacyB = await createTestPharmacy(tracked, region.id, { isActive: true });
    await prisma.pharmacy.updateMany({
      where: { id: { in: [pharmacyA.id, pharmacyB.id] } },
      data: { serviceAreaId: serviceArea.id },
    });

    const poolResult = await createRotationPool({
      organizationId: organization.id,
      regionId: region.id,
      name: `Havuz ${testRunId()}`,
      strategy: "SEQUENTIAL",
      userId: user.id,
    });
    expect(poolResult.ok).toBe(true);
    if (!poolResult.ok) return;
    cleanupIds.poolIds.push(poolResult.poolId);

    // Pre-add pharmacyA manually, exactly as an admin would before running
    // the bulk shortcut on the rest of the tagged group.
    const preAdd = await addPoolMembership({
      organizationId: organization.id,
      poolId: poolResult.poolId,
      pharmacyId: pharmacyA.id,
      joinedAt: "2031-01-01",
      userId: user.id,
    });
    expect(preAdd.ok).toBe(true);

    const result = await addPoolMembershipsByServiceArea({
      organizationId: organization.id,
      poolId: poolResult.poolId,
      serviceAreaId: serviceArea.id,
      joinedAt: "2031-01-01",
      userId: user.id,
    });
    expect(result).toEqual({ ok: true, addedCount: 1, skippedCount: 1 });
  });

  it("rejects a pool or service area belonging to another organization", async () => {
    const organizationA = await createTestOrganization(tracked);
    const organizationB = await createTestOrganization(tracked);
    const regionA = await createTestRegion(tracked, { organizationId: organizationA.id });
    const regionB = await createTestRegion(tracked, { organizationId: organizationB.id });
    const userA = await createTestUser(tracked, { organizationId: organizationA.id, role: "ADMIN" });
    const userB = await createTestUser(tracked, { organizationId: organizationB.id, role: "ADMIN" });

    const serviceAreaB = await prisma.serviceArea.create({
      data: { name: `B Hizmet Alanı ${testRunId()}`, regionId: regionB.id },
    });
    const poolResultA = await createRotationPool({
      organizationId: organizationA.id,
      regionId: regionA.id,
      name: `A Havuzu ${testRunId()}`,
      strategy: "SEQUENTIAL",
      userId: userA.id,
    });
    expect(poolResultA.ok).toBe(true);
    if (!poolResultA.ok) return;
    cleanupIds.poolIds.push(poolResultA.poolId);

    // Organization A's pool, Organization B's service area — neither
    // organization can bulk-fill across the boundary.
    const crossResult = await addPoolMembershipsByServiceArea({
      organizationId: organizationA.id,
      poolId: poolResultA.poolId,
      serviceAreaId: serviceAreaB.id,
      joinedAt: "2031-01-01",
      userId: userA.id,
    });
    expect(crossResult).toEqual({ ok: false, code: "SERVICE_AREA_NOT_FOUND", message: expect.any(String) });

    const poolResultB = await createRotationPool({
      organizationId: organizationB.id,
      regionId: regionB.id,
      name: `B Havuzu ${testRunId()}`,
      strategy: "SEQUENTIAL",
      userId: userB.id,
    });
    expect(poolResultB.ok).toBe(true);
    if (!poolResultB.ok) return;
    cleanupIds.poolIds.push(poolResultB.poolId);

    const wrongOrgResult = await addPoolMembershipsByServiceArea({
      organizationId: organizationA.id,
      poolId: poolResultB.poolId,
      serviceAreaId: serviceAreaB.id,
      joinedAt: "2031-01-01",
      userId: userA.id,
    });
    expect(wrongOrgResult).toEqual({ ok: false, code: "POOL_NOT_FOUND", message: expect.any(String) });
  });
});
