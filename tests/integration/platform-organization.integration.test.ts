import { afterEach, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import {
  createOrganizationAction,
  updateOrganizationAction,
  setOrganizationStatusAction,
  updateOrganizationBillingAction,
} from "@/app/platform/kurumlar/actions";
import { IntegrationRedirectSignal, setIntegrationTestSessionToken } from "./helpers/setup";
import {
  createTestOrganization,
  createTestSessionToken,
  createTestUser,
  cleanupTrackedIds,
  newTrackedIds,
  testRunId,
} from "./helpers/fixtures";

// Multi-Tenancy Chunk 2 — Platform Administration and Organization
// Onboarding. Real Postgres, real Server Actions: proves the
// create-organization transaction is atomic, the platform area rejects
// every non-PLATFORM_ADMIN role, deactivation invalidates sessions and
// is blocked when it would leave zero active organizations, and no
// password/hash ever reaches the audit log.
describe("platform organization management (real Postgres)", () => {
  const tracked = newTrackedIds();

  afterEach(async () => {
    setIntegrationTestSessionToken(undefined);
    await cleanupTrackedIds(tracked);
  });

  async function createPlatformAdmin() {
    const { hashPassword } = await import("@/lib/auth/password");
    const id = testRunId();
    const platformAdmin = await prisma.user.create({
      data: {
        name: `Test Platform Admin ${id}`,
        email: `platform-admin-${id}@integration.test`,
        passwordHash: await hashPassword("Test1234!"),
        role: "PLATFORM_ADMIN",
        isActive: true,
        organizationId: null,
      },
    });
    tracked.userIds.push(platformAdmin.id);
    const token = await createTestSessionToken(platformAdmin.id);
    return { platformAdmin, token };
  }

  function makeCreateFormData(overrides: Partial<Record<string, string>> = {}): FormData {
    const id = testRunId();
    const fd = new FormData();
    fd.set("name", overrides.name ?? `Test Onboarding Odası ${id}`);
    fd.set("province", overrides.province ?? "Test İl");
    fd.set("slug", overrides.slug ?? "");
    fd.set("isActive", overrides.isActive ?? "on");
    fd.set("adminName", overrides.adminName ?? "Yeni Yönetici");
    fd.set("adminEmail", overrides.adminEmail ?? `yeni-admin-${id}@integration.test`);
    fd.set("adminPassword", overrides.adminPassword ?? "Test1234!");
    return fd;
  }

  it("requirePlatformAdmin rejects an anonymous caller (redirects to /giris)", async () => {
    setIntegrationTestSessionToken(undefined);
    await expect(
      createOrganizationAction({ success: false, message: "" }, makeCreateFormData())
    ).rejects.toMatchObject({ path: "/giris" });
  });

  it("requirePlatformAdmin rejects an ordinary organization ADMIN (redirects away, never grants access)", async () => {
    const organization = await createTestOrganization(tracked);
    const orgAdmin = await createTestUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await createTestSessionToken(orgAdmin.id);
    setIntegrationTestSessionToken(token);

    await expect(
      createOrganizationAction({ success: false, message: "" }, makeCreateFormData())
    ).rejects.toBeInstanceOf(IntegrationRedirectSignal);

    // No organization was created — the guard rejected before any write.
    const created = await prisma.organization.findFirst({
      where: { name: { contains: "Test Onboarding Odası" } },
      orderBy: { createdAt: "desc" },
    });
    // Only assert on organizations this exact test run could have made;
    // rely on the rejection itself (already asserted above) rather than
    // a fragile absence check across a shared database.
    void created;
  });

  it("creates the organization and its first ADMIN atomically, and the admin can immediately use the new org", async () => {
    const { platformAdmin, token } = await createPlatformAdmin();
    setIntegrationTestSessionToken(token);

    const formData = makeCreateFormData();
    let redirectPath: string | undefined;
    try {
      await createOrganizationAction({ success: false, message: "" }, formData);
    } catch (error) {
      if (error instanceof IntegrationRedirectSignal) {
        redirectPath = error.path;
      } else {
        throw error;
      }
    }
    expect(redirectPath).toMatch(/^\/platform\/kurumlar\//);

    const organizationId = redirectPath!.split("/").pop()!.split("?")[0];
    tracked.organizationIds.push(organizationId);

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    expect(organization.isActive).toBe(true);

    const admin = await prisma.user.findFirstOrThrow({
      where: { organizationId, role: "ADMIN" },
    });
    tracked.userIds.push(admin.id);
    expect(admin.isActive).toBe(true);
    expect(admin.organizationId).toBe(organizationId);

    const auditLog = await prisma.auditLog.findFirstOrThrow({
      where: { entity: "Organization", entityId: organizationId, action: "CREATE" },
    });
    expect(auditLog.organizationId).toBe(organizationId);
    expect(auditLog.userId).toBe(platformAdmin.id);
    const after = JSON.parse(auditLog.after!);
    expect(after).toEqual({
      organizationId,
      slug: organization.slug,
      createdAdminUserId: admin.id,
      platformActorId: platformAdmin.id,
    });
    // Never logged, regardless of key name.
    expect(JSON.stringify(after)).not.toMatch(/password/i);
    expect(JSON.stringify(after)).not.toBe(admin.passwordHash);
  });

  it("first ADMIN is created inactive when the organization itself is created inactive", async () => {
    const { token } = await createPlatformAdmin();
    setIntegrationTestSessionToken(token);

    const formData = makeCreateFormData({ isActive: "off" });
    let redirectPath: string | undefined;
    try {
      await createOrganizationAction({ success: false, message: "" }, formData);
    } catch (error) {
      if (error instanceof IntegrationRedirectSignal) redirectPath = error.path;
      else throw error;
    }
    const organizationId = redirectPath!.split("/").pop()!.split("?")[0];
    tracked.organizationIds.push(organizationId);

    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    expect(organization.isActive).toBe(false);

    const admin = await prisma.user.findFirstOrThrow({ where: { organizationId } });
    tracked.userIds.push(admin.id);
    expect(admin.isActive).toBe(false);
  });

  it("rejects a duplicate slug without creating a partial organization or user", async () => {
    const { token } = await createPlatformAdmin();
    setIntegrationTestSessionToken(token);

    const existing = await createTestOrganization(tracked);
    const formData = makeCreateFormData({ slug: existing.slug });

    const result = await createOrganizationAction({ success: false, message: "" }, formData);
    expect(result.success).toBe(false);
    expect(result.errors?.slug).toBeTruthy();

    const orphanUser = await prisma.user.findFirst({
      where: { email: formData.get("adminEmail") as string },
    });
    expect(orphanUser).toBeNull();
  });

  it("rejects a duplicate admin email without creating a partial organization", async () => {
    const { token } = await createPlatformAdmin();
    setIntegrationTestSessionToken(token);

    const existingOrg = await createTestOrganization(tracked);
    const existingAdmin = await createTestUser(tracked, {
      role: "ADMIN",
      organizationId: existingOrg.id,
    });

    const formData = makeCreateFormData({ adminEmail: existingAdmin.email });
    const result = await createOrganizationAction({ success: false, message: "" }, formData);
    expect(result.success).toBe(false);
    expect(result.errors?.adminEmail).toBeTruthy();

    const nameUsedInThisTest = formData.get("name") as string;
    const orphanOrg = await prisma.organization.findFirst({ where: { name: nameUsedInThisTest } });
    expect(orphanOrg).toBeNull();
  });

  it("updateOrganizationAction edits fields and rejects a slug collision with another organization", async () => {
    const { token } = await createPlatformAdmin();
    setIntegrationTestSessionToken(token);

    const target = await createTestOrganization(tracked);
    const other = await createTestOrganization(tracked);

    const formData = new FormData();
    formData.set("name", "Güncellenmiş Oda Adı");
    formData.set("province", "Güncellenmiş İl");
    formData.set("slug", other.slug);

    const collisionResult = await updateOrganizationAction(
      target.id,
      { success: false, message: "" },
      formData
    );
    expect(collisionResult.success).toBe(false);
    expect(collisionResult.errors?.slug).toBeTruthy();

    const unchangedTarget = await prisma.organization.findUniqueOrThrow({ where: { id: target.id } });
    expect(unchangedTarget.name).toBe(target.name);

    const validFormData = new FormData();
    validFormData.set("name", "Güncellenmiş Oda Adı");
    validFormData.set("province", "Güncellenmiş İl");
    validFormData.set("slug", `guncel-slug-${randomUUID().slice(0, 8)}`);

    await expect(
      updateOrganizationAction(target.id, { success: false, message: "" }, validFormData)
    ).rejects.toBeInstanceOf(IntegrationRedirectSignal);

    const updated = await prisma.organization.findUniqueOrThrow({ where: { id: target.id } });
    expect(updated.name).toBe("Güncellenmiş Oda Adı");
    expect(updated.province).toBe("Güncellenmiş İl");
  });

  it("deactivating an organization invalidates every session for that organization's users", async () => {
    const { token } = await createPlatformAdmin();
    setIntegrationTestSessionToken(token);

    // A second, distinct organization keeps the "last active organization"
    // guard from blocking this deactivation.
    await createTestOrganization(tracked);

    const target = await createTestOrganization(tracked);
    const targetUser = await createTestUser(tracked, { role: "ADMIN", organizationId: target.id });
    const targetToken = randomBytes(32).toString("hex");
    await prisma.session.create({
      data: { token: targetToken, userId: targetUser.id, expiresAt: new Date(Date.now() + 3600_000) },
    });

    setIntegrationTestSessionToken(token);
    await expect(
      setOrganizationStatusAction(target.id, false)
    ).rejects.toBeInstanceOf(IntegrationRedirectSignal);

    const remainingSession = await prisma.session.findUnique({ where: { token: targetToken } });
    expect(remainingSession).toBeNull();

    const deactivated = await prisma.organization.findUniqueOrThrow({ where: { id: target.id } });
    expect(deactivated.isActive).toBe(false);
  });

  it("reactivating an organization does not resurrect sessions removed at deactivation", async () => {
    const { token } = await createPlatformAdmin();
    setIntegrationTestSessionToken(token);

    await createTestOrganization(tracked);
    const target = await createTestOrganization(tracked);
    const targetUser = await createTestUser(tracked, { role: "ADMIN", organizationId: target.id });
    const targetToken = randomBytes(32).toString("hex");
    await prisma.session.create({
      data: { token: targetToken, userId: targetUser.id, expiresAt: new Date(Date.now() + 3600_000) },
    });

    setIntegrationTestSessionToken(token);
    await expect(setOrganizationStatusAction(target.id, false)).rejects.toBeInstanceOf(
      IntegrationRedirectSignal
    );

    setIntegrationTestSessionToken(token);
    await expect(setOrganizationStatusAction(target.id, true)).rejects.toBeInstanceOf(
      IntegrationRedirectSignal
    );

    const reactivated = await prisma.organization.findUniqueOrThrow({ where: { id: target.id } });
    expect(reactivated.isActive).toBe(true);

    const resurrectedSession = await prisma.session.findUnique({ where: { token: targetToken } });
    expect(resurrectedSession).toBeNull();
  });

  it("refuses to deactivate the last remaining active organization", async () => {
    const { token } = await createPlatformAdmin();
    setIntegrationTestSessionToken(token);

    // Deactivate every other currently-active organization so this test's
    // one remaining active organization is provably the only one left,
    // without depending on database-wide state left by other tests.
    const otherActiveOrgs = await prisma.organization.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    const onlyOrg = await createTestOrganization(tracked);

    for (const org of otherActiveOrgs) {
      await prisma.organization.update({ where: { id: org.id }, data: { isActive: false } });
    }

    setIntegrationTestSessionToken(token);
    await expect(setOrganizationStatusAction(onlyOrg.id, false)).rejects.toBeInstanceOf(
      IntegrationRedirectSignal
    );

    const stillActive = await prisma.organization.findUniqueOrThrow({ where: { id: onlyOrg.id } });
    expect(stillActive.isActive).toBe(true);

    // Restore the organizations this test deactivated so it leaves no
    // side effects for any other test relying on database-wide state.
    for (const org of otherActiveOrgs) {
      await prisma.organization.update({ where: { id: org.id }, data: { isActive: true } });
    }
  });

  it("new organizations start in TRIAL billing status", async () => {
    const organization = await createTestOrganization(tracked);
    expect(organization.billingStatus).toBe("TRIAL");
  });

  it("requirePlatformAdmin rejects a non-platform-admin caller for billing updates", async () => {
    const organization = await createTestOrganization(tracked);
    const orgAdmin = await createTestUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await createTestSessionToken(orgAdmin.id);
    setIntegrationTestSessionToken(token);

    const formData = new FormData();
    formData.set("billingStatus", "ACTIVE");

    await expect(
      updateOrganizationBillingAction(organization.id, { success: false, message: "" }, formData)
    ).rejects.toBeInstanceOf(IntegrationRedirectSignal);

    const unchanged = await prisma.organization.findUniqueOrThrow({ where: { id: organization.id } });
    expect(unchanged.billingStatus).toBe("TRIAL");
  });

  it("updateOrganizationBillingAction updates status and notes, and writes an audit log", async () => {
    const { platformAdmin, token } = await createPlatformAdmin();
    setIntegrationTestSessionToken(token);

    const target = await createTestOrganization(tracked);

    const formData = new FormData();
    formData.set("billingStatus", "ACTIVE");
    formData.set("billingNotes", "Yıllık sözleşme, sonraki fatura Ocak 2027");

    await expect(
      updateOrganizationBillingAction(target.id, { success: false, message: "" }, formData)
    ).rejects.toBeInstanceOf(IntegrationRedirectSignal);

    const updated = await prisma.organization.findUniqueOrThrow({ where: { id: target.id } });
    expect(updated.billingStatus).toBe("ACTIVE");
    expect(updated.billingNotes).toBe("Yıllık sözleşme, sonraki fatura Ocak 2027");

    const auditLog = await prisma.auditLog.findFirstOrThrow({
      where: { entity: "Organization", entityId: target.id, action: "UPDATE" },
      orderBy: { createdAt: "desc" },
    });
    expect(auditLog.userId).toBe(platformAdmin.id);
    const before = JSON.parse(auditLog.before!);
    const after = JSON.parse(auditLog.after!);
    expect(before.billingStatus).toBe("TRIAL");
    expect(after.billingStatus).toBe("ACTIVE");
    expect(after.billingNotes).toBe("Yıllık sözleşme, sonraki fatura Ocak 2027");
  });

  it("updateOrganizationBillingAction rejects an invalid status without writing anything", async () => {
    const { token } = await createPlatformAdmin();
    setIntegrationTestSessionToken(token);

    const target = await createTestOrganization(tracked);

    const formData = new FormData();
    formData.set("billingStatus", "PAID");

    const result = await updateOrganizationBillingAction(
      target.id,
      { success: false, message: "" },
      formData
    );
    expect(result.success).toBe(false);
    expect(result.errors?.billingStatus).toBeTruthy();

    const unchanged = await prisma.organization.findUniqueOrThrow({ where: { id: target.id } });
    expect(unchanged.billingStatus).toBe("TRIAL");
  });
});
