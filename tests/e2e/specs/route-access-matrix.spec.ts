import { test, expect } from "@playwright/test";

import {
  createE2ESession,
  createE2EUser,
  cleanupTrackedIds,
  newTrackedIds,
  E2E_TEST_PASSWORD,
} from "../helpers/fixtures";
import { addSessionCookie } from "../helpers/browser";
import { e2ePrisma } from "../helpers/db";

// Direct URL access, not button visibility — every assertion here is on
// what the server actually returns for a real navigation, asserted via
// the resulting URL (redirect target) and/or visible page content. This
// exercises the real current permission matrix in
// src/lib/auth/permissions.ts; no new policy is invented here.

const ADMIN_ONLY_ROUTES = ["/kullanicilar", "/denetim-kayitlari"];
const AUTHENTICATED_ROUTES = [
  "/eczaneler",
  "/bolgeler",
  "/nobet-talepleri",
  "/gecmis-nobetler",
  "/cizelgeler",
  "/veri-kontrol",
];

test.describe("role-based route access matrix", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  test("ADMIN can access every admin/operational route", async ({ page, context, baseURL }) => {
    const admin = await createE2EUser(tracked, { role: "ADMIN" });
    const token = await createE2ESession(tracked, admin.id);
    await addSessionCookie(context, token, baseURL!);

    for (const route of [...ADMIN_ONLY_ROUTES, ...AUTHENTICATED_ROUTES]) {
      await page.goto(route);
      await expect(page).toHaveURL(new RegExp(`${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
      // A denied page would have redirected to /giris or / — reaching
      // the intended URL and staying there is the assertion.
      expect(page.url()).not.toContain("/giris");
    }
  });

  test("STAFF cannot access ADMIN-only routes but can access operational routes", async ({
    page,
    context,
    baseURL,
  }) => {
    const staff = await createE2EUser(tracked, { role: "STAFF" });
    const token = await createE2ESession(tracked, staff.id);
    await addSessionCookie(context, token, baseURL!);

    for (const route of ADMIN_ONLY_ROUTES) {
      await page.goto(route);
      // requirePermissionOrRedirectWithMessage redirects to "/" with a
      // flash error message — never renders the admin-only content.
      await expect(page).toHaveURL(/\/\?error=/);
      const body = await page.textContent("body");
      expect(body).not.toContain("passwordHash");
    }

    for (const route of AUTHENTICATED_ROUTES) {
      await page.goto(route);
      expect(page.url()).not.toContain("/giris");
      expect(page.url()).not.toMatch(/\/\?error=/);
    }
  });

  test("VIEWER can access read-only operational routes but not ADMIN-only routes", async ({
    page,
    context,
    baseURL,
  }) => {
    const viewer = await createE2EUser(tracked, { role: "VIEWER" });
    const token = await createE2ESession(tracked, viewer.id);
    await addSessionCookie(context, token, baseURL!);

    for (const route of ADMIN_ONLY_ROUTES) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/\?error=/);
    }

    for (const route of AUTHENTICATED_ROUTES) {
      await page.goto(route);
      expect(page.url()).not.toContain("/giris");
    }

    // VIEWER lacks manageSetupData — the create-pharmacy page itself
    // redirects before rendering the form (server-side, not just a
    // hidden button).
    await page.goto("/eczaneler/yeni");
    await expect(page).toHaveURL(/\/eczaneler(\?|$)/);
    const pharmacyCountBefore = await e2ePrisma.pharmacy.count();
    expect(pharmacyCountBefore).toBeGreaterThanOrEqual(0); // sanity: query succeeds
  });

  test("ANONYMOUS is redirected to /giris from every dashboard route, and public routes stay available", async ({
    page,
  }) => {
    for (const route of [...ADMIN_ONLY_ROUTES, ...AUTHENTICATED_ROUTES, "/"]) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/giris/);
    }

    // Public routes remain available with no session at all.
    const vatandasResponse = await page.goto("/vatandas");
    expect(vatandasResponse?.status()).toBe(200);
    await expect(page).toHaveURL(/\/vatandas/);
  });

  test("INACTIVE_USER cannot log in and a pre-existing session no longer grants access once deactivated", async ({
    page,
    context,
    baseURL,
  }) => {
    const user = await createE2EUser(tracked, { role: "STAFF", isActive: true });
    const token = await createE2ESession(tracked, user.id);
    await addSessionCookie(context, token, baseURL!);

    await page.goto("/eczaneler");
    expect(page.url()).not.toContain("/giris");

    // Deactivate directly in the database (equivalent effect to an admin
    // deactivating the account through /kullanicilar).
    await e2ePrisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    await page.goto("/eczaneler");
    await expect(page).toHaveURL(/\/giris/);

    // A fresh login attempt with the correct password on the now-inactive
    // account must return the SAME generic message as any other failure
    // — never reveal that the account exists or is specifically inactive.
    await page.context().clearCookies();
    await page.goto("/giris");
    await page.fill("#email", user.email);
    await page.fill("#password", E2E_TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page.getByText("Hatalı e-posta veya şifre.")).toBeVisible();
    expect(page.url()).toContain("/giris");
  });
});
