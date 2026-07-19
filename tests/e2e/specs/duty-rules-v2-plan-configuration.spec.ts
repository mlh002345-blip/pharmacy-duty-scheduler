import { test, expect } from "@playwright/test";

import {
  createE2EOrganization,
  createE2EPharmacy,
  createE2ERegion,
  createE2ESession,
  createE2EUser,
  cleanupTrackedIds,
  newTrackedIds,
} from "../helpers/fixtures";
import { addSessionCookie } from "../helpers/browser";
import { e2ePrisma } from "../helpers/db";

// Duty Rules V2 — Phase 11: browser-level proof that the plan
// configuration UI (day types, shifts, slots, rotation pools,
// membership, activation) genuinely connects to Phase 10's existing
// generation UI. The deep configuration-service logic itself is already
// covered by
// tests/integration/duty-rules-v2-plan-configuration.integration.test.ts
// against real Postgres — this spec exercises the UI wiring on top of it.
test.describe("Duty Rules V2 plan configuration UI (real browser, real Postgres)", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  test("ADMIN configures a region end-to-end, activates it, then generates a real V2 draft from it", async ({
    context,
    page,
    baseURL,
  }) => {
    test.setTimeout(60_000);
    const org = await createE2EOrganization(tracked);
    const region = await createE2ERegion(tracked, { organizationId: org.id });
    const pharmacyA = await createE2EPharmacy(tracked, region.id, { name: "E2E Eczane A" });
    const pharmacyB = await createE2EPharmacy(tracked, region.id, { name: "E2E Eczane B" });
    await e2ePrisma.dutyRule.create({
      data: {
        regionId: region.id,
        minDaysBetweenDuties: 0,
        weekdayWeight: 1,
        saturdayWeight: 1.25,
        sundayWeight: 1.5,
        officialHolidayWeight: 2,
        religiousHolidayWeight: 2,
      },
    });
    const admin = await createE2EUser(tracked, { role: "ADMIN", organizationId: org.id });
    const token = await createE2ESession(tracked, admin.id);

    await addSessionCookie(context, token, baseURL!);

    // Create the plan.
    await page.goto("/cizelgeler/v2/planlar/yeni");
    await page.getByLabel("Bölge").selectOption(region.id);
    await page.getByLabel("Plan Adı").fill("E2E Test Planı");
    await page.getByRole("button", { name: "Plan Oluştur" }).click();

    await expect(page.getByText(/E2E Test Planı — Sürüm 1/)).toBeVisible();

    // Track the plan/version this UI flow created so cleanup can delete
    // it (in FK-safe order) before the region itself is deleted below.
    const createdPlan = await e2ePrisma.dutyPlan.findFirstOrThrow({
      where: { organizationId: org.id, regionId: region.id },
    });
    tracked.dutyPlanIds.push(createdPlan.id);
    const createdVersion = await e2ePrisma.dutyPlanVersion.findFirstOrThrow({
      where: { planId: createdPlan.id },
    });
    tracked.dutyPlanVersionIds.push(createdVersion.id);

    // Blocking issues visible before any configuration.
    await expect(page.getByText("Engelleyici Sorunlar", { exact: true })).toBeVisible();
    const activateButton = page.getByRole("button", { name: "Sürümü Etkinleştir" });
    await expect(activateButton).toBeDisabled();

    // Gün Tipleri: enable Saturday only.
    // Duty Rules V2 — Phase 12 added a "Politika" section below with a
    // "Bayram Arifesi Ağırlık Kaynağı" select, whose accessible name now
    // contains "Bayram Arifesi" as a substring — exact matching keeps
    // this loop scoped to the day-type checkboxes only.
    for (const label of ["Hafta İçi", "Pazar", "Resmi Bayram", "Dini Bayram", "Bayram Arifesi"]) {
      const checkbox = page.getByLabel(label, { exact: true });
      if (await checkbox.isChecked()) {
        await checkbox.uncheck();
      }
    }
    await page.getByLabel("Cumartesi", { exact: true }).check();
    // A server action bound to revalidatePath triggers a fresh RSC
    // render that can race with (and clear) the client component's own
    // transient success flash — waiting for the flash to appear first
    // proves the mutation has actually completed server-side before the
    // page is reloaded to assert on persisted state, which is more
    // robust than asserting on the flash text alone.
    await page.getByRole("button", { name: "Gün Tiplerini Kaydet" }).click();
    await expect(page.getByText("Gün tipleri güncellendi.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Cumartesi")).toBeChecked();

    // Vardiyalar: add the daily shift.
    await page.getByRole("button", { name: "Günlük Nöbet Ekle (00:00–23:59)" }).click();
    await page.getByRole("button", { name: "Vardiyaları Kaydet" }).click();
    await expect(page.getByText("Vardiyalar güncellendi.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("cell", { name: "Günlük Nöbet" })).toBeVisible();

    // Rotasyon Havuzları: create a pool and add both pharmacies.
    await page.getByLabel("Ad").fill("E2E Rotasyon Havuzu");
    await page.getByRole("button", { name: "Havuz Oluştur" }).click();
    await expect(page.getByText("Rotasyon havuzu oluşturuldu.")).toBeVisible();
    await page.reload();
    await expect(page.getByText("E2E Rotasyon Havuzu")).toBeVisible();

    await page.getByLabel("Eczane", { exact: true }).selectOption({ label: pharmacyA.name });
    await page.getByLabel("Katılım Tarihi", { exact: true }).fill("2026-01-01");
    await page.getByRole("button", { name: "Eczane Ekle" }).click();
    await expect(page.getByText("Eczane havuza eklendi.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("cell", { name: pharmacyA.name })).toBeVisible();

    await page.getByLabel("Eczane", { exact: true }).selectOption({ label: pharmacyB.name });
    await page.getByLabel("Katılım Tarihi", { exact: true }).fill("2026-01-01");
    await page.getByRole("button", { name: "Eczane Ekle" }).click();
    await expect(page.getByText("Eczane havuza eklendi.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("cell", { name: pharmacyB.name })).toBeVisible();

    // Slot Gereksinimleri: add a slot for Saturday -> the new shift/pool.
    // The slot table is the only table with a "Gereken Sayı" column —
    // scope selectors to it so other tables on the page (shifts, pool
    // memberships) can never collide.
    const slotTable = page.locator("table").filter({ hasText: "Gereken Sayı" });
    await page.getByRole("button", { name: "Slot Ekle" }).click();
    // The newly added row defaults its Gün Tipi select to whichever day
    // type rule sorts first from the database (not necessarily Saturday)
    // and its pool select to "Varsayılan" — both must be set explicitly
    // (columns: Gün Tipi, Vardiya, Havuz).
    await slotTable.getByRole("combobox").nth(0).selectOption({ label: "Cumartesi" });
    await slotTable.getByRole("combobox").nth(2).selectOption({ label: "E2E Rotasyon Havuzu" });
    await page.getByRole("button", { name: "Slot Gereksinimlerini Kaydet" }).click();
    await expect(page.getByText("Slot gereksinimleri güncellendi.")).toBeVisible();

    // Blocking issues should now be gone; activation enabled.
    await page.reload();
    await expect(page.getByText("Engelleyici Sorunlar", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sürümü Etkinleştir" })).toBeEnabled();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Sürümü Etkinleştir" }).click();
    await expect(page.getByText("Sürüm etkinleştirildi.")).toBeVisible();

    // Read-only now.
    await expect(page.getByText(/düzenlenemez/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Gün Tiplerini Kaydet" })).toHaveCount(0);

    // Phase 10 connection: generate a real draft against this region.
    await page.goto("/cizelgeler/v2/yeni");
    await page.getByLabel("Bölge").selectOption(region.id);
    await page.getByLabel("Dönem Başlangıcı").fill("2026-08-01");
    await page.getByLabel("Dönem Bitişi").fill("2026-08-08");
    await page.getByRole("button", { name: "V2 Taslak Oluştur" }).click();

    await expect(page).toHaveURL(/\/cizelgeler\/v2\/onizleme\//);

    // Cleanup, in FK-safe order: the plan/version must go FIRST (its
    // SlotRequirement rows hold a Restrict FK to RotationPool), THEN the
    // pool (which has no dedicated slot in the shared e2e TrackedIds type
    // — Phase 10's fixture helper predates Phase 11 — and its own
    // regionId FK is onDelete: Restrict, so it must be deleted before the
    // region itself is cleaned up in afterAll).
    await e2ePrisma.auditLog.deleteMany({ where: { entity: "DutyPlanVersion", entityId: createdVersion.id } });
    await e2ePrisma.auditLog.deleteMany({ where: { entity: "DutyPlan", entityId: createdPlan.id } });
    await e2ePrisma.dutyPlanVersion.deleteMany({ where: { id: createdVersion.id } });
    await e2ePrisma.dutyPlan.deleteMany({ where: { id: createdPlan.id } });

    const createdPools = await e2ePrisma.rotationPool.findMany({ where: { regionId: region.id } });
    const createdPoolIds = createdPools.map((p) => p.id);
    if (createdPoolIds.length > 0) {
      await e2ePrisma.auditLog.deleteMany({ where: { entity: "RotationPool", entityId: { in: createdPoolIds } } });
      await e2ePrisma.rotationPoolMembership.deleteMany({ where: { poolId: { in: createdPoolIds } } });
      await e2ePrisma.rotationPool.deleteMany({ where: { id: { in: createdPoolIds } } });
    }
  });

  test("STAFF can edit configuration but does not see the activate button", async ({
    context,
    page,
    baseURL,
  }) => {
    const org = await createE2EOrganization(tracked);
    const region = await createE2ERegion(tracked, { organizationId: org.id });
    const staff = await createE2EUser(tracked, { role: "STAFF", organizationId: org.id });
    const token = await createE2ESession(tracked, staff.id);

    const plan = await e2ePrisma.dutyPlan.create({
      data: { name: "STAFF Test Planı", organizationId: org.id, regionId: region.id },
    });
    tracked.dutyPlanIds.push(plan.id);
    const version = await e2ePrisma.dutyPlanVersion.create({
      data: { planId: plan.id, versionNumber: 1, status: "DRAFT", validFrom: new Date("2026-08-01") },
    });
    tracked.dutyPlanVersionIds.push(version.id);

    await addSessionCookie(context, token, baseURL!);
    await page.goto(`/cizelgeler/v2/planlar/${plan.id}/versions/${version.id}`);

    await expect(page.getByRole("button", { name: "Gün Tiplerini Kaydet" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sürümü Etkinleştir" })).toHaveCount(0);
    await expect(page.getByText("Sürümü etkinleştirmek için yönetici yetkisi gereklidir.")).toBeVisible();
  });

  test("a second organization's ADMIN cannot view the first organization's plan version", async ({
    context,
    page,
    baseURL,
  }) => {
    const orgA = await createE2EOrganization(tracked);
    const orgB = await createE2EOrganization(tracked);
    const regionA = await createE2ERegion(tracked, { organizationId: orgA.id });
    const adminB = await createE2EUser(tracked, { role: "ADMIN", organizationId: orgB.id });
    const tokenB = await createE2ESession(tracked, adminB.id);

    const plan = await e2ePrisma.dutyPlan.create({
      data: { name: "Org A Planı", organizationId: orgA.id, regionId: regionA.id },
    });
    tracked.dutyPlanIds.push(plan.id);
    const version = await e2ePrisma.dutyPlanVersion.create({
      data: { planId: plan.id, versionNumber: 1, status: "DRAFT", validFrom: new Date("2026-08-01") },
    });
    tracked.dutyPlanVersionIds.push(version.id);

    await addSessionCookie(context, tokenB, baseURL!);
    const response = await page.goto(`/cizelgeler/v2/planlar/${plan.id}/versions/${version.id}`);
    expect(response?.status()).toBe(404);
  });

  test("once ACTIVE, the editor shows read-only state with no edit forms", async ({
    context,
    page,
    baseURL,
  }) => {
    const org = await createE2EOrganization(tracked);
    const region = await createE2ERegion(tracked, { organizationId: org.id });
    const admin = await createE2EUser(tracked, { role: "ADMIN", organizationId: org.id });
    const token = await createE2ESession(tracked, admin.id);

    const plan = await e2ePrisma.dutyPlan.create({
      data: { name: "Aktif Plan", organizationId: org.id, regionId: region.id },
    });
    tracked.dutyPlanIds.push(plan.id);
    const version = await e2ePrisma.dutyPlanVersion.create({
      data: {
        planId: plan.id,
        versionNumber: 1,
        status: "ACTIVE",
        validFrom: new Date("2026-08-01"),
        activatedAt: new Date(),
      },
    });
    tracked.dutyPlanVersionIds.push(version.id);

    await addSessionCookie(context, token, baseURL!);
    await page.goto(`/cizelgeler/v2/planlar/${plan.id}/versions/${version.id}`);

    await expect(page.getByText(/düzenlenemez/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Gün Tiplerini Kaydet" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Vardiyaları Kaydet" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Slot Gereksinimlerini Kaydet" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sil" })).toHaveCount(0);
  });

  test("ADMIN deletes a DRAFT plan version from the version editor page, deleting the now-empty plan too", async ({
    context,
    page,
    baseURL,
  }) => {
    const org = await createE2EOrganization(tracked);
    const region = await createE2ERegion(tracked, { organizationId: org.id });
    const admin = await createE2EUser(tracked, { role: "ADMIN", organizationId: org.id });
    const token = await createE2ESession(tracked, admin.id);

    const plan = await e2ePrisma.dutyPlan.create({
      data: { name: "Silinecek Taslak Plan", organizationId: org.id, regionId: region.id },
    });
    const version = await e2ePrisma.dutyPlanVersion.create({
      data: { planId: plan.id, versionNumber: 1, status: "DRAFT", validFrom: new Date("2026-08-01") },
    });

    await addSessionCookie(context, token, baseURL!);
    await page.goto(`/cizelgeler/v2/planlar/${plan.id}/versions/${version.id}`);

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Sil" }).click();

    await expect(page).toHaveURL(/\/cizelgeler\/v2\/planlar(\?|$)/);
    await expect(page.getByText("Plan sürümü ve boş kalan plan silindi.")).toBeVisible();

    const deletedVersion = await e2ePrisma.dutyPlanVersion.findUnique({ where: { id: version.id } });
    expect(deletedVersion).toBeNull();
    const deletedPlan = await e2ePrisma.dutyPlan.findUnique({ where: { id: plan.id } });
    expect(deletedPlan).toBeNull();
  });

  test("ADMIN deletes a DRAFT plan version directly from the plan list page", async ({
    context,
    page,
    baseURL,
  }) => {
    const org = await createE2EOrganization(tracked);
    const region = await createE2ERegion(tracked, { organizationId: org.id });
    const admin = await createE2EUser(tracked, { role: "ADMIN", organizationId: org.id });
    const token = await createE2ESession(tracked, admin.id);

    const plan = await e2ePrisma.dutyPlan.create({
      data: { name: "Liste Sayfasından Silinecek Plan", organizationId: org.id, regionId: region.id },
    });
    const version = await e2ePrisma.dutyPlanVersion.create({
      data: { planId: plan.id, versionNumber: 1, status: "DRAFT", validFrom: new Date("2026-08-01") },
    });

    await addSessionCookie(context, token, baseURL!);
    await page.goto("/cizelgeler/v2/planlar");
    await expect(page.getByText("Liste Sayfasından Silinecek Plan")).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Sil" }).click();

    await expect(page.getByText("Plan sürümü ve boş kalan plan silindi.")).toBeVisible();
    await expect(page.getByText("Liste Sayfasından Silinecek Plan")).toHaveCount(0);

    const deletedVersion = await e2ePrisma.dutyPlanVersion.findUnique({ where: { id: version.id } });
    expect(deletedVersion).toBeNull();
  });
});
