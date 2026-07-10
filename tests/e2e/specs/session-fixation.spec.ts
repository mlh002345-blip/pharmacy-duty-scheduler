import { randomBytes } from "node:crypto";

import { test, expect } from "@playwright/test";

import {
  createE2EUser,
  cleanupTrackedIds,
  newTrackedIds,
  E2E_TEST_PASSWORD,
  SESSION_COOKIE_NAME,
} from "../helpers/fixtures";
import { e2ePrisma } from "../helpers/db";

// Session fixation resistance: an attacker who plants a known cookie
// value in a victim's browser before login must gain nothing — the
// server must always mint its own fresh, unpredictable token on login
// (createSession always INSERTs a brand-new randomBytes(32) token; there
// is no "adopt the incoming cookie" code path anywhere in the app).
// Full tokens are never printed to test output — only lengths, equality
// checks, and truncated-for-debugging-only prefixes if ever needed.

test.describe("session fixation resistance", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  test("logging in with an attacker-chosen pre-set cookie value never causes the server to adopt it", async ({
    page,
    context,
  }) => {
    const user = await createE2EUser(tracked, { role: "VIEWER" });

    // Visit the login page with no session at all first.
    await page.goto("/giris");
    const cookiesBeforeAnySession = await context.cookies();
    expect(cookiesBeforeAnySession.find((c) => c.name === SESSION_COOKIE_NAME)).toBeUndefined();

    // Attacker plants a fake, guessable cookie value before the victim
    // logs in (classic session-fixation setup).
    const attackerChosenToken = "attacker-chosen-fixed-value-0000000000000000000000000000";
    await context.addCookies([
      { name: SESSION_COOKIE_NAME, value: attackerChosenToken, domain: "localhost", path: "/" },
    ]);

    await page.goto("/giris");
    await page.fill("#email", user.email);
    await page.fill("#password", E2E_TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/$/);

    const cookiesAfterLogin = await context.cookies();
    const issuedToken = cookiesAfterLogin.find((c) => c.name === SESSION_COOKIE_NAME)!.value;

    // The server never adopted the attacker's value.
    expect(issuedToken).not.toBe(attackerChosenToken);
    expect(issuedToken).toHaveLength(64); // randomBytes(32).toString("hex")

    const attackerTokenRow = await e2ePrisma.session.findUnique({
      where: { token: attackerChosenToken },
    });
    expect(attackerTokenRow).toBeNull();

    const realTokenRow = await e2ePrisma.session.findUnique({ where: { token: issuedToken } });
    expect(realTokenRow).not.toBeNull();
    expect(realTokenRow!.userId).toBe(user.id);

    // Log out, then log in again — the second real token must differ
    // from the first (each login mints an independent, unpredictable
    // token; nothing is reused or derived from the prior session).
    await page.getByRole("button", { name: "Çıkış Yap" }).click();
    await expect(page).toHaveURL(/\/giris/);

    await page.fill("#email", user.email);
    await page.fill("#password", E2E_TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/$/);

    const cookiesAfterSecondLogin = await context.cookies();
    const secondToken = cookiesAfterSecondLogin.find((c) => c.name === SESSION_COOKIE_NAME)!.value;
    expect(secondToken).not.toBe(issuedToken);
    expect(secondToken).toHaveLength(64);

    // Extra defense-in-depth check: a completely random, never-issued
    // token also never grants access (sanity check that the app doesn't
    // e.g. accept any 64-hex-char value).
    const neverIssued = randomBytes(32).toString("hex");
    await context.addCookies([
      { name: SESSION_COOKIE_NAME, value: neverIssued, domain: "localhost", path: "/" },
    ]);
    await page.goto("/eczaneler");
    await expect(page).toHaveURL(/\/giris/);

    await e2ePrisma.session.deleteMany({ where: { userId: user.id } });
  });
});
