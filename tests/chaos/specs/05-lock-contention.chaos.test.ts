import { afterAll, describe, expect, it } from "vitest";

import { assertLastActiveAdminNotRemoved } from "@/lib/auth/admin-guard";

import {
  createChaosOrganization,
  createChaosPharmacy,
  createChaosRegion,
  createChaosUser,
} from "../helpers/fixtures";
import { chaosPrisma } from "../helpers/db";

// Scenario E — lock contention (Step 6, item 8). Two real, concurrent
// PostgreSQL transactions against the real chaos database — no mocking
// of Prisma or the lock itself.
describe("scenario E: lock contention", () => {
  afterAll(async () => {
    await chaosPrisma.$disconnect();
  });

  it("last-active-admin advisory lock: a second waiter is bounded by a scoped lock_timeout, not left hanging, and succeeds once the holder releases", async () => {
    // Two active admins in the SAME organization so the guard itself would
    // pass for either call — isolating this test to lock *contention*
    // behavior, not the guard's own business rule (the guard is
    // organization-scoped, so both admins must share one org).
    const organization = await createChaosOrganization();
    await createChaosUser({ role: "ADMIN", organizationId: organization.id });
    await createChaosUser({ role: "ADMIN", organizationId: organization.id });

    // Holder: acquires the advisory lock and keeps its transaction open
    // until this test explicitly releases it — a deterministic gate, not
    // a sleep.
    let releaseHolder!: () => void;
    const holderCanCommit = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });
    let holderAcquired!: () => void;
    const holderHasAcquired = new Promise<void>((resolve) => {
      holderAcquired = resolve;
    });

    const holderTx = chaosPrisma.$transaction(async (tx) => {
      await assertLastActiveAdminNotRemoved(tx, organization.id);
      holderAcquired();
      await holderCanCommit;
    });

    await holderHasAcquired;

    // Waiter: a second, independent connection with a short, test-scoped
    // lock_timeout — proves the wait is bounded, never indefinite.
    const waiterStart = performance.now();
    let waiterError: unknown;
    try {
      await chaosPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '800ms'`;
        await assertLastActiveAdminNotRemoved(tx, organization.id);
      });
    } catch (error) {
      waiterError = error;
    }
    const waiterDurationMs = performance.now() - waiterStart;

    expect(waiterError).toBeDefined();
    expect(waiterDurationMs).toBeLessThan(3_000); // bounded — nowhere near "indefinite"
    expect(waiterDurationMs).toBeGreaterThanOrEqual(700); // actually waited out the lock_timeout, not an unrelated instant failure
    const message = (waiterError as Error).message;
    expect(message).toMatch(/lock timeout|55P03|canceling statement/i);

    // Release the holder — its own transaction must still commit cleanly
    // (the waiter's timeout must not have torn down the holder's own work).
    releaseHolder();
    await expect(holderTx).resolves.toBeUndefined();

    // A fresh, un-timed-out attempt after the lock is released must
    // succeed immediately — the lock is genuinely gone, not stuck.
    await expect(
      chaosPrisma.$transaction(async (tx) => {
        await assertLastActiveAdminNotRemoved(tx, organization.id);
      })
    ).resolves.toBeUndefined();
  }, 30_000);

  it("a row update held by a separate transaction bounds a concurrent updater via a scoped lock_timeout, with no partial commit", async () => {
    const region = await createChaosRegion();
    const pharmacy = await createChaosPharmacy(region.id, { name: "Kilit Testi Eczanesi" });

    let releaseHolder!: () => void;
    const holderCanCommit = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });
    let holderHasLocked!: () => void;
    const holderHasLockedRow = new Promise<void>((resolve) => {
      holderHasLocked = resolve;
    });

    const holderTx = chaosPrisma.$transaction(async (tx) => {
      await tx.pharmacy.update({ where: { id: pharmacy.id }, data: { pharmacistName: "Holder Değeri" } });
      holderHasLocked();
      await holderCanCommit;
    });

    await holderHasLockedRow;

    let waiterError: unknown;
    const waiterStart = performance.now();
    try {
      await chaosPrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '800ms'`;
        await tx.pharmacy.update({ where: { id: pharmacy.id }, data: { pharmacistName: "Waiter Değeri" } });
      });
    } catch (error) {
      waiterError = error;
    }
    const waiterDurationMs = performance.now() - waiterStart;

    expect(waiterError).toBeDefined();
    expect(waiterDurationMs).toBeLessThan(3_000);

    releaseHolder();
    await holderTx;

    // Only the holder's committed value is present — the waiter's
    // timed-out update left no trace (no partial/lost-update commit).
    const finalRow = await chaosPrisma.pharmacy.findUnique({ where: { id: pharmacy.id } });
    expect(finalRow?.pharmacistName).toBe("Holder Değeri");

    // Subsequent request succeeds now that the row lock is released.
    await chaosPrisma.pharmacy.update({ where: { id: pharmacy.id }, data: { pharmacistName: "Sonraki İstek" } });
    const afterRelease = await chaosPrisma.pharmacy.findUnique({ where: { id: pharmacy.id } });
    expect(afterRelease?.pharmacistName).toBe("Sonraki İstek");
  }, 30_000);
});
