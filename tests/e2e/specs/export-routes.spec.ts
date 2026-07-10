import { test, expect } from "@playwright/test";

import {
  createE2EUser,
  createE2ESession,
  createE2ERegion,
  createE2EDutySchedule,
  cleanupTrackedIds,
  newTrackedIds,
} from "../helpers/fixtures";
import { addSessionCookie } from "../helpers/browser";

test.describe("export / route-handler authorization", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  test("ADMIN, STAFF, and VIEWER all get the Excel export (exportSchedule is held by every role); anonymous is redirected", async ({
    browser,
    baseURL,
  }) => {
    const region = await createE2ERegion(tracked);
    const schedule = await createE2EDutySchedule(tracked, region.id);

    for (const role of ["ADMIN", "STAFF", "VIEWER"] as const) {
      const user = await createE2EUser(tracked, { role });
      const token = await createE2ESession(tracked, user.id);
      const ctx = await browser.newContext();
      await addSessionCookie(ctx, token, baseURL!);
      const response = await ctx.request.get(`/cizelgeler/${schedule.id}/export/excel`);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("spreadsheetml");
      expect(response.headers()["x-request-id"]).toBeTruthy();
      await ctx.close();
    }

    const anonResponse = await (await browser.newContext()).request.get(
      `/cizelgeler/${schedule.id}/export/excel`,
      { maxRedirects: 0 }
    );
    expect([302, 307]).toContain(anonResponse.status());
  });

  test("PDF export follows the same authorization contract as Excel", async ({ browser, baseURL }) => {
    const region = await createE2ERegion(tracked);
    const schedule = await createE2EDutySchedule(tracked, region.id, { month: 2 });

    const admin = await createE2EUser(tracked, { role: "ADMIN" });
    const token = await createE2ESession(tracked, admin.id);
    const ctx = await browser.newContext();
    await addSessionCookie(ctx, token, baseURL!);
    const response = await ctx.request.get(`/cizelgeler/${schedule.id}/export/pdf`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("pdf");
    expect(response.headers()["x-request-id"]).toBeTruthy();
    await ctx.close();
  });

  test("the historical-template route (manageSetupData-gated) rejects VIEWER with a controlled 403, and allows ADMIN", async ({
    browser,
    baseURL,
  }) => {
    const viewer = await createE2EUser(tracked, { role: "VIEWER" });
    const viewerToken = await createE2ESession(tracked, viewer.id);
    const viewerCtx = await browser.newContext();
    await addSessionCookie(viewerCtx, viewerToken, baseURL!);
    const viewerResponse = await viewerCtx.request.get("/gecmis-nobetler/sablon");
    expect(viewerResponse.status()).toBe(403);
    const body = await viewerResponse.json();
    expect(body.message).toBe("Bu işlem için yetkiniz bulunmuyor.");
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain("at Object.");
    expect(bodyText).not.toContain("node_modules");
    await viewerCtx.close();

    const admin = await createE2EUser(tracked, { role: "ADMIN" });
    const adminToken = await createE2ESession(tracked, admin.id);
    const adminCtx = await browser.newContext();
    await addSessionCookie(adminCtx, adminToken, baseURL!);
    const adminResponse = await adminCtx.request.get("/gecmis-nobetler/sablon");
    expect(adminResponse.status()).toBe(200);
    expect(adminResponse.headers()["content-type"]).toContain("spreadsheetml");
    await adminCtx.close();
  });

  test("anonymous requests to all three export/download routes are rejected, never a raw stack trace", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const routes = [
      "/cizelgeler/some-id/export/excel",
      "/cizelgeler/some-id/export/pdf",
      "/gecmis-nobetler/sablon",
    ];
    for (const route of routes) {
      const response = await ctx.request.get(route, { maxRedirects: 0 });
      expect([302, 307]).toContain(response.status());
      const location = response.headers()["location"] ?? "";
      expect(location).toContain("/giris");
    }
    await ctx.close();
  });
});
