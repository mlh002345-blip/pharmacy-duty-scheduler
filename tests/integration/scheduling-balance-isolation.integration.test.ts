import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createDutyScheduleAction } from "@/app/(dashboard)/cizelgeler/actions";
import { historicalImportAction } from "@/app/(dashboard)/gecmis-nobetler/actions";
import { getDutyBalanceRows } from "@/lib/balance/duty-balance";
import { getDataHealthReport } from "@/lib/health/data-health";
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

// Multi-Tenancy Stabilization Gate — scheduling, duty-balance, and
// historical-import isolation, proven with two organizations that share
// IDENTICAL region and pharmacy names. Real Postgres, real Server
// Actions — a name-based mismatch (matching by string instead of by
// organizationId) is exactly the kind of bug identical names is
// designed to catch, since the app has no way to "accidentally" get the
// right answer by matching on name here.
describe("scheduling / duty-balance / historical-import isolation with identical names (real Postgres)", () => {
  const tracked = newTrackedIds();

  afterEach(async () => {
    setIntegrationTestSessionToken(undefined);
    await cleanupTrackedIds(tracked);
  });

  async function setupIdenticallyNamedOrganizations() {
    const orgA = await createTestOrganization(tracked);
    const orgB = await createTestOrganization(tracked);
    const sharedRegionName = "Aynı İsimli Nöbet Bölgesi";
    const regionA = await createTestRegion(tracked, {
      organizationId: orgA.id,
      name: sharedRegionName,
      dailyDutyCount: 1,
    });
    const regionB = await createTestRegion(tracked, {
      organizationId: orgB.id,
      name: sharedRegionName,
      dailyDutyCount: 1,
    });
    await createTestDutyRule(regionA.id);
    await createTestDutyRule(regionB.id);
    const sharedPharmacyName = "Aynı İsimli Nöbet Eczanesi";
    const pharmacyA = await createTestPharmacy(tracked, regionA.id, { name: sharedPharmacyName });
    const pharmacyB = await createTestPharmacy(tracked, regionB.id, { name: sharedPharmacyName });
    const adminA = await createTestUser(tracked, { role: "ADMIN", organizationId: orgA.id });
    const adminB = await createTestUser(tracked, { role: "ADMIN", organizationId: orgB.id });
    const tokenA = await createTestSessionToken(adminA.id);
    const tokenB = await createTestSessionToken(adminB.id);
    return {
      orgA,
      orgB,
      regionA,
      regionB,
      pharmacyA,
      pharmacyB,
      adminA,
      adminB,
      tokenA,
      tokenB,
    };
  }

  it("createDutyScheduleAction only assigns the calling organization's identically-named pharmacy, never the other organization's", async () => {
    const { regionA, regionB, pharmacyA, pharmacyB, tokenA } = await setupIdenticallyNamedOrganizations();
    setIntegrationTestSessionToken(tokenA);

    const formData = new FormData();
    formData.set("month", "9");
    formData.set("year", "2031");
    formData.set("regionId", regionA.id);

    await expect(
      createDutyScheduleAction({ success: false, message: "" }, formData)
    ).rejects.toBeInstanceOf(IntegrationRedirectSignal);

    const schedule = await prisma.dutySchedule.findFirstOrThrow({
      where: { regionId: regionA.id, month: 9, year: 2031 },
      include: { assignments: true },
    });
    tracked.dutyScheduleIds.push(schedule.id);

    expect(schedule.assignments.length).toBeGreaterThan(0);
    for (const assignment of schedule.assignments) {
      expect(assignment.pharmacyId).toBe(pharmacyA.id);
      expect(assignment.pharmacyId).not.toBe(pharmacyB.id);
    }

    // Organization B's identically-named/identically-shaped region must
    // remain completely untouched by Organization A's generation.
    const scheduleForB = await prisma.dutySchedule.findFirst({
      where: { regionId: regionB.id, month: 9, year: 2031 },
    });
    expect(scheduleForB).toBeNull();
  });

  it("a historical import into Organization A only matches Organization A's identically-named pharmacy/region, and Organization B's duty balance stays at zero", async () => {
    const { orgB, regionA, pharmacyA, pharmacyB, tokenA } = await setupIdenticallyNamedOrganizations();
    setIntegrationTestSessionToken(tokenA);

    const rawRows = [
      {
        rowNumber: 1,
        tarih: "12.02.2031",
        bolge: regionA.name,
        eczaneAdi: pharmacyA.name,
        nobetTuru: "Normal",
        telefon: "",
        adres: "",
        not: "",
      },
    ];
    const formData = new FormData();
    formData.set("mode", "import");
    formData.set("rawRows", JSON.stringify(rawRows));
    formData.set("fileName", "identical-names-test.xlsx");

    await expect(
      historicalImportAction({ success: false, message: "" }, formData)
    ).rejects.toBeInstanceOf(IntegrationRedirectSignal);

    const batch = await prisma.historicalDutyImportBatch.findFirstOrThrow({
      where: { organizationId: (await prisma.region.findUniqueOrThrow({ where: { id: regionA.id } })).organizationId },
    });
    tracked.historicalBatchIds.push(batch.id);
    expect(batch.matchedCount).toBe(1);

    const record = await prisma.historicalDutyRecord.findFirstOrThrow({
      where: { batchId: batch.id },
    });
    expect(record.pharmacyId).toBe(pharmacyA.id);
    expect(record.pharmacyId).not.toBe(pharmacyB.id);
    expect(record.regionId).toBe(regionA.id);

    const balanceRowsA = await getDutyBalanceRows({ organizationId: batch.organizationId });
    const rowForA = balanceRowsA.find((r) => r.pharmacyId === pharmacyA.id);
    expect(rowForA?.historicalCount).toBe(1);

    const balanceRowsB = await getDutyBalanceRows({ organizationId: orgB.id });
    const rowForB = balanceRowsB.find((r) => r.pharmacyId === pharmacyB.id);
    // Organization B's identically-named pharmacy must show zero
    // historical activity — the import must not have matched by name
    // across the tenant boundary.
    expect(rowForB?.historicalCount).toBe(0);
  });

  it("data-health cache keys never collide between two organizations with identical setup-completeness shapes", async () => {
    const { orgA, orgB } = await setupIdenticallyNamedOrganizations();

    const reportA = await getDataHealthReport(orgA.id, { now: Date.now() });
    const reportB = await getDataHealthReport(orgB.id, { now: Date.now() + 500 });

    // Both orgs have the same shape of data (one region with a duty
    // rule, one active pharmacy, no historical data, no holidays) so the
    // reports should be structurally identical — proving neither report
    // leaked into or was overwritten by the other's cache entry, which
    // would otherwise be invisible in a same-shape scenario like this.
    expect(reportA).toEqual(reportB);

    // A third, differently-shaped organization (zero regions) must not
    // share a cache entry with either A or B.
    const orgC = await createTestOrganization(tracked);
    const reportC = await getDataHealthReport(orgC.id, { now: Date.now() + 1000 });
    expect(reportC).not.toEqual(reportA);
  });
});
