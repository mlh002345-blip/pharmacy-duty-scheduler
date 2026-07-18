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

// Duty Rules V2 — Phase 12: browser-level proof that a brand-new region
// with NO DutyRule at all can be fully configured (day types + weights +
// policy + shifts + slots + pool + memberships) purely through the UI
// and generate a real V2 draft — the full-stack proof of this phase's
// premise. Mirrors duty-rules-v2-plan-configuration.spec.ts's structure
// and fixture usage.
test.describe("Duty Rules V2 policy configuration UI (real browser, real Postgres)", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  test("brand-new region with no DutyRule: ADMIN configures day types, weights, policy, shifts, slots and pool, activates, and generates a real draft", async ({
    context,
    page,
    baseURL,
  }) => {
    test.setTimeout(60_000);
    const org = await createE2EOrganization(tracked);
    const region = await createE2ERegion(tracked, { organizationId: org.id });
    const pharmacyA = await createE2EPharmacy(tracked, region.id, { name: "Phase12 Eczane A" });
    const pharmacyB = await createE2EPharmacy(tracked, region.id, { name: "Phase12 Eczane B" });
    // Deliberately no DutyRule created anywhere for this region — the
    // whole point of this phase.
    const admin = await createE2EUser(tracked, { role: "ADMIN", organizationId: org.id });
    const token = await createE2ESession(tracked, admin.id);

    await addSessionCookie(context, token, baseURL!);

    // Create the plan.
    await page.goto("/cizelgeler/v2/planlar/yeni");
    await page.getByLabel("Bölge").selectOption(region.id);
    await page.getByLabel("Plan Adı").fill("Phase12 Test Planı");
    await page.getByRole("button", { name: "Plan Oluştur" }).click();

    await expect(page.getByText(/Phase12 Test Planı — Sürüm 1/)).toBeVisible();

    const createdPlan = await e2ePrisma.dutyPlan.findFirstOrThrow({
      where: { organizationId: org.id, regionId: region.id },
    });
    tracked.dutyPlanIds.push(createdPlan.id);
    const createdVersion = await e2ePrisma.dutyPlanVersion.findFirstOrThrow({
      where: { planId: createdPlan.id },
    });
    tracked.dutyPlanVersionIds.push(createdVersion.id);

    // Mode badge starts as V1 compatibility (no native policy yet).
    await expect(page.getByText("V1 Uyumluluk Modu", { exact: true })).toBeVisible();

    // Gün Tipleri + Ağırlık: enable Saturday only, with a weight.
    for (const label of ["Hafta İçi", "Pazar", "Resmi Bayram", "Dini Bayram", "Bayram Arifesi"]) {
      const checkbox = page.getByLabel(label, { exact: true });
      if (await checkbox.isChecked()) {
        await checkbox.uncheck();
      }
    }
    await page.getByLabel("Cumartesi", { exact: true }).check();
    const saturdayRow = page.getByTestId("day-type-row-SATURDAY");
    await saturdayRow.locator('input[type="number"]').fill("1.25");
    await page.getByRole("button", { name: "Gün Tiplerini Kaydet" }).click();
    await expect(page.getByText("Gün tipleri güncellendi.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Cumartesi")).toBeChecked();
    await expect(page.getByTestId("day-type-row-SATURDAY").locator('input[type="number"]')).toHaveValue(
      "1.25"
    );

    // Politika: configure native policy.
    await page.getByLabel("Asgari Nöbet Aralığı (gün)").fill("0");
    await page.getByRole("button", { name: "Politikayı Kaydet" }).click();
    await expect(page.getByText("Nöbet politikası güncellendi.")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Yerel V2 Politikası", { exact: true })).toBeVisible();

    // Vardiyalar: add the daily shift.
    await page.getByRole("button", { name: "Günlük Nöbet Ekle (00:00–23:59)" }).click();
    await page.getByRole("button", { name: "Vardiyaları Kaydet" }).click();
    await expect(page.getByText("Vardiyalar güncellendi.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("cell", { name: "Günlük Nöbet" })).toBeVisible();

    // Rotasyon Havuzları: create a pool and add both pharmacies.
    await page.getByLabel("Ad").fill("Phase12 Rotasyon Havuzu");
    await page.getByRole("button", { name: "Havuz Oluştur" }).click();
    await expect(page.getByText("Rotasyon havuzu oluşturuldu.")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Phase12 Rotasyon Havuzu")).toBeVisible();

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
    const slotTable = page.locator("table").filter({ hasText: "Gereken Sayı" });
    await page.getByRole("button", { name: "Slot Ekle" }).click();
    await slotTable.getByRole("combobox").nth(0).selectOption({ label: "Cumartesi" });
    await slotTable.getByRole("combobox").nth(2).selectOption({ label: "Phase12 Rotasyon Havuzu" });
    await page.getByRole("button", { name: "Slot Gereksinimlerini Kaydet" }).click();
    await expect(page.getByText("Slot gereksinimleri güncellendi.")).toBeVisible();

    // Activate.
    await page.reload();
    await expect(page.getByText("Engelleyici Sorunlar", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sürümü Etkinleştir" })).toBeEnabled();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Sürümü Etkinleştir" }).click();
    await expect(page.getByText("Sürüm etkinleştirildi.")).toBeVisible();

    // Confirm this region genuinely has zero DutyRule rows.
    const dutyRuleCount = await e2ePrisma.dutyRule.count({ where: { regionId: region.id } });
    expect(dutyRuleCount).toBe(0);

    // Generate a real V2 draft — native policy mode, no DutyRule needed.
    await page.goto("/cizelgeler/v2/yeni");
    await page.getByLabel("Bölge").selectOption(region.id);
    await page.getByLabel("Dönem Başlangıcı").fill("2026-08-01");
    await page.getByLabel("Dönem Bitişi").fill("2026-08-08");
    await page.getByRole("button", { name: "V2 Taslak Oluştur" }).click();

    await expect(page).toHaveURL(/\/cizelgeler\/v2\/onizleme\//);

    // Cleanup, in FK-safe order (see plan-configuration spec's comment
    // for the exact reasoning — SlotRequirement's Restrict FK to
    // RotationPool means plan/version must be deleted before the pool).
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

  test("generation before policy is configured shows a clear Turkish typed error, never a raw crash", async ({
    context,
    page,
    baseURL,
  }) => {
    const org = await createE2EOrganization(tracked);
    const region = await createE2ERegion(tracked, { organizationId: org.id });
    await createE2EPharmacy(tracked, region.id, { name: "Phase12 Eczane C" });
    // No DutyRule at all, and the version below is left with
    // minDaysBetweenDuties: null (never calling the policy action) — so
    // neither mode can produce a draft.
    const admin = await createE2EUser(tracked, { role: "ADMIN", organizationId: org.id });
    const token = await createE2ESession(tracked, admin.id);

    const plan = await e2ePrisma.dutyPlan.create({
      data: { name: "Unconfigured Policy Plan", organizationId: org.id, regionId: region.id },
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
    await page.goto("/cizelgeler/v2/yeni");
    await page.getByLabel("Bölge").selectOption(region.id);
    await page.getByLabel("Dönem Başlangıcı").fill("2026-08-01");
    await page.getByLabel("Dönem Bitişi").fill("2026-08-08");
    await page.getByRole("button", { name: "V2 Taslak Oluştur" }).click();

    // Still on the generation form — no crash, no navigation to a
    // preview — with a Turkish error message visible.
    await expect(page).toHaveURL(/\/cizelgeler\/v2\/yeni/);
    await expect(page.getByText("Bu bölge için tanımlı bir nöbet kuralı bulunamadı.")).toBeVisible();
  });

  test("existing V1-compat-style region (has a DutyRule, policy left unconfigured) still generates successfully — regression smoke check", async ({
    context,
    page,
    baseURL,
  }) => {
    test.setTimeout(60_000);
    const org = await createE2EOrganization(tracked);
    const region = await createE2ERegion(tracked, { organizationId: org.id });
    await createE2EPharmacy(tracked, region.id, { name: "Phase12 Regression Eczane" });
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

    const plan = await e2ePrisma.dutyPlan.create({
      data: { name: "Regression Smoke Plan", organizationId: org.id, regionId: region.id },
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
    // Serve every day type (like Phase 10/11 fixtures), all through one
    // shift/pool, so V1-compatibility generation has a full week to work
    // with — mirrors the pre-Phase-12 shape exactly (minDaysBetweenDuties
    // left untouched -> null).
    const dayTypes = [
      "WEEKDAY",
      "SATURDAY",
      "SUNDAY",
      "OFFICIAL_HOLIDAY",
      "RELIGIOUS_HOLIDAY",
      "HOLIDAY_EVE",
    ] as const;
    const dayTypeRules = await Promise.all(
      dayTypes.map((dayType) =>
        e2ePrisma.dayTypeRule.create({ data: { planVersionId: version.id, dayType, isServed: true } })
      )
    );
    const shift = await e2ePrisma.shiftDefinition.create({
      data: {
        planVersionId: version.id,
        name: "Günlük Nöbet",
        startMinute: 0,
        endMinute: 1439,
        spansMidnight: false,
        defaultWeight: 1,
        sortOrder: 0,
      },
    });
    const pool = await e2ePrisma.rotationPool.create({
      data: { organizationId: org.id, regionId: region.id, name: "Regression Havuzu", strategy: "SEQUENTIAL" },
    });
    const pharmacy = await e2ePrisma.pharmacy.findFirstOrThrow({ where: { regionId: region.id } });
    await e2ePrisma.rotationPoolMembership.create({
      data: { poolId: pool.id, pharmacyId: pharmacy.id, joinedAt: new Date("2026-01-01") },
    });
    await e2ePrisma.rotationState.create({
      data: { poolId: pool.id, dayTypeScope: "ALL", currentRound: 0, lockVersion: 0 },
    });
    await Promise.all(
      dayTypeRules.map((rule, i) =>
        e2ePrisma.slotRequirement.create({
          data: {
            dayTypeRuleId: rule.id,
            shiftDefinitionId: shift.id,
            rotationPoolId: pool.id,
            requiredCount: 1,
            sortOrder: i,
          },
        })
      )
    );

    await addSessionCookie(context, token, baseURL!);
    await page.goto("/cizelgeler/v2/yeni");
    await page.getByLabel("Bölge").selectOption(region.id);
    await page.getByLabel("Dönem Başlangıcı").fill("2026-08-01");
    await page.getByLabel("Dönem Bitişi").fill("2026-08-08");
    await page.getByRole("button", { name: "V2 Taslak Oluştur" }).click();

    await expect(page).toHaveURL(/\/cizelgeler\/v2\/onizleme\//);

    // Cleanup, in FK-safe order: SlotRequirement.rotationPoolId is
    // onDelete: Restrict, so the plan/version (whose DayTypeRule rows
    // cascade-delete their SlotRequirement children) must go BEFORE the
    // pool — deleted explicitly here rather than deferred to afterAll's
    // cleanupTrackedIds, since that would run in the wrong order.
    await e2ePrisma.auditLog.deleteMany({ where: { entity: "DutyPlanVersion", entityId: version.id } });
    await e2ePrisma.auditLog.deleteMany({ where: { entity: "DutyPlan", entityId: plan.id } });
    await e2ePrisma.dutyPlanVersion.deleteMany({ where: { id: version.id } });
    await e2ePrisma.dutyPlan.deleteMany({ where: { id: plan.id } });
    tracked.dutyPlanVersionIds = tracked.dutyPlanVersionIds.filter((id) => id !== version.id);
    tracked.dutyPlanIds = tracked.dutyPlanIds.filter((id) => id !== plan.id);

    await e2ePrisma.auditLog.deleteMany({ where: { entity: "RotationPool", entityId: pool.id } });
    await e2ePrisma.rotationPoolMembership.deleteMany({ where: { poolId: pool.id } });
    await e2ePrisma.rotationPool.deleteMany({ where: { id: pool.id } });
  });
});
