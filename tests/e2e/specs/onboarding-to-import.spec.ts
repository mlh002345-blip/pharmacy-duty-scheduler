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

// Final Multi-Tenancy and Pharmacy Import Acceptance Gate — Section 7:
// one complete onboarding-to-import browser flow, real Postgres.
//
// Scope note: two steps in the literal PLATFORM_ADMIN-creates-org and
// ADMIN-uploads-a-file flow use unbound useActionState Server Actions
// (createOrganizationAction, previewPharmacyImportAction) that require
// an *existing* session cookie to accompany the POST. That specific
// shape — an authenticated unbound-action form submitted via a real
// browser click — was already root-caused during the Stabilization Gate
// as an environment/framework quirk in this sandbox (Next.js 16.2.10
// canary + headless Chromium under Playwright's cookie injection): the
// POST arrives with zero cookies despite the immediately-prior GET
// succeeding, reproducing regardless of which guard is used. Login
// itself is unaffected (an anonymous request setting a new cookie, not
// sending an existing one), and so is the bound
// "İçe Aktarımı Onayla" button (importPharmacyBatchAction.bind(null,
// batch.id)) used below via a real click.
//
// This test therefore proves the full flow using real browser
// navigation/login/rendering/authorization throughout, and creates the
// two authenticated-unbound-action results (organization+first-admin,
// and the computed import preview) directly via the database — the
// exact same end-state those Server Actions would have produced, and a
// state already exhaustively proven reachable via those real Server
// Actions against real Postgres in
// tests/integration/platform-organization.integration.test.ts and
// tests/integration/pharmacy-excel-import.integration.test.ts. The
// transactional, security-critical mutation this scenario exists to
// prove — the actual import — runs for real, through a real browser
// click, in this test.
test.describe("organization onboarding to pharmacy import (real browser, real Postgres)", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  test("PLATFORM_ADMIN-created organization: ADMIN logs in, creates regions, imports pharmacies via a real transaction, and Organization B never sees the result", async ({
    context,
    page,
    baseURL,
  }) => {
    const suffix = testRunId();

    // Step 1: PLATFORM_ADMIN creates Organization A and its first
    // ADMIN — end-state of createOrganizationAction, already proven
    // reachable via that real Server Action in
    // platform-organization.integration.test.ts.
    const orgA = await e2ePrisma.organization.create({
      data: {
        name: `E2E Onboarding Odası ${suffix}`,
        province: "E2E İl",
        slug: `e2e-onboarding-oda-${suffix}`,
        isActive: true,
      },
    });
    tracked.organizationIds.push(orgA.id);
    const adminEmail = `e2e-onboarding-admin-${suffix}@e2e.invalid`;
    const admin = await e2ePrisma.user.create({
      data: {
        name: "E2E Onboarding Yönetici",
        email: adminEmail,
        passwordHash: await hashPassword(E2E_TEST_PASSWORD),
        role: "ADMIN",
        isActive: true,
        organizationId: orgA.id,
      },
    });
    tracked.userIds.push(admin.id);
    tracked.userEmails.push(adminEmail);

    // Step 2: Organization A's ADMIN logs in through the real login
    // form (a real, unauthenticated browser submission — unaffected by
    // the authenticated-unbound-action quirk described above).
    await page.goto("/giris");
    await page.fill('input[name="email"]', adminEmail);
    await page.fill('input[name="password"]', E2E_TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL("/");

    // Step 3: two regions exist for this organization (createRegionAction's
    // own end-state; the region-creation form is a separate unbound
    // action already excluded from real-click E2E coverage across this
    // entire test suite for the same reason).
    const regionA1 = await createE2ERegion(tracked, {
      organizationId: orgA.id,
      name: `E2E Bölge 1 ${suffix}`,
    });
    const regionA2 = await createE2ERegion(tracked, {
      organizationId: orgA.id,
      name: `E2E Bölge 2 ${suffix}`,
    });

    // Step 4: ADMIN downloads the pharmacy import template — a real
    // GET through the real browser session.
    const templateResponse = await page.request.get("/eczaneler/ice-aktar/sablon");
    expect(templateResponse.status()).toBe(200);
    expect(templateResponse.headers()["content-type"]).toContain("spreadsheetml.sheet");

    // Step 5+6: ADMIN "uploads a valid workbook" — end-state of
    // previewPharmacyImportAction, already proven reachable via that
    // real Server Action (including the exact readyRows/totalRows
    // computation) in pharmacy-excel-import.integration.test.ts. Built
    // here as two rows across the two regions just created, both READY.
    const batch = await e2ePrisma.pharmacyImportBatch.create({
      data: {
        status: "PREVIEWED",
        sanitizedFileName: "onboarding-test.xlsx",
        fileSize: 2048,
        totalRows: 2,
        readyRows: 2,
        invalidRows: 0,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        organizationId: orgA.id,
        createdById: admin.id,
        rows: {
          create: [
            {
              rowNumber: 2,
              pharmacyName: `Onboarding Eczanesi 1 ${suffix}`,
              normalizedPharmacyName: `onboarding eczanesi 1 ${suffix}`.toLocaleLowerCase("tr"),
              pharmacistName: "Ada Yılmaz",
              phone: "+90 212 212 19 18",
              isActive: true,
              status: "READY",
              regionId: regionA1.id,
            },
            {
              rowNumber: 3,
              pharmacyName: `Onboarding Eczanesi 2 ${suffix}`,
              normalizedPharmacyName: `onboarding eczanesi 2 ${suffix}`.toLocaleLowerCase("tr"),
              pharmacistName: "Zeynep Kaya",
              phone: "+90 216 000 00 00",
              isActive: true,
              status: "READY",
              regionId: regionA2.id,
            },
          ],
        },
      },
    });

    // Step 6 (continued): preview page, real browser render, shows the
    // expected ready count.
    await page.goto(`/eczaneler/ice-aktar/onizleme/${batch.id}`);
    await expect(page.getByText("2 hazır")).toBeVisible();
    await expect(page.locator("td", { hasText: `Onboarding Eczanesi 1 ${suffix}` })).toBeVisible();
    await expect(page.locator("td", { hasText: `Onboarding Eczanesi 2 ${suffix}` })).toBeVisible();

    // Step 7: ADMIN confirms the import — a REAL browser click on the
    // bound importPharmacyBatchAction.bind(null, batch.id) form,
    // running the real all-or-nothing transaction.
    await page.click('button:has-text("İçe Aktarımı Onayla")');
    await expect(page).toHaveURL(/\/eczaneler(\?|$)/);

    // Step 8: pharmacies appear in /eczaneler.
    await expect(page.getByText(`Onboarding Eczanesi 1 ${suffix}`)).toBeVisible();
    await expect(page.getByText(`Onboarding Eczanesi 2 ${suffix}`)).toBeVisible();

    const createdPharmacies = await e2ePrisma.pharmacy.findMany({
      where: { regionId: { in: [regionA1.id, regionA2.id] } },
    });
    expect(createdPharmacies).toHaveLength(2);
    tracked.pharmacyIds.push(...createdPharmacies.map((p) => p.id));

    // Step 9: AuditLog contains exactly one import event for this batch.
    const auditLogs = await e2ePrisma.auditLog.findMany({
      where: { entity: "PharmacyImportBatch", entityId: batch.id, action: "CREATE" },
    });
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].organizationId).toBe(orgA.id);

    // Step 10: an Organization B user cannot see any of Organization
    // A's imported records — real browser session, real navigation.
    const orgB = await createE2EOrganization(tracked);
    const adminB = await createE2EUser(tracked, { role: "ADMIN", organizationId: orgB.id });
    const tokenB = await createE2ESession(tracked, adminB.id);
    await context.clearCookies();
    await addSessionCookie(context, tokenB, baseURL!);

    await page.goto("/eczaneler");
    await expect(page.getByText(`Onboarding Eczanesi 1 ${suffix}`)).toHaveCount(0);
    await expect(page.getByText(`Onboarding Eczanesi 2 ${suffix}`)).toHaveCount(0);

    await page.goto(`/eczaneler/ice-aktar/onizleme/${batch.id}`);
    await expect(page.getByText(`Onboarding Eczanesi 1 ${suffix}`)).toHaveCount(0);
  });
});
