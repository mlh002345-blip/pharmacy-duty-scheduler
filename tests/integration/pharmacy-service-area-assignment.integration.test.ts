// Konum bazlı nöbet — createPharmacyAction/updatePharmacyAction with a
// client-supplied serviceAreaId, against a real Postgres database. Proves a
// same-region tag is accepted, a cross-region or cross-tenant service area
// is rejected even when the pharmacy's own region/organization are valid,
// and an empty selection stores no tag.

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  createPharmacyAction,
  updatePharmacyAction,
} from "@/app/(dashboard)/eczaneler/actions";
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

function pharmacyFormData(overrides: Record<string, string>) {
  const fd = new FormData();
  fd.set("name", overrides.name ?? `Test Eczane ${testRunId()}`);
  fd.set("pharmacistName", "Test Eczacı");
  fd.set("phone", "05551112233");
  fd.set("address", "Test Adres");
  fd.set("city", "İstanbul");
  fd.set("district", "Test İlçe");
  fd.set("regionId", overrides.regionId ?? "");
  fd.set("serviceAreaId", overrides.serviceAreaId ?? "");
  fd.set("mapUrl", "");
  fd.set("isActive", "on");
  return fd;
}

describe("Pharmacy create/update with serviceAreaId (real Postgres)", () => {
  const tracked = newTrackedIds();

  afterEach(async () => {
    setIntegrationTestSessionToken(undefined);
    await cleanupTrackedIds(tracked);
  });

  it("accepts a service area belonging to the exact region selected", async () => {
    const region = await createTestRegion(tracked);
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: region.organizationId });
    const token = await createTestSessionToken(admin.id);
    setIntegrationTestSessionToken(token);

    const serviceArea = await prisma.serviceArea.create({
      data: { name: `Üniversite Yakını ${testRunId()}`, regionId: region.id },
    });

    await expect(
      createPharmacyAction(
        { success: false, message: "" },
        pharmacyFormData({ regionId: region.id, serviceAreaId: serviceArea.id })
      )
    ).rejects.toThrow(IntegrationRedirectSignal);

    const created = await prisma.pharmacy.findFirst({ where: { regionId: region.id } });
    expect(created?.serviceAreaId).toBe(serviceArea.id);
    if (created) tracked.pharmacyIds.push(created.id);
  });

  it("stores no tag when serviceAreaId is left empty", async () => {
    const region = await createTestRegion(tracked);
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: region.organizationId });
    const token = await createTestSessionToken(admin.id);
    setIntegrationTestSessionToken(token);

    await expect(
      createPharmacyAction(
        { success: false, message: "" },
        pharmacyFormData({ regionId: region.id })
      )
    ).rejects.toThrow(IntegrationRedirectSignal);

    const created = await prisma.pharmacy.findFirst({ where: { regionId: region.id } });
    expect(created?.serviceAreaId).toBeNull();
    if (created) tracked.pharmacyIds.push(created.id);
  });

  it("rejects a service area from a different region even in the same organization", async () => {
    const regionA = await createTestRegion(tracked);
    const regionB = await createTestRegion(tracked, { organizationId: regionA.organizationId });
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: regionA.organizationId });
    const token = await createTestSessionToken(admin.id);
    setIntegrationTestSessionToken(token);

    const serviceAreaB = await prisma.serviceArea.create({
      data: { name: `B Alanı ${testRunId()}`, regionId: regionB.id },
    });

    const result = await createPharmacyAction(
      { success: false, message: "" },
      pharmacyFormData({ regionId: regionA.id, serviceAreaId: serviceAreaB.id })
    );
    expect(result.success).toBe(false);

    const created = await prisma.pharmacy.findFirst({ where: { regionId: regionA.id } });
    expect(created).toBeNull();
  });

  it("rejects a service area belonging to another organization on update", async () => {
    const regionA = await createTestRegion(tracked);
    const regionB = await createTestRegion(tracked);
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: regionA.organizationId });
    const token = await createTestSessionToken(admin.id);
    setIntegrationTestSessionToken(token);

    const pharmacy = await createTestPharmacy(tracked, regionA.id);
    const serviceAreaB = await prisma.serviceArea.create({
      data: { name: `Yabancı Alan ${testRunId()}`, regionId: regionB.id },
    });

    const result = await updatePharmacyAction(
      pharmacy.id,
      { success: false, message: "" },
      pharmacyFormData({ regionId: regionA.id, serviceAreaId: serviceAreaB.id })
    );
    expect(result.success).toBe(false);

    const stillUntagged = await prisma.pharmacy.findUnique({ where: { id: pharmacy.id } });
    expect(stillUntagged?.serviceAreaId).toBeNull();
  });

  it("updates a pharmacy to a valid same-region service area", async () => {
    const region = await createTestRegion(tracked);
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: region.organizationId });
    const token = await createTestSessionToken(admin.id);
    setIntegrationTestSessionToken(token);

    const pharmacy = await createTestPharmacy(tracked, region.id);
    const serviceArea = await prisma.serviceArea.create({
      data: { name: `Merkez ${testRunId()}`, regionId: region.id },
    });

    await expect(
      updatePharmacyAction(
        pharmacy.id,
        { success: false, message: "" },
        pharmacyFormData({ regionId: region.id, serviceAreaId: serviceArea.id })
      )
    ).rejects.toThrow(IntegrationRedirectSignal);

    const updated = await prisma.pharmacy.findUnique({ where: { id: pharmacy.id } });
    expect(updated?.serviceAreaId).toBe(serviceArea.id);
  });
});
