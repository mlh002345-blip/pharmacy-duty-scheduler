import { test, expect } from "@playwright/test";

import { hashPassword } from "@/lib/auth/password";
import {
  createE2EDutySchedule,
  createE2EOrganization,
  createE2EPharmacy,
  createE2ERegion,
  createE2ESession,
  createE2EUser,
  cleanupTrackedIds,
  newTrackedIds,
  E2E_TEST_PASSWORD,
} from "../helpers/fixtures";
import { addSessionCookie } from "../helpers/browser";
import { e2ePrisma } from "../helpers/db";

// Multi-Tenancy Stabilization Gate — browser-level, two-organization
// proof that direct URL access respects the organization boundary, not
// just the unit/integration-level query shape. Every organization/user
// here is synthetic and created/torn down per-test.
test.describe("two-organization tenant isolation (real browser, real Postgres)", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  async function setupTwoOrganizations() {
    const orgA = await createE2EOrganization(tracked);
    const orgB = await createE2EOrganization(tracked);
    const regionA = await createE2ERegion(tracked, { organizationId: orgA.id });
    const regionB = await createE2ERegion(tracked, { organizationId: orgB.id });
    const pharmacyA = await createE2EPharmacy(tracked, regionA.id);
    const pharmacyB = await createE2EPharmacy(tracked, regionB.id);
    const adminA = await createE2EUser(tracked, { role: "ADMIN", organizationId: orgA.id });
    const adminB = await createE2EUser(tracked, { role: "ADMIN", organizationId: orgB.id });
    const tokenA = await createE2ESession(tracked, adminA.id);
    const tokenB = await createE2ESession(tracked, adminB.id);
    return { orgA, orgB, regionA, regionB, pharmacyA, pharmacyB, adminA, adminB, tokenA, tokenB };
  }

  test("Organization A user cannot access Organization B's pharmacy edit page by direct URL", async ({
    context,
    page,
    baseURL,
  }) => {
    const { pharmacyB, tokenA } = await setupTwoOrganizations();
    await addSessionCookie(context, tokenA, baseURL!);

    await page.goto(`/eczaneler/${pharmacyB.id}/duzenle`);
    // notFound() renders Next's not-found boundary at the same URL —
    // never the real edit form, never a 200 with the foreign pharmacy's
    // data.
    await expect(page.getByText(pharmacyB.name)).toHaveCount(0);
  });

  test("Organization A cannot access Organization B's region edit URL", async ({
    context,
    page,
    baseURL,
  }) => {
    const { regionB, tokenA } = await setupTwoOrganizations();
    await addSessionCookie(context, tokenA, baseURL!);

    await page.goto(`/bolgeler/${regionB.id}/duzenle`);
    await expect(page.getByText(regionB.name)).toHaveCount(0);
  });

  test("Organization A cannot access Organization B's schedule detail or export URL", async ({
    context,
    page,
    baseURL,
  }) => {
    const { regionB, tokenA } = await setupTwoOrganizations();
    const scheduleB = await createE2EDutySchedule(tracked, regionB.id, { status: "PUBLISHED" });
    await addSessionCookie(context, tokenA, baseURL!);

    await page.goto(`/cizelgeler/${scheduleB.id}`);
    await expect(page.getByText(regionB.name)).toHaveCount(0);

    const exportResponse = await context.request.get(`/cizelgeler/${scheduleB.id}/export/excel`);
    // Controlled 404, same as a genuinely-missing id — never a 200 with
    // Organization B's schedule data, and never a distinct error that
    // would let Organization A infer the id is real.
    expect(exportResponse.status()).toBe(404);
  });

  test("Organization A's dashboard does not include Organization B's counts", async ({
    context,
    page,
    baseURL,
  }) => {
    const { tokenA } = await setupTwoOrganizations();
    // A third organization's pharmacy, created after the dashboard's own
    // org (A) already has exactly one pharmacy — if the dashboard's
    // pharmacy count query were unscoped, this extra row would inflate
    // Organization A's displayed count.
    const orgC = await createE2EOrganization(tracked);
    const regionC = await createE2ERegion(tracked, { organizationId: orgC.id });
    await createE2EPharmacy(tracked, regionC.id);
    await createE2EPharmacy(tracked, regionC.id);

    await addSessionCookie(context, tokenA, baseURL!);
    await page.goto("/panel");

    const pharmacyCountText = await page
      .locator("text=Toplam Eczane")
      .locator("..")
      .first()
      .textContent();
    // Organization A has exactly one pharmacy (from setupTwoOrganizations);
    // Organization C's two extra pharmacies must never surface here.
    expect(pharmacyCountText).not.toContain("3");
  });

  test("Organization A's audit-log page excludes Organization B's log entries", async ({
    context,
    page,
    baseURL,
  }) => {
    const { orgB, adminB, tokenA } = await setupTwoOrganizations();

    // A real AuditLog row for Organization B, with the same shape
    // writeAuditLog() produces for a region creation — written directly
    // (rather than via a browser-submitted form) so this test isolates
    // the denetim-kayitlari page's own query scoping, independent of any
    // particular mutation flow's browser mechanics.
    const distinctiveName = `Org-B-Yalnizca-${orgB.slug}`;
    const auditLog = await e2ePrisma.auditLog.create({
      data: {
        organizationId: orgB.id,
        userId: adminB.id,
        action: "CREATE",
        entity: "Region",
        entityId: "e2e-fake-region-id",
        after: JSON.stringify({ name: distinctiveName }),
      },
    });

    await addSessionCookie(context, tokenA, baseURL!);
    await page.goto("/denetim-kayitlari");
    await expect(page.getByText(distinctiveName)).toHaveCount(0);
    await expect(page.getByText(adminB.name)).toHaveCount(0);

    await e2ePrisma.auditLog.delete({ where: { id: auditLog.id } });
  });

  test("identical region names in two different organizations do not conflict", async ({
    context,
    page,
    baseURL,
  }) => {
    const orgA = await createE2EOrganization(tracked);
    const orgB = await createE2EOrganization(tracked);
    const adminA = await createE2EUser(tracked, { role: "ADMIN", organizationId: orgA.id });
    const tokenA = await createE2ESession(tracked, adminA.id);
    const sharedName = `Paylaşılan-Bölge-Adı-${testRunSuffix()}`;

    // Both regions are created directly (real Postgres @@unique
    // ([organizationId, name]) constraint — proven at the DB level
    // exactly like the app's own createRegionAction relies on) rather
    // than via a browser-submitted form, since the app's uniqueness
    // guarantee is a database constraint, not client-side behavior. The
    // browser-level assertion below is that Organization A's own region
    // list correctly renders its own identically-named region without
    // any conflict indication, proving the rendering path is unaffected
    // by another organization owning the same name.
    const regionA = await createE2ERegion(tracked, { organizationId: orgA.id, name: sharedName });
    const regionB = await createE2ERegion(tracked, { organizationId: orgB.id, name: sharedName });
    expect(regionA.id).not.toBe(regionB.id);

    await addSessionCookie(context, tokenA, baseURL!);
    await page.goto("/bolgeler");
    await expect(page.getByText(sharedName)).toBeVisible();
    // Only Organization A's own row for this name, never a second row
    // leaking Organization B's copy of the same name into A's list.
    await expect(page.getByText(sharedName)).toHaveCount(1);
  });

  test("an inactive organization blocks its user's login and any subsequent protected navigation", async ({
    context,
    page,
    baseURL,
  }) => {
    const org = await createE2EOrganization(tracked);
    const user = await createE2EUser(tracked, { role: "STAFF", organizationId: org.id });
    const token = await createE2ESession(tracked, user.id);

    // A pre-existing session, valid at the moment of creation, must stop
    // working the instant the organization is deactivated — no need to
    // touch the Session row itself (see getCurrentUser's organization
    // .isActive check).
    await addSessionCookie(context, token, baseURL!);
    await page.goto("/eczaneler");
    expect(page.url()).not.toContain("/giris");

    await e2ePrisma.organization.update({ where: { id: org.id }, data: { isActive: false } });

    await page.goto("/eczaneler");
    await expect(page).toHaveURL(/\/giris/);

    // A fresh login attempt with correct credentials on the now-inactive
    // organization's user gets the same generic failure as any other
    // rejected login — no account-existence or org-state detail leaks.
    await context.clearCookies();
    await page.goto("/giris");
    await page.fill("#email", user.email);
    await page.fill("#password", E2E_TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/giris/);

    await e2ePrisma.organization.update({ where: { id: org.id }, data: { isActive: true } });
  });

  test("PLATFORM_ADMIN does not automatically receive organization-level dashboard access", async ({
    context,
    page,
    baseURL,
  }) => {
    const platformAdmin = await e2ePrisma.user.create({
      data: {
        name: `E2E Platform Admin ${testRunSuffix()}`,
        email: `e2e-platform-admin-${testRunSuffix()}@e2e.invalid`,
        passwordHash: await hashPassword(E2E_TEST_PASSWORD),
        role: "PLATFORM_ADMIN",
        isActive: true,
        organizationId: null,
      },
    });
    tracked.userIds.push(platformAdmin.id);
    const token = await createE2ESession(tracked, platformAdmin.id);

    await addSessionCookie(context, token, baseURL!);
    await page.goto("/eczaneler");
    // requireOrganizationMember() redirects PLATFORM_ADMIN away from
    // /eczaneler to /giris, which in turn recognizes an already-logged-in
    // PLATFORM_ADMIN and sends it on to its own separately-guarded area,
    // /platform (see tests/e2e/specs/platform-access.spec.ts) — the
    // tenant dashboard itself must never render for this role.
    await expect(page).toHaveURL(/\/platform/);
  });
});

test.describe("/vatandas public route — two-organization isolation", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  test("?org=<slug> shows only that organization's duty-pharmacy data, even with an identically-named region in another organization", async ({
    page,
  }) => {
    const orgA = await createE2EOrganization(tracked);
    const orgB = await createE2EOrganization(tracked);
    const sharedRegionName = `Vatandaş-Paylaşılan-Bölge-${testRunSuffix()}`;
    const regionA = await createE2ERegion(tracked, {
      organizationId: orgA.id,
      name: sharedRegionName,
    });
    const regionB = await createE2ERegion(tracked, {
      organizationId: orgB.id,
      name: sharedRegionName,
    });
    const pharmacyA = await createE2EPharmacy(tracked, regionA.id, {
      name: `Vatandaş-A-Eczanesi-${testRunSuffix()}`,
    });
    const pharmacyB = await createE2EPharmacy(tracked, regionB.id, {
      name: `Vatandaş-B-Eczanesi-${testRunSuffix()}`,
    });
    const today = new Date();
    const scheduleA = await createE2EDutySchedule(tracked, regionA.id, {
      month: today.getUTCMonth() + 1,
      year: today.getUTCFullYear(),
      status: "PUBLISHED",
    });
    const scheduleB = await createE2EDutySchedule(tracked, regionB.id, {
      month: today.getUTCMonth() + 1,
      year: today.getUTCFullYear(),
      status: "PUBLISHED",
    });
    const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    await e2ePrisma.dutyAssignment.create({
      data: { dutyScheduleId: scheduleA.id, pharmacyId: pharmacyA.id, date: todayUtc },
    });
    await e2ePrisma.dutyAssignment.create({
      data: { dutyScheduleId: scheduleB.id, pharmacyId: pharmacyB.id, date: todayUtc },
    });

    await page.goto(`/vatandas?org=${encodeURIComponent(orgA.slug)}`);
    await expect(page.locator("p", { hasText: pharmacyA.name })).toBeVisible();
    await expect(page.locator("p", { hasText: pharmacyB.name })).toHaveCount(0);

    await page.goto(`/vatandas?org=${encodeURIComponent(orgB.slug)}`);
    await expect(page.locator("p", { hasText: pharmacyB.name })).toBeVisible();
    await expect(page.locator("p", { hasText: pharmacyA.name })).toHaveCount(0);
  });

  test("with no ?org= and more than one active organization, an organization selector is shown instead of mixed data", async ({
    page,
  }) => {
    const orgA = await createE2EOrganization(tracked);
    const orgB = await createE2EOrganization(tracked);

    await page.goto("/vatandas");
    await expect(page.getByText("Eczacı Odası Seçin")).toBeVisible();
    await expect(page.getByRole("link", { name: orgA.name })).toBeVisible();
    await expect(page.getByRole("link", { name: orgB.name })).toBeVisible();
  });

  test("an invalid organization slug shows a controlled not-found message, never raw pharmacy/region data", async ({
    page,
  }) => {
    await page.goto("/vatandas?org=this-slug-does-not-exist-e2e");
    await expect(page.getByText("Bu bağlantı geçersiz veya artık kullanılamıyor.")).toBeVisible();
  });
});

function testRunSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}
