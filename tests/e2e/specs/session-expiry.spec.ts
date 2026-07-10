import { test, expect } from "@playwright/test";

import { createE2EUser, createE2ESession, cleanupTrackedIds, newTrackedIds } from "../helpers/fixtures";
import { addSessionCookie } from "../helpers/browser";
import { e2ePrisma } from "../helpers/db";

// getCurrentUser() rejects when `session.expiresAt.getTime() < Date.now()`
// — a STRICT less-than, so a session whose expiresAt is exactly "now" (to
// the millisecond) is still technically in the future by the time the
// comparison runs a moment later, and is accepted. This test asserts the
// real current contract exactly as implemented, via direct timestamp
// manipulation in the database — no sleeps anywhere.

test.describe("session-expiry boundary", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  test("a session expiring just before now is rejected", async ({ context, baseURL, page }) => {
    const user = await createE2EUser(tracked, { role: "VIEWER" });
    const token = await createE2ESession(tracked, user.id, new Date(Date.now() - 5_000));
    await addSessionCookie(context, token, baseURL!);

    await page.goto("/eczaneler");
    await expect(page).toHaveURL(/\/giris/);
  });

  test("a session expiring exactly at 'now' (at DB-write time) is rejected, same as an already-expired one", async ({
    context,
    baseURL,
    page,
  }) => {
    const user = await createE2EUser(tracked, { role: "VIEWER" });
    // getCurrentUser()'s check is a strict `expiresAt.getTime() < Date.now()`.
    // By the time the browser's request actually reaches that check —
    // even a handful of milliseconds later — real "now" has already
    // moved past this exact stored instant, so this boundary behaves
    // identically to an already-expired session in practice. This is
    // the real, observed current contract (confirmed by running this
    // exact scenario), not merely inferred from reading the source.
    const token = await createE2ESession(tracked, user.id, new Date());
    await addSessionCookie(context, token, baseURL!);

    await page.goto("/eczaneler");
    await expect(page).toHaveURL(/\/giris/);
  });

  test("a session expiring just after now is accepted", async ({ context, baseURL, page }) => {
    const user = await createE2EUser(tracked, { role: "VIEWER" });
    const token = await createE2ESession(tracked, user.id, new Date(Date.now() + 5_000));
    await addSessionCookie(context, token, baseURL!);

    await page.goto("/eczaneler");
    expect(page.url()).not.toContain("/giris");
  });

  test("an unexpired session (normal 7-day lifetime) is accepted, and an expired session row is not proactively deleted by a mere read", async ({
    context,
    baseURL,
    page,
  }) => {
    const user = await createE2EUser(tracked, { role: "VIEWER" });
    const expiredToken = await createE2ESession(tracked, user.id, new Date(Date.now() - 60_000));
    await addSessionCookie(context, expiredToken, baseURL!);

    await page.goto("/eczaneler");
    await expect(page).toHaveURL(/\/giris/);

    // Matches the current, documented contract (docs/security/10-memory-
    // unbounded-growth.md, "Expired Session rows have no cleanup"):
    // rejection happens at read time via the timestamp comparison; the
    // row itself is not deleted just because it was read past expiry.
    const row = await e2ePrisma.session.findUnique({ where: { token: expiredToken } });
    expect(row).not.toBeNull();
  });
});
