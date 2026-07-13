// Real-Postgres lifecycle tests for scripts/create-platform-admin.ts —
// the one-time PLATFORM_ADMIN bootstrap script. Complements the pure
// validation unit tests in scripts/create-platform-admin.test.ts.
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";

import {
  PlatformAdminBootstrapError,
  createPlatformAdmin,
  formatResultMessage,
} from "../../scripts/create-platform-admin";
import {
  cleanupTrackedIds,
  createTestUser,
  newTrackedIds,
  testRunId,
} from "./helpers/fixtures";

describe("create-platform-admin bootstrap script (real Postgres)", () => {
  const tracked = newTrackedIds();

  // The script's global "no other PLATFORM_ADMIN" precondition makes this
  // suite sensitive to leftovers from a previously *interrupted* run.
  // Per the fixtures' own convention (leftover rows are trivially
  // identifiable by their test-only email patterns), clear only
  // PLATFORM_ADMIN rows whose email marks them as test artifacts —
  // never any other user.
  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: {
        role: "PLATFORM_ADMIN",
        OR: [
          { email: { endsWith: "@integration.test" } },
          { email: { startsWith: "pa-", endsWith: "@example.org" } },
        ],
      },
    });
  });

  afterEach(async () => {
    await cleanupTrackedIds(tracked);
    tracked.organizationIds.length = 0;
    tracked.userIds.length = 0;
    tracked.regionIds.length = 0;
    tracked.pharmacyIds.length = 0;
    tracked.dutyScheduleIds.length = 0;
    tracked.historicalBatchIds.length = 0;
  });

  async function trackByEmail(email: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (user) tracked.userIds.push(user.id);
  }

  it("rejects a weak password before touching the database", async () => {
    const email = `pa-weak-${testRunId()}@example.org`;
    await expect(
      createPlatformAdmin({ email, password: "kisa" }, prisma)
    ).rejects.toBeInstanceOf(PlatformAdminBootstrapError);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it("rejects an invalid email before touching the database", async () => {
    await expect(
      createPlatformAdmin(
        { email: "not-an-email", password: "long-enough-password" },
        prisma
      )
    ).rejects.toBeInstanceOf(PlatformAdminBootstrapError);
  });

  it("creates exactly one active PLATFORM_ADMIN with organizationId null", async () => {
    const email = `PA-Create-${testRunId()}@Example.ORG`;
    const result = await createPlatformAdmin(
      { email, password: "long-enough-password", name: "Test Platform Yöneticisi" },
      prisma
    );
    const normalizedEmail = email.toLowerCase();
    await trackByEmail(normalizedEmail);

    expect(result).toEqual({ outcome: "created", email: normalizedEmail });

    const created = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    expect(created).not.toBeNull();
    expect(created?.role).toBe("PLATFORM_ADMIN");
    expect(created?.organizationId).toBeNull();
    expect(created?.isActive).toBe(true);
    expect(created?.name).toBe("Test Platform Yöneticisi");
    // The stored hash is the app's real scrypt format and verifies with
    // the app's own verifyPassword — the login flow will accept it.
    expect(
      await verifyPassword("long-enough-password", created?.passwordHash ?? "")
    ).toBe(true);
  });

  it("refuses to convert an existing tenant user and changes nothing", async () => {
    const tenantUser = await createTestUser(tracked, { role: "ADMIN" });

    await expect(
      createPlatformAdmin(
        { email: tenantUser.email, password: "long-enough-password" },
        prisma
      )
    ).rejects.toThrow(/kiracı kullanıcısına ait/);

    const untouched = await prisma.user.findUnique({
      where: { email: tenantUser.email },
    });
    expect(untouched?.role).toBe("ADMIN");
    expect(untouched?.organizationId).toBe(tenantUser.organizationId);
    expect(untouched?.passwordHash).toBe(tenantUser.passwordHash);
  });

  it("refuses to create a second PLATFORM_ADMIN under a different email", async () => {
    const firstEmail = `pa-first-${testRunId()}@example.org`;
    await createPlatformAdmin(
      { email: firstEmail, password: "long-enough-password" },
      prisma
    );
    await trackByEmail(firstEmail);

    const secondEmail = `pa-second-${testRunId()}@example.org`;
    await expect(
      createPlatformAdmin(
        { email: secondEmail, password: "long-enough-password" },
        prisma
      )
    ).rejects.toThrow(/PLATFORM_ADMIN zaten var/);
    expect(
      await prisma.user.findUnique({ where: { email: secondEmail } })
    ).toBeNull();
  });

  it("is idempotent for the same account: repeat runs change nothing, including the password", async () => {
    const email = `pa-idem-${testRunId()}@example.org`;
    await createPlatformAdmin(
      { email, password: "original-password" },
      prisma
    );
    await trackByEmail(email);
    const first = await prisma.user.findUnique({ where: { email } });

    const repeat = await createPlatformAdmin(
      { email, password: "a-different-password" },
      prisma
    );
    expect(repeat).toEqual({ outcome: "already-exists", email });

    const after = await prisma.user.findUnique({ where: { email } });
    expect(after?.passwordHash).toBe(first?.passwordHash);
    expect(after?.updatedAt.getTime()).toBe(first?.updatedAt.getTime());
    // The original password still verifies; the second run's password was
    // never applied.
    expect(
      await verifyPassword("original-password", after?.passwordHash ?? "")
    ).toBe(true);
  });

  it("never surfaces the password or hash in any result message or error", async () => {
    const email = `pa-secret-${testRunId()}@example.org`;
    const password = "super-secret-value-42";

    const result = await createPlatformAdmin({ email, password }, prisma);
    await trackByEmail(email);
    const created = await prisma.user.findUnique({ where: { email } });

    const successMessage = formatResultMessage(result);
    const repeatMessage = formatResultMessage(
      await createPlatformAdmin({ email, password }, prisma)
    );
    let rejectionMessage = "";
    try {
      await createPlatformAdmin(
        { email: `pa-secret-b-${testRunId()}@example.org`, password },
        prisma
      );
    } catch (error) {
      rejectionMessage = (error as Error).message;
    }
    expect(rejectionMessage).not.toBe("");

    for (const message of [successMessage, repeatMessage, rejectionMessage]) {
      expect(message).not.toContain(password);
      expect(message).not.toContain(created?.passwordHash ?? "never-matches");
    }
  });
});
