import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createPublicDutyRequestAction } from "@/app/eczane-talep/[token]/actions";
import { getPublishedAssignmentsForDate } from "@/lib/scheduling/public-duty-lookup";
import {
  createTestOrganization,
  createTestPharmacy,
  createTestRegion,
  cleanupTrackedIds,
  newTrackedIds,
} from "./helpers/fixtures";

// Multi-Tenancy Stabilization Gate — public (unauthenticated) route
// regression, proven against a real Postgres database with two
// independent organizations. These routes have no session/auth context
// at all, so the tenant boundary here is entirely: (a) the per-pharmacy
// unique requestToken, and (b) the region id the citizen page's own
// server-rendered dropdown already scoped to one organization — never a
// client-supplied organizationId.
describe("public route isolation (no auth context, real Postgres, two organizations)", () => {
  const tracked = newTrackedIds();

  afterEach(async () => {
    await cleanupTrackedIds(tracked);
  });

  it("a public duty-request submission ignores a forged pharmacyId/regionId in the form body — both always come from the token, never client input", async () => {
    const orgA = await createTestOrganization(tracked);
    const orgB = await createTestOrganization(tracked);
    const regionA = await createTestRegion(tracked, { organizationId: orgA.id });
    const regionB = await createTestRegion(tracked, { organizationId: orgB.id });
    const pharmacyA = await createTestPharmacy(tracked, regionA.id);
    const pharmacyB = await createTestPharmacy(tracked, regionB.id);

    const formData = new FormData();
    formData.set("requestType", "CANNOT_DUTY");
    formData.set("startDate", "2030-01-10");
    formData.set("endDate", "2030-01-11");
    formData.set("explanation", "Test amaçlı gönderilen talep açıklaması.");
    // Attacker-forged fields — the real schema has no pharmacyId/regionId
    // key at all, so z.object(...).safeParse silently strips these; this
    // proves that behaviorally, not just by reading the schema source.
    formData.set("pharmacyId", pharmacyB.id);
    formData.set("regionId", regionB.id);

    const result = await createPublicDutyRequestAction(
      pharmacyA.requestToken!,
      { success: false, message: "" },
      formData
    );
    expect(result.success).toBe(true);

    const created = await prisma.dutyRequest.findFirstOrThrow({
      where: { explanation: "Test amaçlı gönderilen talep açıklaması." },
    });
    expect(created.pharmacyId).toBe(pharmacyA.id);
    expect(created.pharmacyId).not.toBe(pharmacyB.id);
    expect(created.regionId).toBe(regionA.id);
    expect(created.regionId).not.toBe(regionB.id);

    await prisma.dutyRequest.delete({ where: { id: created.id } });
  });

  it("a token belonging to Organization A's pharmacy never resolves to Organization B's pharmacy, even with an identical pharmacy name", async () => {
    const orgA = await createTestOrganization(tracked);
    const orgB = await createTestOrganization(tracked);
    const regionA = await createTestRegion(tracked, { organizationId: orgA.id });
    const regionB = await createTestRegion(tracked, { organizationId: orgB.id });
    const sharedName = "Aynı İsimli Nöbet Talep Eczanesi";
    const pharmacyA = await createTestPharmacy(tracked, regionA.id, { name: sharedName });
    const pharmacyB = await createTestPharmacy(tracked, regionB.id, { name: sharedName });

    const resolvedByTokenA = await prisma.pharmacy.findUnique({
      where: { requestToken: pharmacyA.requestToken! },
      select: { id: true },
    });
    expect(resolvedByTokenA?.id).toBe(pharmacyA.id);
    expect(resolvedByTokenA?.id).not.toBe(pharmacyB.id);

    const resolvedByTokenB = await prisma.pharmacy.findUnique({
      where: { requestToken: pharmacyB.requestToken! },
      select: { id: true },
    });
    expect(resolvedByTokenB?.id).toBe(pharmacyB.id);
  });

  it("getPublishedAssignmentsForDate (the /vatandas data source) never returns another organization's assignments for a same-named region", async () => {
    const orgA = await createTestOrganization(tracked);
    const orgB = await createTestOrganization(tracked);
    const sharedRegionName = "Aynı İsimli Vatandaş Bölgesi";
    const regionA = await createTestRegion(tracked, {
      organizationId: orgA.id,
      name: sharedRegionName,
    });
    const regionB = await createTestRegion(tracked, {
      organizationId: orgB.id,
      name: sharedRegionName,
    });
    const pharmacyA = await createTestPharmacy(tracked, regionA.id, { name: "Vatandaş A Eczanesi" });
    const pharmacyB = await createTestPharmacy(tracked, regionB.id, { name: "Vatandaş B Eczanesi" });

    const targetDate = new Date(Date.UTC(2029, 5, 15));
    const scheduleA = await prisma.dutySchedule.create({
      data: { month: 6, year: 2029, regionId: regionA.id, status: "PUBLISHED" },
    });
    const scheduleB = await prisma.dutySchedule.create({
      data: { month: 6, year: 2029, regionId: regionB.id, status: "PUBLISHED" },
    });
    tracked.dutyScheduleIds.push(scheduleA.id, scheduleB.id);
    await prisma.dutyAssignment.create({
      data: { dutyScheduleId: scheduleA.id, pharmacyId: pharmacyA.id, date: targetDate },
    });
    await prisma.dutyAssignment.create({
      data: { dutyScheduleId: scheduleB.id, pharmacyId: pharmacyB.id, date: targetDate },
    });

    // regionA.id here plays the role of the value /vatandas's own
    // organization-scoped region dropdown would have produced — never a
    // raw, client-suppliable value.
    const assignmentsForA = await getPublishedAssignmentsForDate(regionA.id, targetDate);
    expect(assignmentsForA).toHaveLength(1);
    expect(assignmentsForA[0].pharmacy.name).toBe("Vatandaş A Eczanesi");

    const assignmentsForB = await getPublishedAssignmentsForDate(regionB.id, targetDate);
    expect(assignmentsForB).toHaveLength(1);
    expect(assignmentsForB[0].pharmacy.name).toBe("Vatandaş B Eczanesi");
  });

  it("an organization's own region list (the source for /vatandas's dropdown) never includes another organization's identically-named region", async () => {
    const orgA = await createTestOrganization(tracked);
    const orgB = await createTestOrganization(tracked);
    const sharedName = "Aynı İsimli Dropdown Bölgesi";
    const regionA = await createTestRegion(tracked, { organizationId: orgA.id, name: sharedName });
    const regionB = await createTestRegion(tracked, { organizationId: orgB.id, name: sharedName });

    const regionsForA = await prisma.region.findMany({
      where: { isActive: true, organizationId: orgA.id },
      select: { id: true },
    });
    expect(regionsForA.map((r) => r.id)).toEqual([regionA.id]);
    expect(regionsForA.map((r) => r.id)).not.toContain(regionB.id);
  });
});
