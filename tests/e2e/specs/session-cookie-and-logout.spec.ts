import { test, expect } from "@playwright/test";

import {
  createE2EUser,
  cleanupTrackedIds,
  newTrackedIds,
  E2E_TEST_PASSWORD,
  SESSION_COOKIE_NAME,
} from "../helpers/fixtures";
import { e2ePrisma } from "../helpers/db";

test.describe("session-cookie security and logout", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  test("session cookie has HttpOnly, SameSite=Lax, Secure, and Path=/, and no secret appears on the page", async ({
    page,
    context,
  }) => {
    const user = await createE2EUser(tracked, { role: "VIEWER" });

    await page.goto("/giris");
    await page.fill("#email", user.email);
    await page.fill("#password", E2E_TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/panel$/);

    const cookies = await context.cookies();
    const sessionCookie = cookies.find((c) => c.name === SESSION_COOKIE_NAME);
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie!.httpOnly).toBe(true);
    expect(sessionCookie!.sameSite).toBe("Lax");
    expect(sessionCookie!.path).toBe("/");
    // The app under test runs as a real production build
    // (NODE_ENV=production, see playwright.config.ts) bound to
    // `localhost`, which Chromium treats as a secure context even over
    // plain HTTP — so the Secure flag genuinely round-trips here, not
    // just "declared present in the Set-Cookie header we happened to
    // read." See docs/testing/ROLE_SESSION_E2E_TESTS.md for what this
    // does and does not prove about a real deployed HTTPS origin.
    expect(sessionCookie!.secure).toBe(true);

    // The rendered dashboard never leaks the raw token, the password, or
    // a password hash anywhere in the page's own content.
    const bodyText = await page.textContent("body");
    expect(bodyText).not.toContain(sessionCookie!.value);
    expect(bodyText).not.toContain(E2E_TEST_PASSWORD);
    const html = await page.content();
    expect(html).not.toContain("passwordHash");
  });

  test("logout removes the session server-side and the old cookie no longer grants access", async ({
    page,
    context,
  }) => {
    const user = await createE2EUser(tracked, { role: "VIEWER" });

    await page.goto("/giris");
    await page.fill("#email", user.email);
    await page.fill("#password", E2E_TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/panel$/);

    const cookiesBeforeLogout = await context.cookies();
    const tokenBeforeLogout = cookiesBeforeLogout.find((c) => c.name === SESSION_COOKIE_NAME)!.value;
    const sessionRowBefore = await e2ePrisma.session.findUnique({
      where: { token: tokenBeforeLogout },
    });
    expect(sessionRowBefore).not.toBeNull();

    await page.getByRole("button", { name: "Çıkış Yap" }).click();
    await expect(page).toHaveURL(/\/giris/);

    // Persisted DB state: the Session row is actually gone, not just the
    // browser cookie cleared client-side.
    const sessionRowAfter = await e2ePrisma.session.findUnique({
      where: { token: tokenBeforeLogout },
    });
    expect(sessionRowAfter).toBeNull();

    // Re-injecting the exact old cookie value must not grant access —
    // this proves rejection is server-side (the row is gone), not merely
    // "the browser forgot the cookie."
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: tokenBeforeLogout,
        domain: "localhost",
        path: "/",
      },
    ]);
    await page.goto("/eczaneler");
    await expect(page).toHaveURL(/\/giris/);

    // Logout is safe to repeat (idempotent): log in again (a fresh
    // session), log out again, and confirm the second cycle behaves
    // identically — no error, a new Session row is created and then
    // actually removed.
    await page.context().clearCookies();
    await page.goto("/giris");
    await page.fill("#email", user.email);
    await page.fill("#password", E2E_TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/panel$/);

    const secondCookies = await context.cookies();
    const secondToken = secondCookies.find((c) => c.name === SESSION_COOKIE_NAME)!.value;
    expect(secondToken).not.toBe(tokenBeforeLogout);

    await page.getByRole("button", { name: "Çıkış Yap" }).click();
    await expect(page).toHaveURL(/\/giris/);
    const secondSessionAfter = await e2ePrisma.session.findUnique({ where: { token: secondToken } });
    expect(secondSessionAfter).toBeNull();
  });
});
