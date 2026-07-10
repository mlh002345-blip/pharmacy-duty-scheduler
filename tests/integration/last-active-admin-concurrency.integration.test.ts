import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { setUserStatusAction } from "@/app/(dashboard)/kullanicilar/actions";
import { IntegrationRedirectSignal, setIntegrationTestSessionToken } from "./helpers/setup";
import { raceThroughGate } from "./helpers/gate";
import {
  createTestSessionToken,
  createTestUser,
  cleanupTrackedIds,
  newTrackedIds,
} from "./helpers/fixtures";

describe("concurrent last-active-admin guard (real Postgres pg_advisory_xact_lock)", () => {
  const tracked = newTrackedIds();

  afterEach(async () => {
    setIntegrationTestSessionToken(undefined);
    await cleanupTrackedIds(tracked);
  });

  it("never lets both of exactly two active admins be deactivated concurrently", async () => {
    // Exactly two active ADMIN users exist in total. Self-deactivation is
    // blocked by a separate, earlier guard, so each admin deactivates the
    // OTHER one — both requests race to bring the system to zero active
    // admins, which assertLastActiveAdminNotRemoved must prevent.
    const adminOne = await createTestUser(tracked, { role: "ADMIN" });
    const adminTwo = await createTestUser(tracked, { role: "ADMIN" });
    const tokenOne = await createTestSessionToken(adminOne.id);
    const tokenTwo = await createTestSessionToken(adminTwo.id);

    async function deactivate(actingAsToken: string, targetUserId: string) {
      setIntegrationTestSessionToken(actingAsToken);
      try {
        await setUserStatusAction(targetUserId, false);
        return { redirected: false as const };
      } catch (error) {
        if (error instanceof IntegrationRedirectSignal) {
          return { redirected: true as const, path: error.path };
        }
        throw error;
      }
    }

    const [r1, r2] = await raceThroughGate(
      () => deactivate(tokenOne, adminTwo.id),
      () => deactivate(tokenTwo, adminOne.id)
    );

    expect(r1.status).toBe("fulfilled");
    expect(r2.status).toBe("fulfilled");

    const [freshOne, freshTwo] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: adminOne.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: adminTwo.id } }),
    ]);

    // At least one active admin must remain: never a zero-admin state.
    const stillActiveCount = [freshOne, freshTwo].filter((u) => u.isActive).length;
    expect(stillActiveCount).toBeGreaterThanOrEqual(1);

    const deactivatedCount = [freshOne, freshTwo].filter((u) => !u.isActive).length;
    expect(deactivatedCount).toBe(1);

    const auditLogs = await prisma.auditLog.findMany({
      where: { entity: "User", entityId: { in: [adminOne.id, adminTwo.id] } },
    });
    // Audit logs reflect only committed updates: exactly one deactivation
    // was actually committed, not two, and not zero.
    expect(auditLogs).toHaveLength(1);
  });
});
