// Konum bazlı nöbet — ServiceArea CRUD server actions, against a real
// Postgres database. Proves the create/delete actions stay tenant-scoped,
// enforce the per-region unique name constraint, and that deleting a
// ServiceArea only clears the tag from its pharmacies (Pharmacy.serviceAreaId
// is ON DELETE SET NULL) rather than deleting the pharmacies themselves.

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  createServiceAreaAction,
  deleteServiceAreaAction,
} from "@/app/(dashboard)/bolgeler/service-area-actions";
import { IntegrationRedirectSignal, setIntegrationTestSessionToken } from "./helpers/setup";
import {
  createTestPharmacy,
  createTestRegion,
  createTestSessionToken,
  createTestUser,
  cleanupTrackedIds,
  newTrackedIds,
  testRunId,
} from "./helpers/fixtures";

function makeFormData(field: string, value: string) {
  const fd = new FormData();
  fd.set(field, value);
  return fd;
}

describe("ServiceArea CRUD actions (real Postgres)", () => {
  const tracked = newTrackedIds();

  afterEach(async () => {
    setIntegrationTestSessionToken(undefined);
    await cleanupTrackedIds(tracked);
  });

  it("creates a service area scoped to the caller's own region", async () => {
    const region = await createTestRegion(tracked);
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: region.organizationId });
    const token = await createTestSessionToken(admin.id);
    setIntegrationTestSessionToken(token);

    const name = `Üniversite Yakını ${testRunId()}`;
    const result = await createServiceAreaAction(
      region.id,
      { success: false, message: "" },
      makeFormData("name", name)
    );
    expect(result.success).toBe(true);

    const created = await prisma.serviceArea.findFirst({ where: { regionId: region.id, name } });
    expect(created).not.toBeNull();
  });

  it("rejects a duplicate name within the same region", async () => {
    const region = await createTestRegion(tracked);
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: region.organizationId });
    const token = await createTestSessionToken(admin.id);
    setIntegrationTestSessionToken(token);

    const name = `Merkez ${testRunId()}`;
    await prisma.serviceArea.create({ data: { name, regionId: region.id } });

    const result = await createServiceAreaAction(
      region.id,
      { success: false, message: "" },
      makeFormData("name", name)
    );
    expect(result.success).toBe(false);
  });

  it("rejects creating a service area under another organization's region", async () => {
    const regionA = await createTestRegion(tracked);
    const regionB = await createTestRegion(tracked);
    const adminA = await createTestUser(tracked, { role: "ADMIN", organizationId: regionA.organizationId });
    const token = await createTestSessionToken(adminA.id);
    setIntegrationTestSessionToken(token);

    const result = await createServiceAreaAction(
      regionB.id,
      { success: false, message: "" },
      makeFormData("name", `Yabancı Bölge ${testRunId()}`)
    );
    expect(result.success).toBe(false);

    const created = await prisma.serviceArea.findFirst({ where: { regionId: regionB.id } });
    expect(created).toBeNull();
  });

  it("deletes a service area and clears the tag from its pharmacies without deleting them", async () => {
    const region = await createTestRegion(tracked);
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: region.organizationId });
    const token = await createTestSessionToken(admin.id);
    setIntegrationTestSessionToken(token);

    const serviceArea = await prisma.serviceArea.create({
      data: { name: `Sahil ${testRunId()}`, regionId: region.id },
    });
    const pharmacy = await createTestPharmacy(tracked, region.id);
    await prisma.pharmacy.update({ where: { id: pharmacy.id }, data: { serviceAreaId: serviceArea.id } });

    await expect(deleteServiceAreaAction(region.id, serviceArea.id)).rejects.toThrow(
      IntegrationRedirectSignal
    );

    const remainingArea = await prisma.serviceArea.findUnique({ where: { id: serviceArea.id } });
    expect(remainingArea).toBeNull();
    const survivingPharmacy = await prisma.pharmacy.findUnique({ where: { id: pharmacy.id } });
    expect(survivingPharmacy).not.toBeNull();
    expect(survivingPharmacy?.serviceAreaId).toBeNull();
  });

  it("rejects deleting a service area belonging to another organization", async () => {
    const regionA = await createTestRegion(tracked);
    const regionB = await createTestRegion(tracked);
    const adminA = await createTestUser(tracked, { role: "ADMIN", organizationId: regionA.organizationId });
    const token = await createTestSessionToken(adminA.id);
    setIntegrationTestSessionToken(token);

    const serviceAreaB = await prisma.serviceArea.create({
      data: { name: `B Alanı ${testRunId()}`, regionId: regionB.id },
    });

    await expect(deleteServiceAreaAction(regionB.id, serviceAreaB.id)).rejects.toThrow(
      IntegrationRedirectSignal
    );

    const stillThere = await prisma.serviceArea.findUnique({ where: { id: serviceAreaB.id } });
    expect(stillThere).not.toBeNull();
  });
});
