import { test, expect } from "@playwright/test";

import {
  cleanupTrackedIds,
  createE2EOrganization,
  createE2EUser,
  newTrackedIds,
  testRunId,
} from "../helpers/fixtures";
import { e2ePrisma } from "../helpers/db";

// Kendi kendine ("self-service") oda kayıt akışı — /kayit sayfası, gerçek
// tarayıcı + gerçek Postgres üzerinden.
test.describe("self-service organization signup (real browser, real Postgres)", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  test("login page links to /kayit", async ({ page }) => {
    await page.goto("/giris");
    await page.getByRole("link", { name: "Odanız için hesap oluşturun" }).click();
    await expect(page).toHaveURL("/kayit");
  });

  test("filling the form creates the organization + admin, and logs the admin straight in", async ({
    page,
  }) => {
    const id = testRunId();
    const orgName = `E2E Kayıt Odası ${id}`;
    const adminEmail = `e2e-signup-${id}@e2e.invalid`;

    await page.goto("/kayit");
    await page.fill("#name", orgName);
    await page.fill("#province", "Antalya");
    await page.fill("#adminName", "E2E Yönetici");
    await page.fill("#adminEmail", adminEmail);
    await page.fill("#adminPassword", "GecerliSifre123!");
    await page.fill("#adminPasswordConfirmation", "GecerliSifre123!");
    await page.check("#termsAccepted");
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/^http:\/\/localhost:3210\/panel\?success=/);
    await expect(page.getByText(/odanız oluşturuldu/i)).toBeVisible();

    const admin = await e2ePrisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    tracked.userIds.push(admin.id);
    tracked.userEmails.push(admin.email);
    tracked.organizationIds.push(admin.organizationId!);
    expect(admin.role).toBe("ADMIN");
  });

  test("rejects a mismatched password confirmation and does not create an account", async ({
    page,
  }) => {
    const id = testRunId();
    const adminEmail = `e2e-signup-mismatch-${id}@e2e.invalid`;

    await page.goto("/kayit");
    await page.fill("#name", `E2E Uyumsuz Şifre ${id}`);
    await page.fill("#province", "Bursa");
    await page.fill("#adminName", "E2E Yönetici");
    await page.fill("#adminEmail", adminEmail);
    await page.fill("#adminPassword", "GecerliSifre123!");
    await page.fill("#adminPasswordConfirmation", "BaskaSifre123!");
    await page.check("#termsAccepted");
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL("/kayit");
    await expect(page.getByText(/şifreler eşleşmiyor/i)).toBeVisible();

    const admin = await e2ePrisma.user.findUnique({ where: { email: adminEmail } });
    expect(admin).toBeNull();
  });

  test("rejects a duplicate slug", async ({ page }) => {
    const organization = await createE2EOrganization(tracked);
    await createE2EUser(tracked, { organizationId: organization.id });

    const id = testRunId();
    await page.goto("/kayit");
    await page.fill("#name", `E2E Çakışan Slug ${id}`);
    await page.fill("#province", "Konya");
    await page.fill("#slug", organization.slug);
    await page.fill("#adminName", "E2E Yönetici");
    await page.fill("#adminEmail", `e2e-signup-dup-${id}@e2e.invalid`);
    await page.fill("#adminPassword", "GecerliSifre123!");
    await page.fill("#adminPasswordConfirmation", "GecerliSifre123!");
    await page.check("#termsAccepted");
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL("/kayit");
    await expect(page.getByText(/bu kısa ad \(slug\) zaten kullanılıyor/i).first()).toBeVisible();
  });

  test("terms checkbox is required to submit, and links to the KVKK/terms pages work", async ({
    page,
    context,
  }) => {
    await page.goto("/kayit");
    const checkbox = page.locator("#termsAccepted");
    await expect(checkbox).toHaveAttribute("required", "");
    await expect(checkbox).not.toBeChecked();

    const [kvkkPage] = await Promise.all([
      context.waitForEvent("page"),
      page.getByRole("link", { name: "KVKK Aydınlatma Metni" }).click(),
    ]);
    await expect(kvkkPage.getByRole("heading", { name: /KVKK Aydınlatma Metni/i })).toBeVisible();
    await kvkkPage.close();

    const [termsPage] = await Promise.all([
      context.waitForEvent("page"),
      page.getByRole("link", { name: "Kullanım Şartları" }).click(),
    ]);
    await expect(termsPage.getByRole("heading", { name: "Kullanım Şartları" })).toBeVisible();
    await termsPage.close();
  });
});
