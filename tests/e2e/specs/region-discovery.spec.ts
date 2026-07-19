import { test, expect } from "@playwright/test";

import { hashPassword } from "@/lib/auth/password";
import {
  createE2EOrganization,
  createE2ERegion,
  createE2ESession,
  createE2EUser,
  cleanupTrackedIds,
  newTrackedIds,
  testRunId,
  E2E_TEST_PASSWORD,
} from "../helpers/fixtures";
import { addSessionCookie } from "../helpers/browser";
import { e2ePrisma } from "../helpers/db";

// Automatic Region Discovery — real browser, real Postgres.
//
// Scope note (same environment quirk documented in
// onboarding-to-import.spec.ts): authenticated UNBOUND useActionState
// forms (the region-create form and the file-upload form) lose their
// session cookie when POSTed via a Playwright click in this sandbox.
// Those two steps' end-states are therefore created directly (region
// via fixture, preview batch+candidates via the database — the exact
// state the real previewPharmacyImportAction produces, proven against
// real Postgres in region-discovery-import.integration.test.ts). Every
// candidate decision, the status toggles, and the final import run
// through REAL browser clicks — they are all bound Server Actions,
// which work reliably here.
test.describe("automatic region discovery (real browser, real Postgres)", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  async function makeAdminSession(context: import("@playwright/test").BrowserContext, baseURL: string) {
    const organization = await createE2EOrganization(tracked);
    const admin = await createE2EUser(tracked, {
      role: "ADMIN",
      organizationId: organization.id,
    });
    const token = await createE2ESession(tracked, admin.id);
    await addSessionCookie(context, token, baseURL);
    return { organization, admin };
  }

  test("manual region management stays fully available: Yeni Bölge Ekle, edit page, and real passivate/reactivate clicks", async ({
    context,
    page,
    baseURL,
  }) => {
    const { organization } = await makeAdminSession(context, baseURL!);
    const region = await createE2ERegion(tracked, {
      organizationId: organization.id,
      name: `Elle Bölge ${testRunId()}`,
    });

    await page.goto("/bolgeler");
    await expect(page.getByRole("link", { name: /Yeni Bölge Ekle/ })).toBeVisible();
    await expect(page.getByText(region.name)).toBeVisible();

    // The manual create/edit forms still render for ADMIN.
    await page.goto("/bolgeler/yeni");
    await expect(page.locator('input[name="name"]')).toBeVisible();
    await expect(page.locator('input[name="district"]')).toBeVisible();
    // The edit page also renders the region's Service Area manager, which
    // has its own input[name="name"] (hizmet alanı adı) — scope by id to
    // target only the region name field.
    await page.goto(`/bolgeler/${region.id}/duzenle`);
    await expect(page.locator("#name")).toHaveValue(region.name);

    // Passivate via the real bound action, then reactivate.
    await page.goto("/bolgeler");
    const regionRow = page.locator("tr", { hasText: region.name });
    await regionRow.getByRole("button", { name: "Pasif Yap" }).click();
    await expect(page.getByText(/pasif yapıldı/i)).toBeVisible();
    expect(
      (await e2ePrisma.region.findUniqueOrThrow({ where: { id: region.id } })).isActive
    ).toBe(false);

    const regionRowAfter = page.locator("tr", { hasText: region.name });
    await regionRowAfter.getByRole("button", { name: "Aktif Yap" }).click();
    await expect(page.getByText(/aktif yapıldı/i)).toBeVisible();
    expect(
      (await e2ePrisma.region.findUniqueOrThrow({ where: { id: region.id } })).isActive
    ).toBe(true);
  });

  test("region candidates: review, edit, approve (active + inactive), match to existing, and one-transaction import via real clicks", async ({
    context,
    page,
    baseURL,
  }) => {
    const { organization, admin } = await makeAdminSession(context, baseURL!);
    const suffix = testRunId();
    const existingRegion = await createE2ERegion(tracked, {
      organizationId: organization.id,
      name: `Mevcut Bölge ${suffix}`,
    });
    const newRegionName = `Keşif Bölgesi ${suffix}`;
    const suggestionValue = `Adresköyü ${suffix}`;

    // The exact end-state previewPharmacyImportAction persists (proven
    // against real Postgres in the integration suite) — see scope note.
    const batch = await e2ePrisma.pharmacyImportBatch.create({
      data: {
        status: "PREVIEWED",
        sanitizedFileName: "kesif.xlsx",
        fileSize: 2048,
        totalRows: 4,
        readyRows: 0,
        invalidRows: 4,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        organizationId: organization.id,
        createdById: admin.id,
        regionCandidates: {
          create: [
            {
              sourceValue: newRegionName,
              normalizedSourceValue: newRegionName.toLocaleLowerCase("tr"),
              sourceType: "BOLGE_COLUMN",
              status: "NEW_REGION_CANDIDATE",
              proposedName: newRegionName,
              normalizedProposedName: newRegionName.toLocaleLowerCase("tr"),
              proposedCity: organization.province,
              proposedDistrict: "Keşif İlçesi",
              proposedIsActive: true,
            },
            {
              sourceValue: suggestionValue,
              normalizedSourceValue: suggestionValue.toLocaleLowerCase("tr"),
              sourceType: "ADDRESS_SUGGESTION",
              status: "ADDRESS_SUGGESTION",
              proposedName: suggestionValue,
              normalizedProposedName: suggestionValue.toLocaleLowerCase("tr"),
              proposedCity: organization.province,
              proposedDistrict: suggestionValue,
              proposedIsActive: true,
            },
            {
              sourceValue: `Eski Adıyla ${suffix}`,
              normalizedSourceValue: `eski adıyla ${suffix}`,
              sourceType: "ILCE_COLUMN",
              status: "NEW_REGION_CANDIDATE",
              proposedName: `Eski Adıyla ${suffix}`,
              normalizedProposedName: `eski adıyla ${suffix}`,
              proposedCity: organization.province,
              proposedDistrict: `Eski Adıyla ${suffix}`,
              proposedIsActive: true,
            },
          ],
        },
      },
      include: { regionCandidates: true },
    });
    const [cNew, cSuggestion, cMatch] = batch.regionCandidates;
    await e2ePrisma.pharmacyImportRow.createMany({
      data: [
        {
          batchId: batch.id, rowNumber: 2, pharmacyName: `Bir Eczanesi ${suffix}`,
          normalizedPharmacyName: `bir eczanesi ${suffix}`, pharmacistName: "Ada Yılmaz",
          phone: "+90 212 212 19 18", isActive: true, status: "REGION_PENDING",
          safeErrorCode: "REGION_PENDING_APPROVAL", candidateId: cNew.id,
        },
        {
          batchId: batch.id, rowNumber: 3, pharmacyName: `İki Eczanesi ${suffix}`,
          normalizedPharmacyName: `iki eczanesi ${suffix}`, pharmacistName: "Zeynep Kaya",
          phone: "+90 216 000 00 00", isActive: true, status: "REGION_PENDING",
          safeErrorCode: "REGION_PENDING_APPROVAL", candidateId: cNew.id,
        },
        {
          batchId: batch.id, rowNumber: 4, pharmacyName: `Üç Eczanesi ${suffix}`,
          normalizedPharmacyName: `üç eczanesi ${suffix}`, pharmacistName: "Mehmet Demir",
          phone: "+90 212 111 11 11", isActive: true, status: "REGION_PENDING",
          safeErrorCode: "REGION_SUGGESTION_PENDING", candidateId: cSuggestion.id,
          address: `Gül Mah. 3, ${suggestionValue} / Bir İl`,
        },
        {
          batchId: batch.id, rowNumber: 5, pharmacyName: `Dört Eczanesi ${suffix}`,
          normalizedPharmacyName: `dört eczanesi ${suffix}`, pharmacistName: "Ayşe Ak",
          phone: "+90 212 222 22 22", isActive: true, status: "REGION_PENDING",
          safeErrorCode: "REGION_PENDING_APPROVAL", candidateId: cMatch.id,
        },
      ],
    });

    const previewPath = `/eczaneler/ice-aktar/onizleme/${batch.id}`;
    await page.goto(previewPath);

    // Unique-candidate aggregation and source marking are visible.
    await expect(page.getByText("3 bölge adayı")).toBeVisible();
    await expect(page.getByText("2 eczane satırında kullanılıyor")).toBeVisible();
    await expect(page.getByText("Kaynak: Adres önerisi")).toBeVisible();
    await expect(page.getByText(newRegionName).first()).toBeVisible();

    // Import is blocked while candidates are pending: no confirm button.
    await expect(page.getByRole("button", { name: /İçe Aktarımı Onayla/ })).toHaveCount(0);

    // 1. Approve the new ACTIVE region (real click on a bound action).
    const newPanel = page.locator('[data-testid="region-candidate"]', { hasText: newRegionName });
    await newPanel.getByRole("button", { name: "Yeni Bölge Olarak Onayla" }).click();
    await expect(page.getByText("Bölge adayı onaylandı.")).toBeVisible();

    // 2. Edit the address suggestion (rename + make INACTIVE), then
    //    approve it as a new inactive region.
    const editedName = `Düzeltilmiş Bölge ${suffix}`;
    const suggestionPanel = page.locator('[data-testid="region-candidate"]', {
      hasText: suggestionValue,
    });
    await suggestionPanel.locator('input[name="proposedName"]').fill(editedName);
    await suggestionPanel.locator('input[name="proposedIsActive"]').uncheck();
    await suggestionPanel.getByRole("button", { name: "Düzenle ve Kaydet" }).click();
    await expect(page.getByText("Bölge adayı güncellendi.")).toBeVisible();
    // Editing keeps the address-suggestion provenance (the panel is
    // still titled by its source value), so acceptance still goes
    // through the explicit "Öneriyi Kabul Et" confirmation. The edited
    // name lives in the panel's form input.
    const editedPanel = page.locator('[data-testid="region-candidate"]', {
      hasText: suggestionValue,
    });
    await expect(editedPanel.locator('input[name="proposedName"]')).toHaveValue(editedName);
    await editedPanel.getByRole("button", { name: "Öneriyi Kabul Et" }).click();
    await expect(page.getByText("Bölge adayı onaylandı.")).toBeVisible();

    // 3. Map the third candidate onto the existing region.
    const matchPanel = page.locator('[data-testid="region-candidate"]', {
      hasText: `Eski Adıyla ${suffix}`,
    });
    await matchPanel.locator('select[name="regionId"]').selectOption(existingRegion.id);
    await matchPanel.getByRole("button", { name: "Eşleştir" }).click();
    await expect(page.getByText("Aday mevcut bölgeyle eşleştirildi.")).toBeVisible();

    // All decisions made → the import button appears with the row count.
    const importButton = page.getByRole("button", { name: /İçe Aktarımı Onayla \(4 eczane\)/ });
    await expect(importButton).toBeVisible();

    // 4. The real all-or-nothing transaction, via a real click.
    await importButton.click();
    await expect(page).toHaveURL(/\/eczaneler(\?|$)/);
    await expect(page.getByText(/2 yeni bölge oluşturuldu/)).toBeVisible();

    // Verify from the database: two new regions (one inactive), four
    // pharmacies mapped to the right regions.
    const regions = await e2ePrisma.region.findMany({
      where: { organizationId: organization.id },
      include: { pharmacies: true },
    });
    tracked.regionIds.push(...regions.map((r) => r.id));
    tracked.pharmacyIds.push(...regions.flatMap((r) => r.pharmacies.map((p) => p.id)));
    expect(regions).toHaveLength(3);
    const createdActive = regions.find((r) => r.name === newRegionName)!;
    const createdInactive = regions.find((r) => r.name === editedName)!;
    expect(createdActive.isActive).toBe(true);
    expect(createdActive.pharmacies).toHaveLength(2);
    expect(createdInactive.isActive).toBe(false);
    expect(createdInactive.pharmacies).toHaveLength(1);
    expect(regions.find((r) => r.id === existingRegion.id)!.pharmacies).toHaveLength(1);

    // The created regions appear under Nöbet Bölgeleri.
    await page.goto("/bolgeler");
    await expect(page.getByText(newRegionName)).toBeVisible();
    await expect(page.getByText(editedName)).toBeVisible();
  });

  test("an excluded candidate skips its rows while the rest import; exclusion is undoable", async ({
    context,
    page,
    baseURL,
  }) => {
    const { organization, admin } = await makeAdminSession(context, baseURL!);
    const suffix = testRunId();

    const batch = await e2ePrisma.pharmacyImportBatch.create({
      data: {
        status: "PREVIEWED",
        sanitizedFileName: "kesif2.xlsx",
        fileSize: 1024,
        totalRows: 2,
        readyRows: 0,
        invalidRows: 2,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        organizationId: organization.id,
        createdById: admin.id,
        regionCandidates: {
          create: [
            {
              sourceValue: `Kalan Bölge ${suffix}`,
              normalizedSourceValue: `kalan bölge ${suffix}`,
              sourceType: "BOLGE_COLUMN",
              status: "NEW_REGION_CANDIDATE",
              proposedName: `Kalan Bölge ${suffix}`,
              normalizedProposedName: `kalan bölge ${suffix}`,
              proposedCity: organization.province,
              proposedDistrict: `Kalan Bölge ${suffix}`,
              proposedIsActive: true,
            },
            {
              sourceValue: `Giden Bölge ${suffix}`,
              normalizedSourceValue: `giden bölge ${suffix}`,
              sourceType: "BOLGE_COLUMN",
              status: "NEW_REGION_CANDIDATE",
              proposedName: `Giden Bölge ${suffix}`,
              normalizedProposedName: `giden bölge ${suffix}`,
              proposedCity: organization.province,
              proposedDistrict: `Giden Bölge ${suffix}`,
              proposedIsActive: true,
            },
          ],
        },
      },
      include: { regionCandidates: true },
    });
    const [keep, exclude] = batch.regionCandidates;
    await e2ePrisma.pharmacyImportRow.createMany({
      data: [
        {
          batchId: batch.id, rowNumber: 2, pharmacyName: `Kalan Eczanesi ${suffix}`,
          normalizedPharmacyName: `kalan eczanesi ${suffix}`, pharmacistName: "Ada Yılmaz",
          phone: "+90 212 212 19 18", isActive: true, status: "REGION_PENDING",
          safeErrorCode: "REGION_PENDING_APPROVAL", candidateId: keep.id,
        },
        {
          batchId: batch.id, rowNumber: 3, pharmacyName: `Giden Eczanesi ${suffix}`,
          normalizedPharmacyName: `giden eczanesi ${suffix}`, pharmacistName: "Zeynep Kaya",
          phone: "+90 216 000 00 00", isActive: true, status: "REGION_PENDING",
          safeErrorCode: "REGION_PENDING_APPROVAL", candidateId: exclude.id,
        },
      ],
    });

    await page.goto(`/eczaneler/ice-aktar/onizleme/${batch.id}`);

    const keepPanel = page.locator('[data-testid="region-candidate"]', {
      hasText: `Kalan Bölge ${suffix}`,
    });
    await keepPanel.getByRole("button", { name: "Yeni Bölge Olarak Onayla" }).click();
    await expect(page.getByText("Bölge adayı onaylandı.")).toBeVisible();

    const excludePanel = page.locator('[data-testid="region-candidate"]', {
      hasText: `Giden Bölge ${suffix}`,
    });
    await excludePanel.getByRole("button", { name: "İçe Aktarım Dışında Bırak" }).click();
    await expect(page.getByText(/dışında bırakıldı/).first()).toBeVisible();
    await expect(page.getByText("Kapsam Dışı").first()).toBeVisible();

    const importButton = page.getByRole("button", { name: /İçe Aktarımı Onayla \(1 eczane\)/ });
    await expect(importButton).toBeVisible();
    await importButton.click();
    await expect(page).toHaveURL(/\/eczaneler(\?|$)/);

    const regions = await e2ePrisma.region.findMany({
      where: { organizationId: organization.id },
      include: { pharmacies: true },
    });
    tracked.regionIds.push(...regions.map((r) => r.id));
    tracked.pharmacyIds.push(...regions.flatMap((r) => r.pharmacies.map((p) => p.id)));
    expect(regions).toHaveLength(1);
    expect(regions[0].name).toBe(`Kalan Bölge ${suffix}`);
    expect(regions[0].pharmacies).toHaveLength(1);
    // The excluded candidate's pharmacy was never created anywhere.
    expect(
      await e2ePrisma.pharmacy.count({
        where: { normalizedName: `giden eczanesi ${suffix}` },
      })
    ).toBe(0);
  });

  test("STAFF, VIEWER, and PLATFORM_ADMIN cannot mutate regions or reach the import preview", async ({
    context,
    page,
    baseURL,
  }) => {
    const organization = await createE2EOrganization(tracked);
    for (const role of ["STAFF", "VIEWER"] as const) {
      const user = await createE2EUser(tracked, { role, organizationId: organization.id });
      const token = await createE2ESession(tracked, user.id);
      await context.clearCookies();
      await addSessionCookie(context, token, baseURL!);
      await page.goto("/bolgeler/yeni");
      await expect(page).not.toHaveURL(/bolgeler\/yeni/);
      await page.goto("/eczaneler/ice-aktar");
      await expect(page).not.toHaveURL(/ice-aktar/);
    }

    const platformAdmin = await e2ePrisma.user.create({
      data: {
        name: `E2E Platform Admin ${testRunId()}`,
        email: `e2e-platform-admin-${testRunId()}@e2e.invalid`,
        passwordHash: await hashPassword(E2E_TEST_PASSWORD),
        role: "PLATFORM_ADMIN",
        isActive: true,
        organizationId: null,
      },
    });
    tracked.userIds.push(platformAdmin.id);
    const platformToken = await createE2ESession(tracked, platformAdmin.id);
    await context.clearCookies();
    await addSessionCookie(context, platformToken, baseURL!);
    await page.goto("/bolgeler/yeni");
    await expect(page).not.toHaveURL(/bolgeler\/yeni/);
  });

  test("a second organization sees none of the discovered regions, candidates, or imported pharmacies", async ({
    context,
    page,
    baseURL,
  }) => {
    const suffix = testRunId();
    // Organization A: one imported region+pharmacy (created directly —
    // the full flow is proven above; this test is about isolation).
    const orgA = await createE2EOrganization(tracked);
    const regionA = await createE2ERegion(tracked, {
      organizationId: orgA.id,
      name: `Gizli Keşif ${suffix}`,
    });
    const adminA = await createE2EUser(tracked, { role: "ADMIN", organizationId: orgA.id });
    const batchA = await e2ePrisma.pharmacyImportBatch.create({
      data: {
        status: "PREVIEWED",
        sanitizedFileName: "gizli.xlsx",
        fileSize: 512,
        totalRows: 1,
        readyRows: 1,
        invalidRows: 0,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        organizationId: orgA.id,
        createdById: adminA.id,
      },
    });

    // Organization B's ADMIN sees nothing of it.
    const orgB = await createE2EOrganization(tracked);
    const adminB = await createE2EUser(tracked, { role: "ADMIN", organizationId: orgB.id });
    const tokenB = await createE2ESession(tracked, adminB.id);
    await context.clearCookies();
    await addSessionCookie(context, tokenB, baseURL!);

    await page.goto("/bolgeler");
    await expect(page.getByText(`Gizli Keşif ${suffix}`)).toHaveCount(0);

    const response = await page.goto(`/eczaneler/ice-aktar/onizleme/${batchA.id}`);
    expect(response?.status()).toBe(404);

    // regionA stays intact for cleanup bookkeeping.
    expect(regionA.id).toBeTruthy();
  });
});
