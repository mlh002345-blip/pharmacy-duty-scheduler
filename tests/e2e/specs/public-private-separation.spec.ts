import { test, expect } from "@playwright/test";

import {
  createE2ERegion,
  createE2EPharmacy,
  cleanupTrackedIds,
  newTrackedIds,
  SESSION_COOKIE_NAME,
} from "../helpers/fixtures";
import { e2ePrisma } from "../helpers/db";

test.describe("public / private separation", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  test("/vatandas works without any login", async ({ page }) => {
    const response = await page.goto("/vatandas");
    expect(response?.status()).toBe(200);
    const html = await page.content();
    expect(html).not.toContain("passwordHash");
    expect(html).not.toContain("session_token");
  });

  test("a valid public token works without login, submits a request tied only to that pharmacy, and never leaks admin fields", async ({
    page,
  }) => {
    const region = await createE2ERegion(tracked);
    const pharmacy = await createE2EPharmacy(tracked, region.id);

    const response = await page.goto(`/eczane-talep/${pharmacy.requestToken}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByText(pharmacy.name)).toBeVisible();

    // No hidden or visible pharmacyId field exists anywhere in the form
    // — the pharmacy is derived exclusively from the URL token
    // server-side, never accepted as client input.
    const pharmacyIdFieldCount = await page.locator('[name="pharmacyId"]').count();
    expect(pharmacyIdFieldCount).toBe(0);

    await page.selectOption("#requestType", "CANNOT_DUTY");
    await page.fill("#startDate", "2030-01-15");
    await page.fill("#endDate", "2030-01-16");
    await page.fill("#explanation", "E2E genel test açıklaması, en az on karakter.");
    await page.click('button[type="submit"]');

    await expect(page.getByText(/incelemesine gönderildi|daha önce alınmış/)).toBeVisible();

    const createdRequest = await e2ePrisma.dutyRequest.findFirst({
      where: { pharmacyId: pharmacy.id, source: "PUBLIC_LINK" },
    });
    expect(createdRequest).not.toBeNull();
    expect(createdRequest!.pharmacyId).toBe(pharmacy.id);
    tracked.dutyRequestIds.push(createdRequest!.id);

    // The public page must never grant dashboard access — no session
    // cookie is ever set by this flow.
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === SESSION_COOKIE_NAME)).toBeUndefined();
  });

  test("an invalid token shows the intended not-found-style page, not a raw 404 or an error leaking details", async ({
    page,
  }) => {
    const response = await page.goto("/eczane-talep/this-token-does-not-exist-00000000");
    expect(response?.status()).toBe(200);
    await expect(page.getByText("Bağlantı Geçersiz")).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain("PrismaClient");
    expect(html).not.toContain("at Object.");
  });

  test("a valid public token never grants dashboard access even when a dashboard session cookie is also present", async ({
    page,
    context,
    baseURL,
  }) => {
    const region = await createE2ERegion(tracked);
    const pharmacy = await createE2EPharmacy(tracked, region.id);

    // Visiting the public link with NO session must not redirect to
    // /giris and must not expose any dashboard content.
    await page.goto(`/eczane-talep/${pharmacy.requestToken}`);
    expect(page.url()).not.toContain("/giris");
    expect(page.url()).not.toBe(`${baseURL}/`);

    // A garbage/forged session cookie alongside the token still doesn't
    // grant it dashboard authority — the public route never checks the
    // session cookie at all.
    await context.addCookies([
      { name: SESSION_COOKIE_NAME, value: "not-a-real-session-token", domain: "localhost", path: "/" },
    ]);
    await page.goto(`/eczane-talep/${pharmacy.requestToken}`);
    await expect(page.getByText(pharmacy.name)).toBeVisible();

    await page.goto("/eczaneler");
    await expect(page).toHaveURL(/\/giris/);
  });
});
