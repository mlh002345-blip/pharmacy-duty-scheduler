import { test, expect } from "@playwright/test";

import { hashPassword } from "@/lib/auth/password";
import {
  createE2EOrganization,
  createE2ESession,
  createE2EUser,
  cleanupTrackedIds,
  newTrackedIds,
  testRunId,
  E2E_TEST_PASSWORD,
} from "../helpers/fixtures";
import { addSessionCookie } from "../helpers/browser";
import { e2ePrisma } from "../helpers/db";

// Şifre sıfırlama: hem kendi kendine "şifremi unuttum" akışı hem de
// platform desteğinin SMTP'siz acil durum bağlantısı, gerçek tarayıcı +
// gerçek Postgres üzerinden. Bu ortamda SMTP yapılandırılmadığından
// self-service e-postası gerçekte gitmez — testler bu yüzden token'ı
// doğrudan veritabanından okuyor (tıpkı gerçek bir kullanıcının gelen
// kutusundan linke tıklaması gibi, sadece e-posta adımı atlanmış).
test.describe("password reset (real browser, real Postgres)", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  test("login page links to /sifremi-unuttum", async ({ page }) => {
    await page.goto("/giris");
    await page.getByRole("link", { name: "Şifremi unuttum" }).click();
    await expect(page).toHaveURL("/sifremi-unuttum");
  });

  test("self-service flow: request, consume the token, and log in with the new password", async ({
    page,
  }) => {
    const organization = await createE2EOrganization(tracked);
    const email = `reset-${testRunId()}@e2e.invalid`;
    const admin = await createE2EUser(tracked, { role: "ADMIN", organizationId: organization.id, email });

    await page.goto("/sifremi-unuttum");
    await page.fill("#email", email);
    await page.click('button[type="submit"]');
    await expect(page.getByText(/şifre sıfırlama bağlantısı gönderildi/i)).toBeVisible();

    const tokenRow = await e2ePrisma.passwordResetToken.findFirstOrThrow({
      where: { userId: admin.id, usedAt: null },
      orderBy: { createdAt: "desc" },
    });

    await page.goto(`/sifre-sifirla/${tokenRow.token}`);
    await page.fill("#password", "YeniSifre123!");
    await page.fill("#passwordConfirmation", "YeniSifre123!");
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/giris(\?|$)/);
    await expect(page.getByText(/şifreniz güncellendi/i)).toBeVisible();

    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', "YeniSifre123!");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL("/");
  });

  test("an unregistered email shows the same generic message (no enumeration)", async ({ page }) => {
    await page.goto("/sifremi-unuttum");
    await page.fill("#email", `nobody-${testRunId()}@e2e.invalid`);
    await page.click('button[type="submit"]');
    await expect(page.getByText(/şifre sıfırlama bağlantısı gönderildi/i)).toBeVisible();
  });

  test("an already-used token shows the invalid-link view on a second visit", async ({ page }) => {
    const organization = await createE2EOrganization(tracked);
    const admin = await createE2EUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await e2ePrisma.passwordResetToken.create({
      data: { token: `used-${testRunId()}`, userId: admin.id, expiresAt: new Date(Date.now() + 60_000), usedAt: new Date() },
    });

    await page.goto(`/sifre-sifirla/${token.token}`);
    await expect(page.getByText("Bağlantı Geçersiz")).toBeVisible();
  });

  test("platform support can issue an emergency reset link without SMTP, and it works", async ({
    context,
    page,
    baseURL,
  }) => {
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

    const organization = await createE2EOrganization(tracked);
    const email = `stuck-${testRunId()}@e2e.invalid`;
    await createE2EUser(tracked, { role: "ADMIN", organizationId: organization.id, email });

    await addSessionCookie(context, platformToken, baseURL!);
    await page.goto(`/platform/kurumlar/${organization.id}`);
    await page.getByRole("button", { name: "Şifre Sıfırlama Bağlantısı Oluştur" }).click();

    const messageLocator = page.getByText(/sifre-sifirla/);
    await expect(messageLocator).toBeVisible();
    const messageText = (await messageLocator.textContent()) ?? "";
    const match = messageText.match(/https?:\/\/\S+\/sifre-sifirla\/(\S+?)(?:\s|—|$)/);
    expect(match).not.toBeNull();
    const resetToken = match![1].replace(/[.,]+$/, "");

    // Platform desteği bağlantıyı elle iletir; burada aynı tarayıcı
    // oturumundan çıkıp gerçek kullanıcı gibi bağlantıyı ziyaret ediyoruz.
    await context.clearCookies();
    await page.goto(`/sifre-sifirla/${resetToken}`);
    await page.fill("#password", "AcilSifre123!");
    await page.fill("#passwordConfirmation", "AcilSifre123!");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/giris(\?|$)/);

    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', "AcilSifre123!");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL("/");
  });

  test("an organization ADMIN cannot reach the platform emergency-reset endpoint", async ({
    context,
    page,
    baseURL,
  }) => {
    const organization = await createE2EOrganization(tracked);
    const admin = await createE2EUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await createE2ESession(tracked, admin.id);
    await addSessionCookie(context, token, baseURL!);

    await page.goto(`/platform/kurumlar/${organization.id}`);
    await expect(page).toHaveURL("/");
  });
});
