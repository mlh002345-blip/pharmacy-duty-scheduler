import { test, expect } from "@playwright/test";

import {
  createE2EUser,
  createE2ESession,
  cleanupTrackedIds,
  newTrackedIds,
  E2E_TEST_PASSWORD,
} from "../helpers/fixtures";
import { addSessionCookie } from "../helpers/browser";
import { e2ePrisma } from "../helpers/db";

test.describe("user deactivation session behavior", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  test("ADMIN deactivating a user through the real UI blocks that user's dashboard access, and re-login gives the generic failure message", async ({
    browser,
    baseURL,
  }) => {
    const target = await createE2EUser(tracked, { role: "STAFF" });
    const targetToken = await createE2ESession(tracked, target.id);

    const admin = await createE2EUser(tracked, { role: "ADMIN" });
    const adminToken = await createE2ESession(tracked, admin.id);

    const targetContext = await browser.newContext();
    await addSessionCookie(targetContext, targetToken, baseURL!);
    const targetPage = await targetContext.newPage();

    const adminContext = await browser.newContext();
    await addSessionCookie(adminContext, adminToken, baseURL!);
    const adminPage = await adminContext.newPage();

    try {
      await targetPage.goto("/eczaneler");
      expect(targetPage.url()).not.toContain("/giris");

      // ADMIN deactivates the target user through the real
      // setUserStatusAction-bound button on /kullanicilar.
      await adminPage.goto("/kullanicilar");
      const row = adminPage.locator("tr", { hasText: target.email });
      await row.getByRole("button", { name: "Pasif Yap" }).click();
      await expect(adminPage).toHaveURL(/\/kullanicilar\?success=/);

      const userRow = await e2ePrisma.user.findUniqueOrThrow({ where: { id: target.id } });
      expect(userRow.isActive).toBe(false);

      // The target's existing browser session can no longer reach the
      // dashboard — getCurrentUser() rejects it in real time via the
      // isActive check, even though (per current implementation)
      // deactivation without a password change does not delete the
      // Session row outright.
      await targetPage.goto("/eczaneler");
      await expect(targetPage).toHaveURL(/\/giris/);

      const sessionRow = await e2ePrisma.session.findUnique({ where: { token: targetToken } });
      expect(sessionRow).not.toBeNull(); // documents current behavior exactly — see docs/testing/ROLE_SESSION_E2E_TESTS.md

      // Re-login with the CORRECT password on the now-inactive account
      // returns the same generic message as every other failure — no
      // account-existence or inactive-state detail leaks.
      await targetPage.context().clearCookies();
      await targetPage.goto("/giris");
      await targetPage.fill("#email", target.email);
      await targetPage.fill("#password", E2E_TEST_PASSWORD);
      await targetPage.click('button[type="submit"]');
      await expect(targetPage.getByText("Hatalı e-posta veya şifre.")).toBeVisible();
      expect(targetPage.url()).toContain("/giris");
    } finally {
      await targetContext.close();
      await adminContext.close();
    }
  });
});
