import { test, expect } from "@playwright/test";

import {
  createE2EOrganization,
  createE2ERegion,
  createE2ESession,
  createE2EUser,
  cleanupTrackedIds,
  newTrackedIds,
} from "../helpers/fixtures";
import { addSessionCookie } from "../helpers/browser";

// Regression guard for the reported production "Sayfa Yanıt Vermiyor"
// (page unresponsive) freeze around tab switching and navigation.
//
// The investigation (docs/testing/TAB_FOCUS_FREEZE_INVESTIGATION.md)
// found NO focus/visibility/timer/refresh logic anywhere in the app or
// its shipped client bundles, and could not reproduce any main-thread
// stall, request loop, render loop, listener leak, or memory growth
// against the production build. This spec pins that healthy behavior:
// if anyone ever introduces a visibility-triggered refresh loop,
// unbounded polling, an accumulating listener, or a navigation-time
// main-thread stall, this test fails.
test.describe("tab-focus and navigation responsiveness (regression guard)", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  test("10 hidden/visible + 4-page navigation cycles stay responsive with bounded requests, listeners, and no errors", async ({
    context,
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    const organization = await createE2EOrganization(tracked);
    // A realistic multi-region tenant (the production report had 11).
    for (let i = 0; i < 11; i++) {
      await createE2ERegion(tracked, { organizationId: organization.id });
    }
    const admin = await createE2EUser(tracked, {
      role: "ADMIN",
      organizationId: organization.id,
    });
    const token = await createE2ESession(tracked, admin.id);
    await addSessionCookie(context, token, baseURL!);

    // Count every focus/visibility-family listener registration so a
    // future accumulating listener is caught explicitly.
    await page.addInitScript(`
      window.__watch = { listeners: {}, intervals: 0 };
      const WATCHED = new Set(["focus", "blur", "visibilitychange", "pageshow", "pagehide", "online", "offline", "storage"]);
      const origAdd = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type, ...rest) {
        if (WATCHED.has(type)) window.__watch.listeners[type] = (window.__watch.listeners[type] || 0) + 1;
        return origAdd.call(this, type, ...rest);
      };
      const origRemove = EventTarget.prototype.removeEventListener;
      EventTarget.prototype.removeEventListener = function (type, ...rest) {
        if (WATCHED.has(type)) window.__watch.listeners[type] = (window.__watch.listeners[type] || 0) - 1;
        return origRemove.call(this, type, ...rest);
      };
      const origSI = window.setInterval;
      window.setInterval = (...a) => { window.__watch.intervals++; return origSI(...a); };
    `);

    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    let requestCount = 0;
    page.on("request", () => requestCount++);

    // Real login page load, authenticated via the injected session.
    await page.goto("/");
    await expect(page.getByText("Nöbet Yönetimi").first()).toBeVisible();

    // A background tab to make bringToFront produce REAL
    // visibilitychange transitions on the app tab.
    const backgroundTab = await context.newPage();
    await backgroundTab.goto("about:blank");
    await page.bringToFront();

    const navLinks: [string, string][] = [
      ["Panel", "/"],
      ["Eczaneler", "/eczaneler"],
      ["Nöbet Bölgeleri", "/bolgeler"],
      ["Nöbet Kuralları", "/kurallar"],
    ];

    const requestsPerCycle: number[] = [];
    for (let cycle = 1; cycle <= 10; cycle++) {
      const cycleStartRequests = requestCount;

      // Hide the app tab (real visibilitychange -> hidden), then return.
      await backgroundTab.bringToFront();
      await backgroundTab.waitForTimeout(300);
      await page.bringToFront();
      expect(await page.evaluate(() => document.visibilityState)).toBe("visible");

      // Main thread must respond promptly right after returning to the
      // tab — this is exactly where the freeze was reported.
      const t0 = Date.now();
      expect(await page.evaluate(() => 21 * 2)).toBe(42);
      expect(Date.now() - t0).toBeLessThan(2_000);

      // Navigate through four authenticated pages via real clicks
      // (client-side transitions on the same live React tree).
      for (const [label, path] of navLinks) {
        const navStart = Date.now();
        await page.click(`aside >> text="${label}"`);
        await page.waitForURL((url) => url.pathname === path, { timeout: 10_000 });
        expect(Date.now() - navStart, `navigation to ${path} in cycle ${cycle}`).toBeLessThan(
          10_000
        );
      }

      requestsPerCycle.push(requestCount - cycleStartRequests);
    }

    // No uncaught browser errors across the whole soak.
    expect(pageErrors).toEqual([]);

    // Request volume must not grow cycle-over-cycle (a refresh/polling
    // loop would trend upward): the last cycle may not exceed the
    // second cycle (steady state) by more than 2x, and every cycle
    // stays within an absolute bound for 4 client-side navigations.
    const steadyState = requestsPerCycle[1];
    const lastCycle = requestsPerCycle[requestsPerCycle.length - 1];
    expect(lastCycle, `cycles: ${requestsPerCycle.join(",")}`).toBeLessThanOrEqual(
      Math.max(steadyState * 2, 30)
    );
    for (const [index, count] of requestsPerCycle.entries()) {
      expect(count, `cycle ${index + 1} request count`).toBeLessThanOrEqual(60);
    }

    // No accumulation of focus/visibility-family listeners and no
    // uncontrolled polling: net registrations stay a small constant.
    const watch = await page.evaluate(
      () => (window as unknown as { __watch: { listeners: Record<string, number>; intervals: number } }).__watch
    );
    for (const [type, net] of Object.entries(watch.listeners)) {
      expect(net, `net ${type} listeners after 10 cycles`).toBeLessThanOrEqual(5);
    }
    expect(watch.intervals, "setInterval registrations").toBeLessThanOrEqual(2);

    await backgroundTab.close();
  });
});
