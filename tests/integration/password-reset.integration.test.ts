// Şifre sıfırlama — hem kendi kendine "şifremi unuttum" akışı
// (src/lib/auth/password-reset.ts'in requestSelfServicePasswordReset/
// checkPasswordResetToken/consumePasswordResetToken üçlüsü) hem de platform
// desteğinin acil durum bağlantısı (issueEmergencyPasswordResetAction),
// gerçek Postgres'e karşı.

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  checkPasswordResetToken,
  consumePasswordResetToken,
  requestSelfServicePasswordReset,
} from "@/lib/auth/password-reset";
import { issueEmergencyPasswordResetAction } from "@/app/platform/kurumlar/actions";
import { IntegrationRedirectSignal, setIntegrationTestSessionToken } from "./helpers/setup";
import {
  createTestOrganization,
  createTestSessionToken,
  createTestUser,
  cleanupTrackedIds,
  newTrackedIds,
  testRunId,
} from "./helpers/fixtures";

async function createPlatformAdmin(tracked: ReturnType<typeof newTrackedIds>) {
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

describe("self-service password reset (real Postgres)", () => {
  const tracked = newTrackedIds();

  afterEach(async () => {
    await cleanupTrackedIds(tracked);
  });

  it("issues a token for a registered email, and the token resets the password + invalidates existing sessions", async () => {
    const user = await createTestUser(tracked, { email: `reset-${testRunId()}@integration.test` });
    const oldSessionToken = await createTestSessionToken(user.id);

    const issued = await requestSelfServicePasswordReset(user.email);
    expect(issued).not.toBeNull();
    if (!issued) return;

    expect((await checkPasswordResetToken(issued.token)).valid).toBe(true);

    const result = await consumePasswordResetToken(issued.token, "YeniSifre123!");
    expect(result).toEqual({ ok: true, userId: user.id });

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword("YeniSifre123!", updated.passwordHash)).toBe(true);

    const oldSession = await prisma.session.findUnique({ where: { token: oldSessionToken } });
    expect(oldSession).toBeNull();
  });

  it("is case-insensitive on the email and returns null for an unregistered address (no enumeration signal)", async () => {
    const user = await createTestUser(tracked, { email: `Mixed-Case-${testRunId()}@Integration.Test` });

    const issued = await requestSelfServicePasswordReset(user.email.toLowerCase());
    expect(issued).not.toBeNull();

    const notFound = await requestSelfServicePasswordReset(`nope-${testRunId()}@integration.test`);
    expect(notFound).toBeNull();
  });

  it("caps the number of simultaneously active tokens per user", async () => {
    const user = await createTestUser(tracked, { email: `capped-${testRunId()}@integration.test` });

    const first = await requestSelfServicePasswordReset(user.email);
    const second = await requestSelfServicePasswordReset(user.email);
    const third = await requestSelfServicePasswordReset(user.email);
    const fourth = await requestSelfServicePasswordReset(user.email);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(third).not.toBeNull();
    expect(fourth).toBeNull();
  });

  it("rejects a token that does not exist, one that is expired, and one that was already used", async () => {
    expect(await checkPasswordResetToken("nonexistent-token")).toEqual({
      valid: false,
      reason: "not_found",
    });
    expect(await consumePasswordResetToken("nonexistent-token", "YeniSifre123!")).toEqual({
      ok: false,
      reason: "not_found",
    });

    const user = await createTestUser(tracked, { email: `expiring-${testRunId()}@integration.test` });
    const expired = await prisma.passwordResetToken.create({
      data: { token: `expired-${testRunId()}`, userId: user.id, expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await checkPasswordResetToken(expired.token)).toEqual({ valid: false, reason: "expired" });
    expect(await consumePasswordResetToken(expired.token, "YeniSifre123!")).toEqual({
      ok: false,
      reason: "expired",
    });

    const alreadyUsed = await prisma.passwordResetToken.create({
      data: {
        token: `used-${testRunId()}`,
        userId: user.id,
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
      },
    });
    expect(await checkPasswordResetToken(alreadyUsed.token)).toEqual({ valid: false, reason: "used" });
    expect(await consumePasswordResetToken(alreadyUsed.token, "YeniSifre123!")).toEqual({
      ok: false,
      reason: "used",
    });
  });

  it("cannot be consumed twice — a second attempt with the same token fails even though the first succeeded", async () => {
    const user = await createTestUser(tracked, { email: `onceonly-${testRunId()}@integration.test` });
    const issued = await requestSelfServicePasswordReset(user.email);
    if (!issued) throw new Error("expected a token");

    const first = await consumePasswordResetToken(issued.token, "IlkSifre123!");
    expect(first.ok).toBe(true);

    const second = await consumePasswordResetToken(issued.token, "IkinciSifre123!");
    expect(second).toEqual({ ok: false, reason: "used" });

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword("IlkSifre123!", updated.passwordHash)).toBe(true);
  });
});

describe("issueEmergencyPasswordResetAction (real Postgres)", () => {
  const tracked = newTrackedIds();

  afterEach(async () => {
    setIntegrationTestSessionToken(undefined);
    await cleanupTrackedIds(tracked);
  });

  it("lets a PLATFORM_ADMIN generate a working reset link for a stuck organization's admin, and audits it", async () => {
    const { token: platformToken, platformAdmin } = await createPlatformAdmin(tracked);
    const organization = await createTestOrganization(tracked);
    const stuckAdmin = await createTestUser(tracked, {
      role: "ADMIN",
      organizationId: organization.id,
      email: `stuck-${testRunId()}@integration.test`,
    });
    setIntegrationTestSessionToken(platformToken);

    const result = await issueEmergencyPasswordResetAction(
      organization.id,
      stuckAdmin.id,
      { success: false, message: "" },
      new FormData()
    );

    expect(result.success).toBe(true);
    const linkMatch = result.message.match(/https?:\/\/\S+\/sifre-sifirla\/(\S+?)(?:\s|$)/);
    expect(linkMatch).not.toBeNull();
    const extractedToken = linkMatch![1].replace(/[.,]+$/, "");

    expect((await checkPasswordResetToken(extractedToken)).valid).toBe(true);
    const consumeResult = await consumePasswordResetToken(extractedToken, "AcilSifre123!");
    expect(consumeResult).toEqual({ ok: true, userId: stuckAdmin.id });

    const auditRow = await prisma.auditLog.findFirst({
      where: { entity: "User", entityId: stuckAdmin.id, userId: platformAdmin.id },
    });
    expect(auditRow).not.toBeNull();
  });

  it("rejects a targetUserId that does not belong to the given organization", async () => {
    const { token: platformToken } = await createPlatformAdmin(tracked);
    const organizationA = await createTestOrganization(tracked);
    const organizationB = await createTestOrganization(tracked);
    const adminOfB = await createTestUser(tracked, { role: "ADMIN", organizationId: organizationB.id });
    setIntegrationTestSessionToken(platformToken);

    const result = await issueEmergencyPasswordResetAction(
      organizationA.id,
      adminOfB.id,
      { success: false, message: "" },
      new FormData()
    );

    expect(result).toEqual({ success: false, message: "Kullanıcı bulunamadı." });
  });

  it("redirects a non-PLATFORM_ADMIN away instead of issuing a token", async () => {
    const organization = await createTestOrganization(tracked);
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await createTestSessionToken(admin.id);
    setIntegrationTestSessionToken(token);

    await expect(
      issueEmergencyPasswordResetAction(
        organization.id,
        admin.id,
        { success: false, message: "" },
        new FormData()
      )
    ).rejects.toThrow(IntegrationRedirectSignal);
  });
});
