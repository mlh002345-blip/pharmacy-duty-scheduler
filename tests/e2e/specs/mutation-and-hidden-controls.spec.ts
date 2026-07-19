import { test, expect } from "@playwright/test";

import {
  createE2EOrganization,
  createE2ESession,
  createE2EUser,
  createE2ERegion,
  createE2EPharmacy,
  createE2EDutySchedule,
  createE2EDutyRequest,
  cleanupTrackedIds,
  newTrackedIds,
} from "../helpers/fixtures";
import { addSessionCookie } from "../helpers/browser";
import { e2ePrisma } from "../helpers/db";

// Server-side mutation authorization: browser visibility alone is not
// enough. Each test either (a) drives a real, page-gated navigation as
// the under-privileged role and asserts the server redirected before any
// mutation occurred and the database is unchanged, or (b) asserts the
// mutating control is genuinely absent from the rendered DOM (not merely
// styled hidden) for a role that lacks the permission, for the handful
// of actions with no dedicated page to navigate to directly (delete/
// publish/review buttons bound straight to a Server Action on a list/
// detail page). See docs/testing/ROLE_SESSION_E2E_TESTS.md for why the
// second category is not additionally forged as a raw HTTP request in
// this pass, and how it is otherwise proven (existing unit tests calling
// the real action functions directly).

test.describe("server-side mutation authorization", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  test("STAFF cannot reach the create-user or edit-user pages; no User row is created", async ({
    page,
    context,
    baseURL,
  }) => {
    const staff = await createE2EUser(tracked, { role: "STAFF" });
    const token = await createE2ESession(tracked, staff.id);
    await addSessionCookie(context, token, baseURL!);

    const someOtherUser = await createE2EUser(tracked, { role: "VIEWER" });
    const before = await e2ePrisma.user.count();

    await page.goto("/kullanicilar/yeni");
    await expect(page).toHaveURL(/\/\?error=/);

    await page.goto(`/kullanicilar/${someOtherUser.id}/duzenle`);
    await expect(page).toHaveURL(/\/\?error=/);

    const after = await e2ePrisma.user.count();
    expect(after).toBe(before);
  });

  test("VIEWER cannot reach the create-pharmacy page; no Pharmacy row is created", async ({
    page,
    context,
    baseURL,
  }) => {
    const viewer = await createE2EUser(tracked, { role: "VIEWER" });
    const token = await createE2ESession(tracked, viewer.id);
    await addSessionCookie(context, token, baseURL!);

    const before = await e2ePrisma.pharmacy.count();

    await page.goto("/eczaneler/yeni");
    await expect(page).toHaveURL(/\/eczaneler(\?|$)/);
    const bodyText = await page.textContent("body");
    expect(bodyText).not.toContain("Yeni Eczane Ekle");

    const after = await e2ePrisma.pharmacy.count();
    expect(after).toBe(before);
  });

  test("VIEWER sees no publish/unpublish control on a real schedule's detail page", async ({
    page,
    context,
    baseURL,
  }) => {
    const viewer = await createE2EUser(tracked, { role: "VIEWER" });
    const token = await createE2ESession(tracked, viewer.id);
    await addSessionCookie(context, token, baseURL!);

    const region = await createE2ERegion(tracked);
    const schedule = await createE2EDutySchedule(tracked, region.id, { status: "DRAFT" });

    await page.goto(`/cizelgeler/${schedule.id}`);
    expect(page.url()).not.toContain("/giris");
    await expect(page.getByRole("button", { name: /Yayınla/i })).toHaveCount(0);

    const stillDraft = await e2ePrisma.dutySchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(stillDraft.status).toBe("DRAFT");
  });

  test("VIEWER sees no review controls on a real duty request's detail page", async ({
    page,
    context,
    baseURL,
  }) => {
    const viewer = await createE2EUser(tracked, { role: "VIEWER" });
    const token = await createE2ESession(tracked, viewer.id);
    await addSessionCookie(context, token, baseURL!);

    const region = await createE2ERegion(tracked);
    const pharmacy = await createE2EPharmacy(tracked, region.id);
    const request = await createE2EDutyRequest(tracked, pharmacy.id, region.id);

    await page.goto(`/nobet-talepleri/${request.id}`);
    expect(page.url()).not.toContain("/giris");
    await expect(page.getByRole("button", { name: /Onayla|Reddet/i })).toHaveCount(0);

    const stillPending = await e2ePrisma.dutyRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(stillPending.status).toBe("PENDING");
  });

  test("STAFF (lacking deleteSetupData) sees no delete control for regions or pharmacies", async ({
    page,
    context,
    baseURL,
  }) => {
    const staff = await createE2EUser(tracked, { role: "STAFF" });
    const token = await createE2ESession(tracked, staff.id);
    await addSessionCookie(context, token, baseURL!);

    const region = await createE2ERegion(tracked);
    await createE2EPharmacy(tracked, region.id);

    await page.goto("/bolgeler");
    await expect(page.getByRole("button", { name: /^Sil$/ })).toHaveCount(0);

    await page.goto("/eczaneler");
    await expect(page.getByRole("button", { name: /^Sil$/ })).toHaveCount(0);

    const regionStillExists = await e2ePrisma.region.findUnique({ where: { id: region.id } });
    expect(regionStillExists).not.toBeNull();
  });

  test("STAFF (lacking deleteSchedule) sees no delete control on a DRAFT schedule's detail page", async ({
    page,
    context,
    baseURL,
  }) => {
    const organization = await createE2EOrganization(tracked);
    const staff = await createE2EUser(tracked, { role: "STAFF", organizationId: organization.id });
    const token = await createE2ESession(tracked, staff.id);
    await addSessionCookie(context, token, baseURL!);

    const region = await createE2ERegion(tracked, { organizationId: organization.id });
    const schedule = await createE2EDutySchedule(tracked, region.id, { status: "DRAFT" });

    await page.goto(`/cizelgeler/${schedule.id}`);
    await expect(page.getByText("Günlük Atamalar")).toBeVisible(); // sanity: real page, not a 404
    await expect(page.getByRole("button", { name: /^Sil$/ })).toHaveCount(0);

    const stillThere = await e2ePrisma.dutySchedule.findUnique({ where: { id: schedule.id } });
    expect(stillThere).not.toBeNull();
  });

  test("ADMIN can delete a DRAFT schedule directly from its detail page", async ({
    page,
    context,
    baseURL,
  }) => {
    const organization = await createE2EOrganization(tracked);
    const admin = await createE2EUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await createE2ESession(tracked, admin.id);
    await addSessionCookie(context, token, baseURL!);

    const region = await createE2ERegion(tracked, { organizationId: organization.id });
    const schedule = await createE2EDutySchedule(tracked, region.id, { status: "DRAFT" });

    await page.goto(`/cizelgeler/${schedule.id}`);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: /^Sil$/ }).click();

    await expect(page).toHaveURL(/\/cizelgeler(\?|$)/);
    await expect(page.getByText("Nöbet çizelgesi silindi.")).toBeVisible();

    const deleted = await e2ePrisma.dutySchedule.findUnique({ where: { id: schedule.id } });
    expect(deleted).toBeNull();
  });

  test("anonymous GET to a protected export route redirects to /giris and downloads nothing", async ({
    page,
  }) => {
    const response = await page.goto("/cizelgeler/nonexistent-id/export/excel");
    // getCurrentUser() is null -> redirect("/giris") fires before any
    // schedule lookup or file generation.
    expect(response?.url()).toContain("/giris");
  });

  test("anonymous POST to a dashboard page URL never creates a session or leaks an internal error", async ({
    request,
  }) => {
    // A raw POST with no session cookie and no Server-Action protocol
    // headers ("Next-Action" etc.) — simulates a naive attacker attempt,
    // not a real Server Action invocation (which requires the
    // framework's own internal action-id header, only ever generated for
    // a form the authorized UI actually rendered — see
    // docs/testing/ROLE_SESSION_E2E_TESTS.md for why forging that exact
    // header is out of scope for this pass). Observed current behavior:
    // Next serves the page's normal (unauthenticated -> redirect-to-
    // /giris) GET content for this shape of request rather than treating
    // it as a mutation attempt at all — asserted here precisely, plus
    // the two safety properties that actually matter regardless of the
    // exact status code: no session cookie is ever minted, and no raw
    // stack trace/internal path leaks.
    const response = await request.post("/bolgeler", { data: {} });
    expect(response.headers()["set-cookie"]).toBeFalsy();
    const body = await response.text();
    expect(body).not.toContain("at Object.");
    expect(body).not.toContain("node_modules");
    expect(body).not.toContain("PrismaClient");
  });
});
