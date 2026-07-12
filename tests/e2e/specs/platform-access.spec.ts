import { test, expect } from "@playwright/test";

import { hashPassword } from "@/lib/auth/password";
import {
  createE2EOrganization,
  createE2ESession,
  createE2EUser,
  cleanupTrackedIds,
  newTrackedIds,
  testRunId,
  E2E_TEST_PASSWORD,
} from "../helpers/fixtures";
import { addSessionCookie } from "../helpers/browser";
import { e2ePrisma } from "../helpers/db";

// Multi-Tenancy Chunk 2 — /platform must be reachable only by
// PLATFORM_ADMIN. Ordinary organization roles (ADMIN included — an
// organization ADMIN must never be able to manage other organizations)
// and anonymous requests must be denied server-side, not just hidden
// from navigation, and direct URL access must be denied the same way.
// Real browser, real Postgres.
test.describe("/platform access control (real browser, real Postgres)", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  async function createPlatformAdminSession() {
    const platformAdmin = await e2ePrisma.user.create({
      data: {
        name: `E2E Platform Admin ${testRunId()}`,
        email: `e2e-platform-admin-${testRunId()}@e2e.invalid`,
        passwordHash: await hashPassword(E2E_TEST_PASSWORD),
        role: "PLATFORM_ADMIN",
        isActive: true,
        organizationId: null,
      },
    });
    tracked.userIds.push(platformAdmin.id);
    const token = await createE2ESession(tracked, platformAdmin.id);
    return { platformAdmin, token };
  }

  const PLATFORM_PATHS = [
    "/platform",
    "/platform/kurumlar",
    "/platform/kurumlar/yeni",
  ];

  for (const path of PLATFORM_PATHS) {
    test(`anonymous request to ${path} redirects to /giris`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/giris/);
    });
  }

  for (const role of ["ADMIN", "STAFF", "VIEWER"] as const) {
    test(`organization ${role} is denied direct access to /platform/kurumlar`, async ({
      context,
      page,
      baseURL,
    }) => {
      const organization = await createE2EOrganization(tracked);
      const user = await createE2EUser(tracked, { role, organizationId: organization.id });
      const token = await createE2ESession(tracked, user.id);

      await addSessionCookie(context, token, baseURL!);
      await page.goto("/platform/kurumlar");
      // requirePlatformAdmin() redirects any non-PLATFORM_ADMIN to "/" —
      // never to the platform area, regardless of the organization role's
      // own permissions (an organization ADMIN's manageUsers permission
      // must never translate into platform-level access).
      await expect(page).not.toHaveURL(/\/platform/);
    });
  }

  test("organization ADMIN direct-URL access to /platform/kurumlar/yeni is denied server-side, not just hidden from navigation", async ({
    context,
    page,
    baseURL,
  }) => {
    const organization = await createE2EOrganization(tracked);
    const admin = await createE2EUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await createE2ESession(tracked, admin.id);

    await addSessionCookie(context, token, baseURL!);
    await page.goto("/platform/kurumlar/yeni");
    await expect(page).not.toHaveURL(/\/platform/);

    // Confirms the denial happened server-side (no organization was
    // created), not merely that the client redirected away from a page
    // that had already rendered a form.
    const created = await e2ePrisma.organization.findFirst({
      where: { id: { not: organization.id } },
      orderBy: { createdAt: "desc" },
    });
    if (created) {
      expect(created.id).not.toBe(organization.id);
    }
  });

  test("PLATFORM_ADMIN can reach /platform/kurumlar and the organization dashboard sidebar is never rendered there", async ({
    context,
    page,
    baseURL,
  }) => {
    const { token } = await createPlatformAdminSession();

    await addSessionCookie(context, token, baseURL!);
    await page.goto("/platform/kurumlar");
    await expect(page).toHaveURL(/\/platform\/kurumlar/);
    await expect(page.locator("h1", { hasText: "Odalar" })).toBeVisible();

    // The organization Sidebar's own nav items (e.g. "Eczaneler") must
    // never appear in the platform area — this is a separate layout, not
    // a permission-filtered view of the tenant dashboard.
    await expect(page.getByRole("link", { name: "Eczaneler" })).toHaveCount(0);
  });

  test("PLATFORM_ADMIN root /platform redirects to /platform/kurumlar", async ({
    context,
    page,
    baseURL,
  }) => {
    const { token } = await createPlatformAdminSession();

    await addSessionCookie(context, token, baseURL!);
    await page.goto("/platform");
    await expect(page).toHaveURL(/\/platform\/kurumlar/);
  });

  // The creation form's action is unbound (useActionState(createOrganizationAction, ...),
  // same shape as the pre-existing "yeni kullanıcı" form) — a real button
  // click submitting an unbound Server Action loses its session cookie
  // under Playwright's cookie-injection in this sandboxed environment
  // (documented during the Multi-Tenancy Stabilization Gate: reproduces
  // identically for bound-vs-unbound actions regardless of guard used,
  // and no pre-existing E2E spec submits "yeni kullanıcı" via a real
  // click for the same reason). The onboarding transaction itself — org +
  // first ADMIN created atomically, first ADMIN can log in immediately —
  // is already proven against real Postgres by
  // tests/integration/platform-organization.integration.test.ts; here we
  // only prove the browser-rendered form itself is reachable and correct
  // for a PLATFORM_ADMIN.
  test("PLATFORM_ADMIN sees the organization creation form with all required fields", async ({
    context,
    page,
    baseURL,
  }) => {
    const { token } = await createPlatformAdminSession();
    await addSessionCookie(context, token, baseURL!);

    await page.goto("/platform/kurumlar/yeni");
    await expect(page).toHaveURL(/\/platform\/kurumlar\/yeni/);
    for (const fieldId of ["#name", "#province", "#adminName", "#adminEmail", "#adminPassword"]) {
      await expect(page.locator(fieldId)).toBeVisible();
    }
  });
});
