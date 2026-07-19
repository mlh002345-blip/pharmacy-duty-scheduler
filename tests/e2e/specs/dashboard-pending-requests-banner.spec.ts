import { test, expect } from "@playwright/test";

import {
  createE2EDutyRequest,
  createE2EOrganization,
  createE2EPharmacy,
  createE2ERegion,
  createE2ESession,
  createE2EUser,
  cleanupTrackedIds,
  newTrackedIds,
} from "../helpers/fixtures";
import { addSessionCookie } from "../helpers/browser";
import { e2ePrisma } from "../helpers/db";

// Eczacıların /eczane-talep/[token] üzerinden gönderdiği mazeret/tercih
// talepleri, panelin "Kurulum Durumu" listesinde tek satıra gömülü kalıp
// gözden kaçmasın diye panelin en üstünde ayrı bir uyarı bandı olarak da
// gösterilir. Bu spec, banner'ın gerçek tarayıcıda görünürlüğünü,
// EMERGENCY_EXCUSE tipi için farklı (kırmızı) stilini, hiç bekleyen talep
// yokken görünmediğini ve organizasyonlar arası izolasyonu doğrular.
test.describe("dashboard pending duty request banner (real browser, real Postgres)", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  test("shows a warning banner with pharmacy name and request type when a request is pending", async ({
    context,
    page,
    baseURL,
  }) => {
    const organization = await createE2EOrganization(tracked);
    const region = await createE2ERegion(tracked, { organizationId: organization.id });
    const pharmacy = await createE2EPharmacy(tracked, region.id);
    const admin = await createE2EUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await createE2ESession(tracked, admin.id);
    await addSessionCookie(context, token, baseURL!);

    await createE2EDutyRequest(tracked, pharmacy.id, region.id);

    await page.goto("/");
    const banner = page.getByRole("link", { name: /İncelenmemiş 1 nöbet talebi var/ });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(pharmacy.name);
    await expect(banner).toContainText("Nöbet Tutamama");

    await banner.click();
    await expect(page).toHaveURL("/nobet-talepleri");
  });

  test("uses the urgent (destructive) style and mentions the emergency count when an EMERGENCY_EXCUSE is pending", async ({
    context,
    page,
    baseURL,
  }) => {
    const organization = await createE2EOrganization(tracked);
    const region = await createE2ERegion(tracked, { organizationId: organization.id });
    const pharmacy = await createE2EPharmacy(tracked, region.id);
    const admin = await createE2EUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await createE2ESession(tracked, admin.id);
    await addSessionCookie(context, token, baseURL!);

    const request = await e2ePrisma.dutyRequest.create({
      data: {
        pharmacyId: pharmacy.id,
        regionId: region.id,
        requestType: "EMERGENCY_EXCUSE",
        startDate: new Date("2030-02-10"),
        endDate: new Date("2030-02-11"),
        explanation: "E2E acil mazeret.",
        status: "PENDING",
        source: "PUBLIC_LINK",
      },
    });
    tracked.dutyRequestIds.push(request.id);

    await page.goto("/");
    const banner = page.getByRole("link", { name: /İncelenmemiş 1 nöbet talebi var/ });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("acil mazeret");
    await expect(banner).toContainText("Acil Mazeret");
    await expect(banner).toHaveClass(/border-destructive/);
  });

  test("shows no banner when there are no pending requests", async ({ context, page, baseURL }) => {
    const organization = await createE2EOrganization(tracked);
    await createE2ERegion(tracked, { organizationId: organization.id });
    const admin = await createE2EUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await createE2ESession(tracked, admin.id);
    await addSessionCookie(context, token, baseURL!);

    await page.goto("/");
    await expect(page.getByText(/İncelenmemiş .* nöbet talebi var/)).toHaveCount(0);
  });

  test("Organization A's dashboard never shows Organization B's pending request", async ({
    context,
    page,
    baseURL,
  }) => {
    const organizationA = await createE2EOrganization(tracked);
    const organizationB = await createE2EOrganization(tracked);
    const regionB = await createE2ERegion(tracked, { organizationId: organizationB.id });
    const pharmacyB = await createE2EPharmacy(tracked, regionB.id);
    const adminA = await createE2EUser(tracked, { role: "ADMIN", organizationId: organizationA.id });
    const token = await createE2ESession(tracked, adminA.id);
    await addSessionCookie(context, token, baseURL!);

    await createE2EDutyRequest(tracked, pharmacyB.id, regionB.id);

    await page.goto("/");
    await expect(page.getByText(/İncelenmemiş .* nöbet talebi var/)).toHaveCount(0);
  });
});
