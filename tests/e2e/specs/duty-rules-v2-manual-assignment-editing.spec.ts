import { test, expect } from "@playwright/test";

import {
  createE2EOrganization,
  createE2ERegion,
  createE2EPharmacy,
  createE2ESession,
  createE2EUser,
  createE2EDutySchedule,
  cleanupTrackedIds,
  newTrackedIds,
} from "../helpers/fixtures";
import { addSessionCookie } from "../helpers/browser";
import { e2ePrisma } from "../helpers/db";

// Duty Rules V2 — Phase 13: browser-level proof that a V2-generated
// assignment can be manually corrected from the UI, that the edit is
// routed through the V2-aware edit page (not V1's, which would corrupt
// membershipId), and that V1's own edit flow is completely unaffected by
// the routing change in cizelgeler/[id]/page.tsx. Builds its own minimal
// pool/membership/assignment rows directly (rather than extending the
// shared createE2EV2GeneratedSchedule fixture, which intentionally
// creates zero assignment rows for the simpler Phase 10/11/12 lifecycle
// specs) so cleanup here stays self-contained and explicit.
test.describe("Duty Rules V2 manual assignment editing (real browser, real Postgres)", () => {
  const tracked = newTrackedIds();
  const poolIds: string[] = [];

  test.afterAll(async () => {
    if (poolIds.length > 0) {
      // RotationPool is Restrict on organizationId — must be gone before
      // cleanupTrackedIds deletes the organization. DutyAssignment's own
      // membershipId is SetNull on membership deletion (cascaded from the
      // pool), so this is safe to run before schedule/assignment cleanup.
      await e2ePrisma.rotationPool.deleteMany({ where: { id: { in: poolIds } } });
    }
    // plan.id / planVersion.id are pushed into tracked.dutyPlanIds /
    // dutyPlanVersionIds below, so cleanupTrackedIds's own internal
    // ordering (schedules -> plan version -> plan -> region) already
    // handles them correctly.
    await cleanupTrackedIds(tracked);
  });

  async function setupV2ScheduleWithAssignment(scheduleStatus: "DRAFT" | "PUBLISHED") {
    const org = await createE2EOrganization(tracked);
    const region = await createE2ERegion(tracked, { organizationId: org.id });
    const pharmacyA = await createE2EPharmacy(tracked, region.id, { name: `E2E Eczane A ${Date.now()}` });
    const pharmacyB = await createE2EPharmacy(tracked, region.id, { name: `E2E Eczane B ${Date.now()}` });
    const admin = await createE2EUser(tracked, { role: "ADMIN", organizationId: org.id });
    const token = await createE2ESession(tracked, admin.id);

    const plan = await e2ePrisma.dutyPlan.create({
      data: { name: `E2E Manual Edit Plan ${Date.now()}`, organizationId: org.id, regionId: region.id },
    });
    tracked.dutyPlanIds.push(plan.id);
    const planVersion = await e2ePrisma.dutyPlanVersion.create({
      data: {
        planId: plan.id,
        versionNumber: 1,
        status: "ACTIVE",
        validFrom: new Date("2031-06-01T00:00:00.000Z"),
        activatedAt: new Date(),
      },
    });
    tracked.dutyPlanVersionIds.push(planVersion.id);
    const pool = await e2ePrisma.rotationPool.create({
      data: { organizationId: org.id, regionId: region.id, name: `E2E Manuel Havuz ${Date.now()}`, strategy: "SEQUENTIAL" },
    });
    poolIds.push(pool.id);
    const membershipA = await e2ePrisma.rotationPoolMembership.create({
      data: { poolId: pool.id, pharmacyId: pharmacyA.id, joinedAt: new Date("2031-01-01T00:00:00.000Z") },
    });
    await e2ePrisma.rotationPoolMembership.create({
      data: { poolId: pool.id, pharmacyId: pharmacyB.id, joinedAt: new Date("2031-01-01T00:00:00.000Z") },
    });

    const schedule = await e2ePrisma.dutySchedule.create({
      data: { month: 6, year: 2031, regionId: region.id, status: scheduleStatus, planVersionId: planVersion.id },
    });
    tracked.dutyScheduleIds.push(schedule.id);

    const generationRun = await e2ePrisma.dutyGenerationRun.create({
      data: {
        status: scheduleStatus === "PUBLISHED" ? "PUBLISHED" : "COMMITTED",
        organizationId: org.id,
        regionId: region.id,
        planId: plan.id,
        planVersionId: planVersion.id,
        dutyScheduleId: schedule.id,
        generationMode: "PREVIEW",
        periodStart: new Date("2031-06-01T00:00:00.000Z"),
        periodEnd: new Date("2031-06-01T00:00:00.000Z"),
        configurationFingerprint: "e2e-config",
        runtimeInputHash: "e2e-runtime",
        ruleSetFingerprint: "e2e-ruleset",
        strategySetFingerprint: "e2e-strategyset",
        upstreamResultFingerprint: "e2e-upstream",
        membershipSnapshotHash: "e2e-membership",
        provisionalSelectionFingerprint: "e2e-provisional",
        completeDraftFingerprint: `e2e-fingerprint-${Date.now()}`,
        engineVersion: 1,
        selectionEngineVersion: 1,
        draftEngineVersion: 1,
        manifest: { counts: { totalAssignments: 1 } },
        ...(scheduleStatus === "PUBLISHED" ? { publishedAt: new Date() } : {}),
      },
    });

    await e2ePrisma.dutyAssignment.create({
      data: {
        dutyScheduleId: schedule.id,
        date: new Date("2031-06-01T00:00:00.000Z"),
        pharmacyId: pharmacyA.id,
        weight: 1,
        isManual: false,
        membershipId: membershipA.id,
        selectionOrdinal: 1,
        origin: "STRICT",
        slotKey: "2031-06-01:WEEKDAY:shift-1:0",
        draftAssignmentKey: `2031-06-01:WEEKDAY:shift-1:0#${pharmacyA.id}`,
        generationRunId: generationRun.id,
      },
    });

    return { org, region, pharmacyA, pharmacyB, admin, token, schedule };
  }

  test("ADMIN edits a V2 assignment through the V2-aware edit page; candidates limited to the pool", async ({
    context,
    page,
    baseURL,
  }) => {
    const { pharmacyB, token, schedule } = await setupV2ScheduleWithAssignment("DRAFT");

    await addSessionCookie(context, token, baseURL!);
    await page.goto(`/cizelgeler/${schedule.id}`);

    await page.getByRole("link", { name: "Düzenle" }).click();
    await expect(page).toHaveURL(new RegExp(`/v2-duzenle$`));
    await expect(page.getByText(/zaten ilerlemiş olduğundan/)).toBeVisible();

    await page.getByLabel("Yeni Nöbetçi Eczane").selectOption({ value: pharmacyB.id });
    await page.getByLabel("Değişiklik Nedeni").fill("E2E manuel düzeltme");
    await page.getByRole("button", { name: "Kaydet" }).click();

    await expect(page.getByText("Nöbet ataması güncellendi.")).toBeVisible();
    await expect(page.getByText(pharmacyB.name).first()).toBeVisible();
    await expect(page.getByText("Manuel", { exact: true })).toBeVisible();
  });

  test("editing a PUBLISHED V2 assignment succeeds and leaves RotationState untouched", async ({
    context,
    page,
    baseURL,
  }) => {
    const { pharmacyB, token, schedule } = await setupV2ScheduleWithAssignment("PUBLISHED");

    await addSessionCookie(context, token, baseURL!);
    await page.goto(`/cizelgeler/${schedule.id}`);
    await page.getByRole("link", { name: "Düzenle" }).click();

    await page.getByLabel("Yeni Nöbetçi Eczane").selectOption({ value: pharmacyB.id });
    await page.getByLabel("Değişiklik Nedeni").fill("Yayın sonrası düzeltme");
    await page.getByRole("button", { name: "Kaydet" }).click();

    await expect(page.getByText("Nöbet ataması güncellendi.")).toBeVisible();
    // Schedule stays PUBLISHED — editing never reopens the lifecycle.
    await expect(page.getByText("Yayınlandı").first()).toBeVisible();
  });

  test("V1 schedule's Düzenle link still routes to the original V1 edit page", async ({
    context,
    page,
    baseURL,
  }) => {
    const org = await createE2EOrganization(tracked);
    const region = await createE2ERegion(tracked, { organizationId: org.id });
    const pharmacy = await createE2EPharmacy(tracked, region.id);
    const admin = await createE2EUser(tracked, { role: "ADMIN", organizationId: org.id });
    const token = await createE2ESession(tracked, admin.id);
    const schedule = await createE2EDutySchedule(tracked, region.id, { month: 8, year: 2031, status: "DRAFT" });
    const assignment = await e2ePrisma.dutyAssignment.create({
      data: { dutyScheduleId: schedule.id, date: new Date("2031-08-01T00:00:00.000Z"), pharmacyId: pharmacy.id, weight: 1, isManual: false },
    });

    await addSessionCookie(context, token, baseURL!);
    await page.goto(`/cizelgeler/${schedule.id}`);
    await page.getByRole("link", { name: "Düzenle" }).click();

    await expect(page).toHaveURL(new RegExp(`/atama/${assignment.id}/duzenle$`));
    await expect(page.getByText("Nöbet Atamasını Düzenle")).toBeVisible();
  });
});
