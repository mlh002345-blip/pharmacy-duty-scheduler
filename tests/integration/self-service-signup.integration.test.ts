// Kendi kendine ("self-service") oda kayıt akışı — src/app/kayit/actions.ts'in
// createSelfServiceOrganizationAction'ı, gerçek Postgres'e karşı.

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { UNTRUSTED_NETWORK_BUCKET_KEY } from "@/lib/security/client-identity";
import { createSelfServiceOrganizationAction } from "@/app/kayit/actions";
import { IntegrationRedirectSignal } from "./helpers/setup";
import { cleanupTrackedIds, newTrackedIds, testRunId } from "./helpers/fixtures";

function signupForm(overrides: Record<string, string> = {}): FormData {
  const id = testRunId();
  const form = new FormData();
  const defaults: Record<string, string> = {
    name: `Test Oda ${id}`,
    province: "İzmir",
    slug: "",
    adminName: "Test Yönetici",
    adminEmail: `signup-${id}@integration.test`,
    adminPassword: "GecerliSifre123!",
    adminPasswordConfirmation: "GecerliSifre123!",
  };
  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
    form.set(key, value);
  }
  return form;
}

describe("createSelfServiceOrganizationAction (real Postgres)", () => {
  const tracked = newTrackedIds();
  const extraOrganizationIds: string[] = [];
  const extraUserIds: string[] = [];

  afterEach(async () => {
    // Bu eylem organizasyon/kullanıcıyı doğrudan kendi içinde oluşturuyor
    // (tracked.* fixture yardımcılarını değil), bu yüzden id'ler ayrıca
    // izlenip burada temizleniyor.
    if (extraUserIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { userId: { in: extraUserIds } } });
      await prisma.session.deleteMany({ where: { userId: { in: extraUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: extraUserIds } } });
      extraUserIds.length = 0;
    }
    if (extraOrganizationIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { organizationId: { in: extraOrganizationIds } },
      });
      await prisma.organization.deleteMany({ where: { id: { in: extraOrganizationIds } } });
      extraOrganizationIds.length = 0;
    }
    await prisma.selfSignupAttempt.deleteMany({
      where: { bucketKey: UNTRUSTED_NETWORK_BUCKET_KEY },
    });
    await cleanupTrackedIds(tracked);
  });

  it("creates an organization + ADMIN user, logs the admin in, and audits it as self-service", async () => {
    const form = signupForm();
    const adminEmail = form.get("adminEmail") as string;

    await expect(
      createSelfServiceOrganizationAction({ success: false, message: "" }, form)
    ).rejects.toThrow(IntegrationRedirectSignal);

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    extraUserIds.push(admin.id);
    extraOrganizationIds.push(admin.organizationId!);

    expect(admin.role).toBe("ADMIN");
    expect(admin.isActive).toBe(true);
    expect(await verifyPassword("GecerliSifre123!", admin.passwordHash)).toBe(true);

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: admin.organizationId! },
    });
    expect(organization.isActive).toBe(true);

    const session = await prisma.session.findFirst({ where: { userId: admin.id } });
    expect(session).not.toBeNull();

    const auditRow = await prisma.auditLog.findFirst({
      where: { entity: "Organization", entityId: organization.id },
    });
    expect(auditRow).not.toBeNull();
    expect(auditRow!.userId).toBe(admin.id);
    expect(JSON.parse(auditRow!.after as string).selfService).toBe(true);
  });

  it("rejects a duplicate slug and a duplicate admin email", async () => {
    const first = signupForm({ slug: `dup-slug-${testRunId()}` });
    const slug = first.get("slug") as string;

    await expect(
      createSelfServiceOrganizationAction({ success: false, message: "" }, first)
    ).rejects.toThrow(IntegrationRedirectSignal);
    const firstAdmin = await prisma.user.findUniqueOrThrow({
      where: { email: first.get("adminEmail") as string },
    });
    extraUserIds.push(firstAdmin.id);
    extraOrganizationIds.push(firstAdmin.organizationId!);

    const duplicateSlugResult = await createSelfServiceOrganizationAction(
      { success: false, message: "" },
      signupForm({ slug })
    );
    expect(duplicateSlugResult.success).toBe(false);
    expect(duplicateSlugResult.errors?.slug).toBeDefined();

    const duplicateEmailResult = await createSelfServiceOrganizationAction(
      { success: false, message: "" },
      signupForm({ adminEmail: first.get("adminEmail") as string })
    );
    expect(duplicateEmailResult.success).toBe(false);
    expect(duplicateEmailResult.errors?.adminEmail).toBeDefined();
  });

  it("rejects a mismatched password confirmation before touching the database", async () => {
    const form = signupForm({ adminPasswordConfirmation: "FarkliSifre123!" });
    const adminEmail = form.get("adminEmail") as string;

    const result = await createSelfServiceOrganizationAction({ success: false, message: "" }, form);
    expect(result.success).toBe(false);
    expect(result.errors?.adminPasswordConfirmation).toBeDefined();

    const user = await prisma.user.findUnique({ where: { email: adminEmail } });
    expect(user).toBeNull();
  });

  it("rate-limits repeated signups from the same network bucket", async () => {
    for (let i = 0; i < 3; i++) {
      const form = signupForm();
      await expect(
        createSelfServiceOrganizationAction({ success: false, message: "" }, form)
      ).rejects.toThrow(IntegrationRedirectSignal);
      const admin = await prisma.user.findUniqueOrThrow({
        where: { email: form.get("adminEmail") as string },
      });
      extraUserIds.push(admin.id);
      extraOrganizationIds.push(admin.organizationId!);
    }

    const fourth = await createSelfServiceOrganizationAction(
      { success: false, message: "" },
      signupForm()
    );
    expect(fourth.success).toBe(false);
    expect(fourth.message).toMatch(/çok fazla/i);
  });
});
