import { test, expect } from "@playwright/test";

import {
  createE2EOrganization,
  createE2EPharmacy,
  createE2ERegion,
  createE2ESession,
  createE2EUser,
  cleanupTrackedIds,
  newTrackedIds,
  testRunId,
} from "../helpers/fixtures";
import { addSessionCookie } from "../helpers/browser";
import { e2ePrisma } from "../helpers/db";

// Konum bazlı nöbet — ServiceArea UI: bölge düzenleme sayfasındaki hizmet
// alanı yöneticisi (gerçek tıklamalarla oluştur/sil) ve eczane düzenleme
// formundaki bölgeye göre filtrelenen hizmet alanı seçimi.
//
// Region edit page's create form and DeleteButton are bound Server
// Actions (createServiceAreaAction.bind(null, regionId),
// deleteServiceAreaAction.bind(null, regionId, area.id)) — real-click
// submission is unaffected by the unbound-action cookie quirk documented
// in onboarding-to-import.spec.ts. The pharmacy CREATE form uses an
// unbound action for the same reason that quirk excludes it elsewhere in
// this suite; this spec instead exercises the pharmacy EDIT form, which
// is bound (updatePharmacyAction.bind(null, id)).
test.describe("service areas (real browser, real Postgres)", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  test("creates and deletes a service area from the region edit page", async ({
    context,
    page,
    baseURL,
  }) => {
    const organization = await createE2EOrganization(tracked);
    const region = await createE2ERegion(tracked, { organizationId: organization.id });
    const admin = await createE2EUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await createE2ESession(tracked, admin.id);
    await addSessionCookie(context, token, baseURL!);

    await page.goto(`/bolgeler/${region.id}/duzenle`);
    await expect(page.getByText("Hizmet Alanları")).toBeVisible();
    await expect(page.getByText("Bu bölgede henüz bir hizmet alanı tanımlanmadı.")).toBeVisible();

    const areaName = `Üniversite Yakını ${testRunId()}`;
    await page.fill("#serviceAreaName", areaName);
    await page.click('button[type="submit"]:has-text("Ekle")');
    await expect(page.getByText(areaName)).toBeVisible();
    await expect(page.getByText("0 eczane")).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Sil" }).click();
    await expect(page.getByText(areaName)).toHaveCount(0);
    await expect(page.getByText("Bu bölgede henüz bir hizmet alanı tanımlanmadı.")).toBeVisible();
  });

  test("tags a pharmacy with a same-region service area via the edit form, and the list shows it", async ({
    context,
    page,
    baseURL,
  }) => {
    const organization = await createE2EOrganization(tracked);
    const region = await createE2ERegion(tracked, { organizationId: organization.id });
    const admin = await createE2EUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await createE2ESession(tracked, admin.id);
    await addSessionCookie(context, token, baseURL!);

    const areaName = `Sahil ${testRunId()}`;
    const serviceArea = await e2ePrisma.serviceArea.create({
      data: { name: areaName, regionId: region.id },
    });
    const pharmacy = await createE2EPharmacy(tracked, region.id);

    await page.goto(`/eczaneler/${pharmacy.id}/duzenle`);
    // The pharmacy's own region is already selected by default, so the
    // service area select starts enabled — the disabled-until-a-region-is-
    // picked behavior only applies on the create form (not exercised here
    // due to its unbound-action real-click limitation, see file header).
    await expect(page.locator("#serviceAreaId")).toBeEnabled();
    await page.selectOption("#serviceAreaId", serviceArea.id);
    await page.click('button[type="submit"]:has-text("Kaydet")');

    await expect(page).toHaveURL(/\/eczaneler(\?|$)/);
    const row = page.locator("tr", { hasText: pharmacy.name });
    await expect(row).toContainText(areaName);

    const updated = await e2ePrisma.pharmacy.findUnique({ where: { id: pharmacy.id } });
    expect(updated?.serviceAreaId).toBe(serviceArea.id);
  });
});
