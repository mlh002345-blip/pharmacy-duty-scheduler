import { test, expect } from "@playwright/test";

import {
  createE2EOrganization,
  createE2ERegion,
  createE2ESession,
  createE2EUser,
  cleanupTrackedIds,
  newTrackedIds,
  testRunId,
} from "../helpers/fixtures";
import { addSessionCookie } from "../helpers/browser";
import { e2ePrisma } from "../helpers/db";

// Multi-Tenancy Chunk 3 — Generic ADMIN-only Pharmacy Excel Import.
// The full upload -> preview -> import transaction path is already
// proven against real Postgres in
// tests/integration/pharmacy-excel-import.integration.test.ts; here we
// only prove browser-level access control (GET navigation, never a
// server action call) for /eczaneler/ice-aktar and its template route,
// plus that the preview page respects the organization boundary.
test.describe("/eczaneler/ice-aktar access control (real browser, real Postgres)", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  async function createOrgUser(role: "ADMIN" | "STAFF" | "VIEWER") {
    const organization = await createE2EOrganization(tracked);
    const user = await createE2EUser(tracked, { role, organizationId: organization.id });
    const token = await createE2ESession(tracked, user.id);
    return { organization, user, token };
  }

  test("anonymous request to /eczaneler/ice-aktar redirects to /giris", async ({ page }) => {
    await page.goto("/eczaneler/ice-aktar");
    await expect(page).toHaveURL(/\/giris/);
  });

  for (const role of ["STAFF", "VIEWER"] as const) {
    test(`${role} is denied direct access to /eczaneler/ice-aktar`, async ({ context, page, baseURL }) => {
      const { token } = await createOrgUser(role);
      await addSessionCookie(context, token, baseURL!);
      await page.goto("/eczaneler/ice-aktar");
      await expect(page).toHaveURL(/\/eczaneler\?error=/);
    });

    test(`${role} does not see the "Excel ile İçe Aktar" button on /eczaneler`, async ({
      context,
      page,
      baseURL,
    }) => {
      const { token } = await createOrgUser(role);
      await addSessionCookie(context, token, baseURL!);
      await page.goto("/eczaneler");
      await expect(page.getByRole("link", { name: "Excel ile İçe Aktar" })).toHaveCount(0);
    });
  }

  test("PLATFORM_ADMIN is denied access to /eczaneler/ice-aktar (redirected away, never granted tenant access)", async ({
    context,
    page,
    baseURL,
  }) => {
    const { hashPassword } = await import("@/lib/auth/password");
    const { E2E_TEST_PASSWORD } = await import("../helpers/fixtures");
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

    await addSessionCookie(context, token, baseURL!);
    await page.goto("/eczaneler/ice-aktar");
    await expect(page).not.toHaveURL(/\/eczaneler\/ice-aktar/);
  });

  test("anonymous request to the template download route redirects to /giris, never the raw file", async ({
    page,
  }) => {
    await page.goto("/eczaneler/ice-aktar/sablon");
    await expect(page).toHaveURL(/\/giris/);
  });

  test("STAFF request to the template download route is denied (403), never the xlsx file", async ({
    context,
    page,
    baseURL,
  }) => {
    const { token } = await createOrgUser("STAFF");
    await addSessionCookie(context, token, baseURL!);
    const response = await page.goto("/eczaneler/ice-aktar/sablon");
    expect(response?.status()).toBe(403);
  });

  test("ADMIN can reach /eczaneler/ice-aktar and sees the upload form and template link", async ({
    context,
    page,
    baseURL,
  }) => {
    const { token } = await createOrgUser("ADMIN");
    await addSessionCookie(context, token, baseURL!);
    await page.goto("/eczaneler/ice-aktar");
    await expect(page).toHaveURL(/\/eczaneler\/ice-aktar/);
    await expect(page.locator("#file")).toBeVisible();
    await expect(page.locator("#defaultAreaCode")).toBeVisible();
    await expect(page.getByRole("link", { name: "Şablonu İndir" })).toBeVisible();
  });

  test("ADMIN sees the \"Excel ile İçe Aktar\" button on /eczaneler", async ({ context, page, baseURL }) => {
    const { token } = await createOrgUser("ADMIN");
    await addSessionCookie(context, token, baseURL!);
    await page.goto("/eczaneler");
    await expect(page.getByRole("link", { name: "Excel ile İçe Aktar" })).toBeVisible();
  });

  test("ADMIN downloading the template gets a real xlsx file", async ({ context, page, baseURL }) => {
    const { token } = await createOrgUser("ADMIN");
    await addSessionCookie(context, token, baseURL!);
    // page.goto() treats the attachment's Content-Disposition as a file
    // download rather than a navigation — request.get() (sharing the
    // same authenticated browser context/cookies) reads the response
    // directly instead.
    const response = await page.request.get("/eczaneler/ice-aktar/sablon");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("spreadsheetml.sheet");
  });

  test("an organization's ADMIN cannot view another organization's import preview batch (org-scoped 404)", async ({
    context,
    page,
    baseURL,
  }) => {
    const { organization: orgA, user: adminA } = await createOrgUser("ADMIN");
    const regionA = await createE2ERegion(tracked, { organizationId: orgA.id });
    const batch = await e2ePrisma.pharmacyImportBatch.create({
      data: {
        status: "PREVIEWED",
        sanitizedFileName: "test.xlsx",
        fileSize: 1024,
        totalRows: 1,
        readyRows: 1,
        invalidRows: 0,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        organizationId: orgA.id,
        createdById: adminA.id,
        rows: {
          create: [
            {
              rowNumber: 2,
              pharmacyName: "Deva Eczanesi",
              normalizedPharmacyName: "deva eczanesi",
              pharmacistName: "Ada Yılmaz",
              phone: "+90 212 212 19 18",
              isActive: true,
              status: "READY",
              regionId: regionA.id,
            },
          ],
        },
      },
    });

    const { token: tokenB } = await createOrgUser("ADMIN");
    await addSessionCookie(context, tokenB, baseURL!);
    await page.goto(`/eczaneler/ice-aktar/onizleme/${batch.id}`);
    // notFound() renders Next's not-found boundary at the same URL —
    // never the real preview table, never a 200 with the foreign
    // organization's batch data.
    await expect(page.getByText("Deva Eczanesi")).toHaveCount(0);
  });

  test("the same organization's ADMIN can view its own import preview batch", async ({
    context,
    page,
    baseURL,
  }) => {
    const { organization, user: admin, token } = await createOrgUser("ADMIN");
    const region = await createE2ERegion(tracked, { organizationId: organization.id });
    const batch = await e2ePrisma.pharmacyImportBatch.create({
      data: {
        status: "PREVIEWED",
        sanitizedFileName: "test.xlsx",
        fileSize: 1024,
        totalRows: 1,
        readyRows: 1,
        invalidRows: 0,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        organizationId: organization.id,
        createdById: admin.id,
        rows: {
          create: [
            {
              rowNumber: 2,
              pharmacyName: "Deva Eczanesi",
              normalizedPharmacyName: "deva eczanesi",
              pharmacistName: "Ada Yılmaz",
              phone: "+90 212 212 19 18",
              isActive: true,
              status: "READY",
              regionId: region.id,
            },
          ],
        },
      },
    });

    await addSessionCookie(context, token, baseURL!);
    await page.goto(`/eczaneler/ice-aktar/onizleme/${batch.id}`);
    await expect(page.locator("td", { hasText: "Deva Eczanesi" })).toBeVisible();
    await expect(page.getByRole("button", { name: /İçe Aktarımı Onayla/ })).toBeVisible();
  });
});
