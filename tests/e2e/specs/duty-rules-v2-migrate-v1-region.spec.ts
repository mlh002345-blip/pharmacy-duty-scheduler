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

// Duty Rules V2 — Phase 15: browser-level proof that the "V1'den Taşı"
// one-click migration button genuinely creates and activates a usable V2
// plan version, and that a real V2 draft can be generated from it
// immediately afterward. The migrateV1RegionToV2 service itself is
// already covered against real Postgres by
// tests/integration/duty-rules-v2-migrate-v1-region.integration.test.ts —
// this spec exercises the UI wiring on top of it.
test.describe("Duty Rules V2 — V1'den Taşı migration UI (real browser, real Postgres)", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  test("ADMIN migrates a real V1 region to V2 with one click, then generates a real draft from it", async ({
    context,
    page,
    baseURL,
  }) => {
    test.setTimeout(60_000);
    const org = await createE2EOrganization(tracked);
    const region = await createE2ERegion(tracked, { organizationId: org.id });
    await createE2EPharmacy(tracked, region.id, { name: "E2E Taşınan Eczane A" });
    await createE2EPharmacy(tracked, region.id, { name: "E2E Taşınan Eczane B" });
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

    await page.goto("/cizelgeler/v2/planlar/v1-tasi");
    await expect(page.getByText(region.name, { exact: true })).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "V2'ye Taşı" }).click();

    await expect(page).toHaveURL(/\/cizelgeler\/v2\/planlar\/.+\/versions\/.+/);
    await expect(page.getByText(/taşındı ve etkinleştirildi/)).toBeVisible();
    await expect(page.getByText(/düzenlenemez/)).toBeVisible();

    const createdPlan = await e2ePrisma.dutyPlan.findFirstOrThrow({
      where: { organizationId: org.id, regionId: region.id },
    });
    tracked.dutyPlanIds.push(createdPlan.id);
    const createdVersion = await e2ePrisma.dutyPlanVersion.findFirstOrThrow({
      where: { planId: createdPlan.id },
    });
    tracked.dutyPlanVersionIds.push(createdVersion.id);
    expect(createdVersion.status).toBe("ACTIVE");

    // Already-migrated: the region no longer appears on the migration
    // list page.
    await page.goto("/cizelgeler/v2/planlar/v1-tasi");
    await expect(page.getByText("Taşınacak bir bölge bulunamadı.")).toBeVisible();

    // Phase 10 connection: generate a real draft against the migrated region.
    await page.goto("/cizelgeler/v2/yeni");
    await page.getByLabel("Bölge").selectOption(region.id);
    // Bir sonraki ay — üretim ufku sınırının (bkz.
    // src/lib/scheduling/generation-horizon.ts) içinde kalır.
    await page.getByLabel("Dönem Başlangıcı").fill("2026-08-01");
    await page.getByLabel("Dönem Bitişi").fill("2026-08-08");
    await page.getByRole("button", { name: "V2 Taslak Oluştur" }).click();

    await expect(page).toHaveURL(/\/cizelgeler\/v2\/onizleme\//);

    // Cleanup, in FK-safe order — mirrors
    // duty-rules-v2-plan-configuration.spec.ts's own cleanup: the plan/
    // version must go first (SlotRequirement holds a Restrict FK to
    // RotationPool), then the pool this migration created (not tracked by
    // the shared TrackedIds helper).
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

  test("region with no V1 DutyRule never appears on the migration list", async ({ context, page, baseURL }) => {
    const org = await createE2EOrganization(tracked);
    const region = await createE2ERegion(tracked, { organizationId: org.id });
    const admin = await createE2EUser(tracked, { role: "ADMIN", organizationId: org.id });
    const token = await createE2ESession(tracked, admin.id);

    await addSessionCookie(context, token, baseURL!);
    await page.goto("/cizelgeler/v2/planlar/v1-tasi");

    await expect(page.getByText(region.name, { exact: true })).toHaveCount(0);
    await expect(page.getByText("Taşınacak bir bölge bulunamadı.")).toBeVisible();
  });

  test("STAFF cannot migrate a region: server action rejects a direct call", async ({ context, page, baseURL }) => {
    const org = await createE2EOrganization(tracked);
    const region = await createE2ERegion(tracked, { organizationId: org.id });
    await createE2EPharmacy(tracked, region.id);
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
    const staff = await createE2EUser(tracked, { role: "STAFF", organizationId: org.id });
    const token = await createE2ESession(tracked, staff.id);

    await addSessionCookie(context, token, baseURL!);
    await page.goto("/cizelgeler/v2/planlar/v1-tasi");

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "V2'ye Taşı" }).click();

    await expect(page).toHaveURL(/\/cizelgeler\/v2\/planlar\/v1-tasi\?error=/);
    const planCount = await e2ePrisma.dutyPlan.count({ where: { regionId: region.id } });
    expect(planCount).toBe(0);
  });
});
