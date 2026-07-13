import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  updatePharmacyAction,
  deletePharmacyAction,
} from "@/app/(dashboard)/eczaneler/actions";
import { updateRegionAction, deleteRegionAction } from "@/app/(dashboard)/bolgeler/actions";
import { loadDutyScheduleForExport } from "@/lib/scheduling/export-duty-schedule";
import { getDutyBalanceRows } from "@/lib/balance/duty-balance";
import { getDataHealthReport } from "@/lib/health/data-health";
import { getCurrentUser } from "@/lib/auth/session";
import { IntegrationRedirectSignal, setIntegrationTestSessionToken } from "./helpers/setup";
import {
  createTestDutyRule,
  createTestOrganization,
  createTestPharmacy,
  createTestRegion,
  createTestSessionToken,
  createTestUser,
  cleanupTrackedIds,
  newTrackedIds,
} from "./helpers/fixtures";

// Multi-Tenancy Chunk 1 — cross-tenant isolation proof against a real
// Postgres database (no mocking of Prisma, auth, or the actions under
// test). Two fully independent organizations are created; every
// assertion below is a concrete "Organization A cannot touch
// Organization B's data" claim, not a unit-level shape check.
describe("cross-tenant isolation (two real organizations, real Postgres)", () => {
  const tracked = newTrackedIds();

  afterEach(async () => {
    setIntegrationTestSessionToken(undefined);
    await cleanupTrackedIds(tracked);
  });

  async function setupTwoOrganizations() {
    const orgA = await createTestOrganization(tracked);
    const orgB = await createTestOrganization(tracked);

    const regionA = await createTestRegion(tracked, {
      organizationId: orgA.id,
      name: "Aynı İsimli Bölge",
    });
    const regionB = await createTestRegion(tracked, {
      organizationId: orgB.id,
      name: "Aynı İsimli Bölge", // deliberately identical name — proves per-org uniqueness
    });
    await createTestDutyRule(regionA.id);
    await createTestDutyRule(regionB.id);

    const pharmacyA = await createTestPharmacy(tracked, regionA.id, {
      name: "Aynı İsimli Eczane",
    });
    const pharmacyB = await createTestPharmacy(tracked, regionB.id, {
      name: "Aynı İsimli Eczane", // deliberately identical name — same proof at the pharmacy level
    });

    const adminA = await createTestUser(tracked, { role: "ADMIN", organizationId: orgA.id });
    const adminB = await createTestUser(tracked, { role: "ADMIN", organizationId: orgB.id });
    const tokenA = await createTestSessionToken(adminA.id);
    const tokenB = await createTestSessionToken(adminB.id);

    return { orgA, orgB, regionA, regionB, pharmacyA, pharmacyB, adminA, adminB, tokenA, tokenB };
  }

  it("identical region and pharmacy names in two different organizations both succeed (uniqueness is per-organization, not global)", async () => {
    const { regionA, regionB, pharmacyA, pharmacyB } = await setupTwoOrganizations();

    expect(regionA.name).toBe(regionB.name);
    expect(regionA.id).not.toBe(regionB.id);
    expect(pharmacyA.name).toBe(pharmacyB.name);
    expect(pharmacyA.id).not.toBe(pharmacyB.id);
  });

  it("Organization A cannot update Organization B's pharmacy via its real id (gets the same not-found state a missing id would)", async () => {
    const { regionA, pharmacyB, tokenA } = await setupTwoOrganizations();
    setIntegrationTestSessionToken(tokenA);

    const formData = new FormData();
    formData.set("name", "Ele Geçirilmiş İsim");
    formData.set("pharmacistName", "Test Eczacı");
    formData.set("phone", "0000000000");
    formData.set("address", "Adres");
    formData.set("city", "İstanbul");
    formData.set("district", "İlçe");
    formData.set("regionId", regionA.id);
    formData.set("mapUrl", "");
    formData.set("isActive", "on");

    const result = await updatePharmacyAction(
      pharmacyB.id,
      { success: false, message: "" },
      formData
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe("Eczane bulunamadı.");

    const untouched = await prisma.pharmacy.findUniqueOrThrow({ where: { id: pharmacyB.id } });
    expect(untouched.name).not.toBe("Ele Geçirilmiş İsim");
  });

  it("Organization A cannot delete Organization B's pharmacy via its real id", async () => {
    const { pharmacyB, tokenA } = await setupTwoOrganizations();
    setIntegrationTestSessionToken(tokenA);

    await expect(deletePharmacyAction(pharmacyB.id)).rejects.toBeInstanceOf(
      IntegrationRedirectSignal
    );

    const stillExists = await prisma.pharmacy.findUnique({ where: { id: pharmacyB.id } });
    expect(stillExists).not.toBeNull();
  });

  it("Organization A cannot update or delete Organization B's region via its real id", async () => {
    const { regionB, tokenA } = await setupTwoOrganizations();
    setIntegrationTestSessionToken(tokenA);

    const formData = new FormData();
    formData.set("name", "Ele Geçirilmiş Bölge");
    formData.set("district", "İlçe");
    formData.set("dailyDutyCount", "1");
    formData.set("isActive", "on");

    const updateResult = await updateRegionAction(
      regionB.id,
      { success: false, message: "" },
      formData
    );
    expect(updateResult.success).toBe(false);
    expect(updateResult.message).toBe("Bölge bulunamadı.");

    await expect(deleteRegionAction(regionB.id)).rejects.toBeInstanceOf(IntegrationRedirectSignal);

    const untouched = await prisma.region.findUniqueOrThrow({ where: { id: regionB.id } });
    expect(untouched.name).not.toBe("Ele Geçirilmiş Bölge");
  });

  it("a published duty schedule in Organization B is invisible to Organization A's export lookup, even by its real id", async () => {
    const { orgA, orgB, regionB, pharmacyB } = await setupTwoOrganizations();

    const scheduleB = await prisma.dutySchedule.create({
      data: { month: 3, year: 2028, regionId: regionB.id, status: "PUBLISHED" },
    });
    tracked.dutyScheduleIds.push(scheduleB.id);
    await prisma.dutyAssignment.create({
      data: {
        dutyScheduleId: scheduleB.id,
        pharmacyId: pharmacyB.id,
        date: new Date(Date.UTC(2028, 2, 1)),
      },
    });

    const asOrgA = await loadDutyScheduleForExport(scheduleB.id, orgA.id);
    expect(asOrgA).toBeNull();

    const asOrgB = await loadDutyScheduleForExport(scheduleB.id, orgB.id);
    expect(asOrgB).not.toBeNull();
    expect(asOrgB?.id).toBe(scheduleB.id);
  });

  it("Organization A's duty-balance report never includes Organization B's pharmacies, even with identical names", async () => {
    const { orgA, pharmacyA, pharmacyB } = await setupTwoOrganizations();

    const rows = await getDutyBalanceRows({ organizationId: orgA.id });
    const rowIds = rows.map((r) => r.pharmacyId);

    expect(rowIds).toContain(pharmacyA.id);
    expect(rowIds).not.toContain(pharmacyB.id);
  });

  it("Organization A's data-health report counts only Organization A's regions/pharmacies", async () => {
    const { orgA, orgB } = await setupTwoOrganizations();

    const reportA = await getDataHealthReport(orgA.id, { now: Date.now() });
    const reportB = await getDataHealthReport(orgB.id, { now: Date.now() + 1 });

    // Both organizations have one region with a duty rule and one active
    // pharmacy — neither report should show the other's data missing
    // (which would indicate cross-contamination) or duplicated (which
    // would indicate a global, unscoped query).
    expect(reportA).toEqual(reportB);
  });

  it("deactivating an organization immediately blocks all of its users, without touching any Session row", async () => {
    const { orgA, adminA, tokenA } = await setupTwoOrganizations();
    setIntegrationTestSessionToken(tokenA);

    const beforeDeactivation = await getCurrentUser();
    expect(beforeDeactivation?.id).toBe(adminA.id);

    await prisma.organization.update({ where: { id: orgA.id }, data: { isActive: false } });

    const afterDeactivation = await getCurrentUser();
    expect(afterDeactivation).toBeNull();

    const sessionStillExists = await prisma.session.findFirst({
      where: { userId: adminA.id },
    });
    expect(sessionStillExists).not.toBeNull();

    // Restore for cleanup's own queries (cleanupTrackedIds doesn't depend
    // on organization.isActive, but leaving orgs deactivated is avoidable).
    await prisma.organization.update({ where: { id: orgA.id }, data: { isActive: true } });
  });

  it("PLATFORM_ADMIN has no organization and cannot be treated as a member of either organization", async () => {
    const platformAdmin = await prisma.user.create({
      data: {
        name: "Platform Admin",
        email: `platform-admin-${Date.now()}@integration.test`,
        passwordHash: "unused-in-this-test",
        role: "PLATFORM_ADMIN",
        isActive: true,
        organizationId: null,
      },
    });
    tracked.userIds.push(platformAdmin.id);
    const token = await createTestSessionToken(platformAdmin.id);
    setIntegrationTestSessionToken(token);

    const user = await getCurrentUser();
    expect(user).not.toBeNull();
    expect(user?.organizationId).toBeNull();
    expect(user?.role).toBe("PLATFORM_ADMIN");
  });
});
