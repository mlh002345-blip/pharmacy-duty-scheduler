import { test, expect } from "@playwright/test";

import {
  createE2EDutySchedule,
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

// Nöbet hatırlatma e-postası: eczane formundaki opsiyonel E-posta alanı ve
// panelin "Nöbet Hatırlatmaları" bölümündeki gönderim butonu. Bu ortamda
// SMTP yapılandırılmadığından gerçek e-posta gitmez — buton gerçek Server
// Action'ı gerçek tıklamayla tetikler ve "e-postası eksik"/"gönderildi"
// özet mesajının gerçekten göründüğünü doğrular.
test.describe("duty reminders (real browser, real Postgres)", () => {
  const tracked = newTrackedIds();

  test.afterAll(async () => {
    await cleanupTrackedIds(tracked);
  });

  test("pharmacy edit form saves and displays the optional email field", async ({
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

    await page.goto(`/eczaneler/${pharmacy.id}/duzenle`);
    await page.fill("#email", "eczane@ornek.test");
    await page.click('button[type="submit"]:has-text("Kaydet")');

    await expect(page).toHaveURL(/\/eczaneler(\?|$)/);
    const updated = await e2ePrisma.pharmacy.findUnique({ where: { id: pharmacy.id } });
    expect(updated?.email).toBe("eczane@ornek.test");
  });

  test("STAFF can trigger tomorrow's reminders from the dashboard and sees a summary", async ({
    context,
    page,
    baseURL,
  }) => {
    const organization = await createE2EOrganization(tracked);
    const region = await createE2ERegion(tracked, { organizationId: organization.id });
    const pharmacy = await createE2EPharmacy(tracked, region.id);
    await e2ePrisma.pharmacy.update({ where: { id: pharmacy.id }, data: { email: "eczane@ornek.test" } });
    const staff = await createE2EUser(tracked, { role: "STAFF", organizationId: organization.id });
    const token = await createE2ESession(tracked, staff.id);
    await addSessionCookie(context, token, baseURL!);

    const schedule = await createE2EDutySchedule(tracked, region.id, {
      month: 12,
      year: 2031,
      status: "PUBLISHED",
    });
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowUtc = new Date(
      Date.UTC(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate())
    );
    await e2ePrisma.dutyAssignment.create({
      data: { dutyScheduleId: schedule.id, date: tomorrowUtc, pharmacyId: pharmacy.id, weight: 1 },
    });

    await page.goto("/panel");
    await expect(page.getByText("Nöbet Hatırlatmaları", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Yarının Nöbet Hatırlatmalarını Gönder/ }).click();

    await expect(page.getByText(/e-posta gönderildi/)).toBeVisible();
  });

  test("VIEWER does not see the reminder-sending section", async ({ context, page, baseURL }) => {
    const organization = await createE2EOrganization(tracked);
    await createE2ERegion(tracked, { organizationId: organization.id });
    const viewer = await createE2EUser(tracked, { role: "VIEWER", organizationId: organization.id });
    const token = await createE2ESession(tracked, viewer.id);
    await addSessionCookie(context, token, baseURL!);

    await page.goto("/panel");
    await expect(page.getByText("Nöbet Hatırlatmaları")).toHaveCount(0);
  });
});
