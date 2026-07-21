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

const NEW_PASSWORD = "BrandNewE2ePassw0rd!";

test.describe("password-change session invalidation", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  test("changing a user's own password invalidates every existing session for that user", async ({
    baseURL,
    browser,
  }) => {
    // ADMIN role so the user can reach their own /kullanicilar/[id]/duzenle
    // edit page — this is the real, production self-password-change path
    // (updateUserAction), not a test-only shortcut.
    const user = await createE2EUser(tracked, { role: "ADMIN" });

    const tokenA = await createE2ESession(tracked, user.id);
    const tokenB = await createE2ESession(tracked, user.id);

    // Two independent browser contexts ("Browser Context A" / "Browser
    // Context B") — separate cookie jars, exactly like two different
    // browsers/devices signed into the same account.
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    await addSessionCookie(contextA, tokenA, baseURL!);
    await addSessionCookie(contextB, tokenB, baseURL!);
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await pageA.goto("/eczaneler");
      expect(pageA.url()).not.toContain("/giris");
      await pageB.goto("/eczaneler");
      expect(pageB.url()).not.toContain("/giris");

      const auditLogsBefore = await e2ePrisma.auditLog.count({
        where: { entity: "User", entityId: user.id, action: "UPDATE" },
      });

      // Context A performs the real self-password-change action.
      await pageA.goto(`/kullanicilar/${user.id}/duzenle`);
      await pageA.fill("#password", NEW_PASSWORD);
      await pageA.fill("#passwordConfirmation", NEW_PASSWORD);
      await pageA.click('button:has-text("Kaydet")');

      // Self-password-change redirects to /giris with a success message
      // (clearSessionCookie + redirect, per src/app/(dashboard)/
      // kullanicilar/actions.ts) — assert that exact behavior.
      await expect(pageA).toHaveURL(/\/giris\?success=/);

      // Context A's old session is gone.
      await pageA.goto("/eczaneler");
      await expect(pageA).toHaveURL(/\/giris/);

      // Context B's old session — a DIFFERENT token for the SAME user —
      // is also invalidated, even though context B never initiated the
      // change itself.
      await pageB.goto("/eczaneler");
      await expect(pageB).toHaveURL(/\/giris/);

      const [sessionA, sessionB] = await Promise.all([
        e2ePrisma.session.findUnique({ where: { token: tokenA } }),
        e2ePrisma.session.findUnique({ where: { token: tokenB } }),
      ]);
      expect(sessionA).toBeNull();
      expect(sessionB).toBeNull();

      // Old password no longer logs in; new password does.
      await pageA.goto("/giris");
      await pageA.fill("#email", user.email);
      await pageA.fill("#password", E2E_TEST_PASSWORD);
      await pageA.click('button[type="submit"]');
      await expect(pageA.getByText("Hatalı e-posta veya şifre.")).toBeVisible();

      await pageA.goto("/giris");
      await pageA.fill("#email", user.email);
      await pageA.fill("#password", NEW_PASSWORD);
      await pageA.click('button[type="submit"]');
      await expect(pageA).toHaveURL(/^http:\/\/localhost:\d+\/panel$/);

      // Exactly one password-change AuditLog row exists (not zero, not
      // duplicated).
      const auditLogsAfter = await e2ePrisma.auditLog.count({
        where: { entity: "User", entityId: user.id, action: "UPDATE" },
      });
      expect(auditLogsAfter).toBe(auditLogsBefore + 1);

      const auditRow = await e2ePrisma.auditLog.findFirst({
        where: { entity: "User", entityId: user.id, action: "UPDATE" },
        orderBy: { createdAt: "desc" },
      });
      const auditRaw = JSON.stringify(auditRow);
      expect(auditRaw).not.toContain(NEW_PASSWORD);
      expect(auditRaw).not.toContain(E2E_TEST_PASSWORD);
      expect(auditRaw.toLowerCase()).not.toContain("passwordhash");
    } finally {
      // Clean up the session created by the final successful re-login
      // above (not tracked by id ahead of time since it's created by the
      // real login flow, not a fixture call).
      await e2ePrisma.session.deleteMany({ where: { userId: user.id } });
      await contextA.close();
      await contextB.close();
    }
  });
});
