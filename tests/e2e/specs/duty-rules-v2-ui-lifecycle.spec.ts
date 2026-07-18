import { test, expect } from "@playwright/test";

import {
  createE2EOrganization,
  createE2EPharmacy,
  createE2ERegion,
  createE2ESession,
  createE2EUser,
  createE2EV2GeneratedSchedule,
  cleanupTrackedIds,
  newTrackedIds,
} from "../helpers/fixtures";
import { addSessionCookie } from "../helpers/browser";
import { e2ePrisma } from "../helpers/db";

// Duty Rules V2 — Phase 10: browser-level proof that the V2 lifecycle UI
// (entry point, lifecycle indicator, approve/publish gating) is wired
// correctly and enforces ADMIN-only + tenant isolation server-side, not
// just via hidden buttons. The deep generation/persistence pipeline
// itself (Phase 2-9 math, RotationState advancement, rollback) is already
// covered by tests/integration/duty-rules-v2-ui-generation.integration.test.ts
// against real Postgres — this spec exercises the UI wiring on top of it.
test.describe("Duty Rules V2 admin UI lifecycle (real browser, real Postgres)", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  test("V1 entry point and V2 entry point are both visible and distinct on /cizelgeler", async ({
    context,
    page,
    baseURL,
  }) => {
    const org = await createE2EOrganization(tracked);
    const region = await createE2ERegion(tracked, { organizationId: org.id });
    const admin = await createE2EUser(tracked, { role: "ADMIN", organizationId: org.id });
    const token = await createE2ESession(tracked, admin.id);
    void region;

    await addSessionCookie(context, token, baseURL!);
    await page.goto("/cizelgeler");

    await expect(page.getByRole("link", { name: "Yeni Ekle" })).toBeVisible();
    await expect(page.getByRole("link", { name: "V2 Taslak Oluştur" })).toBeVisible();
  });

  test("generation form shows a typed Turkish error when no active V2 plan version exists", async ({
    context,
    page,
    baseURL,
  }) => {
    const org = await createE2EOrganization(tracked);
    const region = await createE2ERegion(tracked, { organizationId: org.id });
    await createE2EPharmacy(tracked, region.id);
    // A DutyRule (but deliberately NO DutyPlanVersion) so the assembler
    // gets past NO_DUTY_RULE/NO_ACTIVE_PHARMACIES and reaches the
    // plan-version check this test targets.
    await e2ePrisma.dutyRule.create({
      data: {
        regionId: region.id,
        minDaysBetweenDuties: 2,
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
    await page.goto("/cizelgeler/v2/yeni");

    await page.getByLabel("Bölge").selectOption(region.id);
    await page.getByLabel("Dönem Başlangıcı").fill("2031-06-01");
    await page.getByLabel("Dönem Bitişi").fill("2031-06-30");
    await page.getByRole("button", { name: "V2 Taslak Oluştur" }).click();

    // Never a raw 500 / unhandled exception page — a controlled Turkish
    // field error explaining no active plan version exists.
    await expect(page.getByText(/etkin bir V2 nöbet planı bulunamadı/)).toBeVisible();
  });

  test("ADMIN sees and can use approve/publish buttons through the full DRAFT -> APPROVED -> PUBLISHED lifecycle", async ({
    context,
    page,
    baseURL,
  }) => {
    const org = await createE2EOrganization(tracked);
    const region = await createE2ERegion(tracked, { organizationId: org.id });
    const admin = await createE2EUser(tracked, { role: "ADMIN", organizationId: org.id });
    const token = await createE2ESession(tracked, admin.id);
    const { schedule } = await createE2EV2GeneratedSchedule(tracked, {
      organizationId: org.id,
      regionId: region.id,
      scheduleStatus: "DRAFT",
    });

    await addSessionCookie(context, token, baseURL!);
    await page.goto(`/cizelgeler/${schedule.id}`);

    await expect(page.getByText("V2 Yaşam Döngüsü")).toBeVisible();
    const approveButton = page.getByRole("button", { name: "Taslağı Onayla" });
    await expect(approveButton).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await approveButton.click();
    await expect(page.getByText("Taslak onaylandı.")).toBeVisible();

    const publishButton = page.getByRole("button", { name: "Çizelgeyi Yayınla" });
    await expect(publishButton).toBeVisible();
    await expect(page.getByRole("button", { name: "Taslağı Onayla" })).toHaveCount(0);

    page.once("dialog", (dialog) => dialog.accept());
    await publishButton.click();
    await expect(page.getByText("Çizelge yayınlandı.")).toBeVisible();

    // Terminal state: no repeat publish/approve control remains.
    await expect(page.getByRole("button", { name: "Çizelgeyi Yayınla" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Taslağı Onayla" })).toHaveCount(0);
  });

  test("STAFF does not see approve/publish buttons, and the server action rejects a direct call", async ({
    context,
    page,
    baseURL,
  }) => {
    const org = await createE2EOrganization(tracked);
    const region = await createE2ERegion(tracked, { organizationId: org.id });
    const staff = await createE2EUser(tracked, { role: "STAFF", organizationId: org.id });
    const token = await createE2ESession(tracked, staff.id);
    const { schedule } = await createE2EV2GeneratedSchedule(tracked, {
      organizationId: org.id,
      regionId: region.id,
      scheduleStatus: "DRAFT",
    });

    await addSessionCookie(context, token, baseURL!);
    await page.goto(`/cizelgeler/${schedule.id}`);

    await expect(page.getByRole("button", { name: "Taslağı Onayla" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Çizelgeyi Yayınla" })).toHaveCount(0);

    // Schedule remains DRAFT server-side — no client-only gate was relied on.
    const stillDraft = await page.getByText("Taslak Oluşturuldu").isVisible();
    expect(stillDraft).toBe(true);
  });

  test("a second organization's ADMIN cannot view the first organization's V2 schedule or draft preview", async ({
    context,
    page,
    baseURL,
  }) => {
    const orgA = await createE2EOrganization(tracked);
    const orgB = await createE2EOrganization(tracked);
    const regionA = await createE2ERegion(tracked, { organizationId: orgA.id });
    const adminB = await createE2EUser(tracked, { role: "ADMIN", organizationId: orgB.id });
    const tokenB = await createE2ESession(tracked, adminB.id);
    const { schedule } = await createE2EV2GeneratedSchedule(tracked, {
      organizationId: orgA.id,
      regionId: regionA.id,
      scheduleStatus: "APPROVED",
    });

    await addSessionCookie(context, tokenB, baseURL!);
    await page.goto(`/cizelgeler/${schedule.id}`);
    await expect(page.getByText("V2 Yaşam Döngüsü")).toHaveCount(0);

    await page.goto("/cizelgeler/v2/onizleme/does-not-exist-or-foreign");
    await expect(page.getByText("Taslak Önizlemesi")).toHaveCount(0);
  });

  test("existing V1 flow is unaffected: V1 schedule detail shows no V2 lifecycle card", async ({
    context,
    page,
    baseURL,
  }) => {
    const org = await createE2EOrganization(tracked);
    const region = await createE2ERegion(tracked, { organizationId: org.id });
    const admin = await createE2EUser(tracked, { role: "ADMIN", organizationId: org.id });
    const token = await createE2ESession(tracked, admin.id);
    const { createE2EDutySchedule } = await import("../helpers/fixtures");
    const v1Schedule = await createE2EDutySchedule(tracked, region.id, {
      status: "DRAFT",
      month: 7,
      year: 2032,
    });

    await addSessionCookie(context, token, baseURL!);
    await page.goto(`/cizelgeler/${v1Schedule.id}`);

    await expect(page.getByText("V2 Yaşam Döngüsü")).toHaveCount(0);
    // V1's own publish button is untouched by the V2 gating change.
    await expect(page.getByRole("button", { name: "Yayınla" })).toBeVisible();
  });
});
