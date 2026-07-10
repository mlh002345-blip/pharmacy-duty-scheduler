import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { loginAction } from "@/lib/auth/actions";
import {
  MAX_FAILED_ATTEMPTS,
  checkLoginRateLimit,
  hashAccountIdentifier,
  recordLoginFailure,
} from "@/lib/auth/login-rate-limit";
import { UNTRUSTED_NETWORK_BUCKET_KEY } from "@/lib/security/client-identity";
import { raceThroughGate } from "./helpers/gate";
import { createTestUser, cleanupTrackedIds, newTrackedIds, testRunId } from "./helpers/fixtures";

async function deleteBucket(bucketType: "NETWORK" | "ACCOUNT", bucketKey: string) {
  await prisma.loginAttempt.deleteMany({ where: { bucketType, bucketKey } });
}

describe("login rate-limit concurrency (real Postgres)", () => {
  // Every test registers the bucket keys it touches here, and cleanup
  // always runs in afterEach (not at the end of each `it`) so that a
  // failed assertion mid-test still leaves zero leaked rows — a manual
  // cleanup call placed after the assertions would never run if an
  // earlier assertion threw.
  let usedAccountKeys: string[] = [];
  let usedNetworkKeys: string[] = [];

  afterEach(async () => {
    // The untrusted-network bucket is a single shared row across every
    // request made with TRUST_PROXY_HEADERS off (by design — see
    // src/lib/security/client-identity.ts) — always cleaned here too so
    // it never leaks state into the next test in this file.
    await Promise.all([
      ...usedAccountKeys.map((key) => deleteBucket("ACCOUNT", key)),
      ...usedNetworkKeys.map((key) => deleteBucket("NETWORK", key)),
      deleteBucket("NETWORK", UNTRUSTED_NETWORK_BUCKET_KEY),
    ]);
    usedAccountKeys = [];
    usedNetworkKeys = [];
  });

  it("two genuinely concurrent recordLoginFailure calls against the same account never lose an increment", async () => {
    const accountBucketKey = `test-account-${testRunId()}`;
    const networkBucketKey = `test-network-${testRunId()}`;
    usedAccountKeys.push(accountBucketKey);
    usedNetworkKeys.push(networkBucketKey);

    await raceThroughGate(
      () => recordLoginFailure({ networkBucketKey, accountBucketKey }),
      () => recordLoginFailure({ networkBucketKey, accountBucketKey })
    );

    const row = await prisma.loginAttempt.findUniqueOrThrow({
      where: { bucketType_bucketKey: { bucketType: "ACCOUNT", bucketKey: accountBucketKey } },
    });
    expect(row.failureCount).toBe(2);
    expect(row.blockedUntil).toBeNull();
  });

  it("concurrent attempts crossing the threshold together produce exactly one persisted block, with an accurate failure count", async () => {
    const accountBucketKey = `test-account-${testRunId()}`;
    const networkBucketKey = `test-network-${testRunId()}`;
    usedAccountKeys.push(accountBucketKey);
    usedNetworkKeys.push(networkBucketKey);

    // Bring the account to MAX_FAILED_ATTEMPTS - 2 sequentially first, so
    // the final two attempts are the ones that genuinely race across the
    // threshold boundary.
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 2; i++) {
      await recordLoginFailure({ networkBucketKey, accountBucketKey });
    }

    const [r1, r2] = await raceThroughGate(
      () => recordLoginFailure({ networkBucketKey, accountBucketKey }),
      () => recordLoginFailure({ networkBucketKey, accountBucketKey })
    );

    expect(r1.status).toBe("fulfilled");
    expect(r2.status).toBe("fulfilled");

    const row = await prisma.loginAttempt.findUniqueOrThrow({
      where: { bucketType_bucketKey: { bucketType: "ACCOUNT", bucketKey: accountBucketKey } },
    });
    // No lost update: exactly (MAX_FAILED_ATTEMPTS - 2) + 2 = MAX_FAILED_ATTEMPTS.
    expect(row.failureCount).toBe(MAX_FAILED_ATTEMPTS);
    expect(row.blockedUntil).not.toBeNull();
    expect(row.blockedUntil!.getTime()).toBeGreaterThan(Date.now());

    const check = await checkLoginRateLimit({ networkBucketKey, accountBucketKey });
    expect(check.blocked).toBe(true);
  });

  it("cooldown expiry allows attempts again without any successful login", async () => {
    const accountBucketKey = `test-account-${testRunId()}`;
    const networkBucketKey = `test-network-${testRunId()}`;
    usedAccountKeys.push(accountBucketKey);
    usedNetworkKeys.push(networkBucketKey);

    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      await recordLoginFailure({ networkBucketKey, accountBucketKey });
    }
    const blockedCheck = await checkLoginRateLimit({ networkBucketKey, accountBucketKey });
    expect(blockedCheck.blocked).toBe(true);

    // Simulate the cooldown having already elapsed (no code path re-runs
    // the clock — this directly manipulates the persisted window/block
    // timestamps, the same real columns the production code reads). Both
    // dimensions were incremented together by the loop above, so both
    // must be reset here for the "no longer blocked" check below to be
    // meaningful.
    const elapsed = {
      windowStart: new Date(Date.now() - 60 * 60 * 1000),
      blockedUntil: new Date(Date.now() - 1000),
    };
    await prisma.loginAttempt.update({
      where: { bucketType_bucketKey: { bucketType: "ACCOUNT", bucketKey: accountBucketKey } },
      data: elapsed,
    });
    await prisma.loginAttempt.update({
      where: { bucketType_bucketKey: { bucketType: "NETWORK", bucketKey: networkBucketKey } },
      data: elapsed,
    });

    const afterCooldown = await checkLoginRateLimit({ networkBucketKey, accountBucketKey });
    expect(afterCooldown.blocked).toBe(false);

    // The next failure resets the counter to 1 (fresh window), not 1+MAX.
    await recordLoginFailure({ networkBucketKey, accountBucketKey });
    const row = await prisma.loginAttempt.findUniqueOrThrow({
      where: { bucketType_bucketKey: { bucketType: "ACCOUNT", bucketKey: accountBucketKey } },
    });
    expect(row.failureCount).toBe(1);
    expect(row.blockedUntil).toBeNull();
  });

  describe("via the real loginAction", () => {
    const tracked = newTrackedIds();

    afterEach(async () => {
      await cleanupTrackedIds(tracked);
    });

    it("two concurrent wrong-password attempts against the same real account persist exactly 2 failures, not blocked yet", async () => {
      const user = await createTestUser(tracked, { email: `rl-${testRunId()}@integration.test` });
      const accountBucketKey = hashAccountIdentifier(user.email);
      usedAccountKeys.push(accountBucketKey);

      function formData(): FormData {
        const fd = new FormData();
        fd.set("email", user.email);
        fd.set("password", "definitely-wrong-password");
        return fd;
      }

      const [r1, r2] = await raceThroughGate(
        () => loginAction({ success: false, message: "" }, formData()),
        () => loginAction({ success: false, message: "" }, formData())
      );

      expect(r1.status).toBe("fulfilled");
      expect(r2.status).toBe("fulfilled");
      const messages = [r1, r2].map((r) =>
        r.status === "fulfilled" ? (r.value as { message: string }).message : null
      );
      for (const message of messages) {
        expect(message).toBe("Hatalı e-posta veya şifre.");
      }

      const row = await prisma.loginAttempt.findUniqueOrThrow({
        where: { bucketType_bucketKey: { bucketType: "ACCOUNT", bucketKey: accountBucketKey } },
      });
      expect(row.failureCount).toBe(2);
      expect(row.blockedUntil).toBeNull();
    });

    it("a successful login clears the account-specific failure state but leaves the shared network bucket alone", async () => {
      const user = await createTestUser(tracked, { email: `rl-${testRunId()}@integration.test` });
      const accountBucketKey = hashAccountIdentifier(user.email);
      usedAccountKeys.push(accountBucketKey);

      const wrongFormData = () => {
        const fd = new FormData();
        fd.set("email", user.email);
        fd.set("password", "wrong-password");
        return fd;
      };
      await loginAction({ success: false, message: "" }, wrongFormData());
      await loginAction({ success: false, message: "" }, wrongFormData());

      const beforeSuccess = await prisma.loginAttempt.findUniqueOrThrow({
        where: { bucketType_bucketKey: { bucketType: "ACCOUNT", bucketKey: accountBucketKey } },
      });
      expect(beforeSuccess.failureCount).toBe(2);

      const correctFormData = new FormData();
      correctFormData.set("email", user.email);
      correctFormData.set("password", "Test1234!"); // matches createTestUser's fixture password

      try {
        await loginAction({ success: false, message: "" }, correctFormData);
        throw new Error("expected loginAction to redirect (throw) on success");
      } catch (error) {
        // The real redirect() is mocked to throw in integration tests —
        // this is the expected "it succeeded" signal, not a test failure.
        if (error instanceof Error && error.message.startsWith("expected loginAction")) throw error;
      }

      const afterSuccess = await prisma.loginAttempt.findUnique({
        where: { bucketType_bucketKey: { bucketType: "ACCOUNT", bucketKey: accountBucketKey } },
      });
      expect(afterSuccess).toBeNull();

      // Clean up the session row created by the successful login (fixture
      // cleanup only tracks the user id, not sessions created as a side
      // effect of this test's own login call).
      await prisma.session.deleteMany({ where: { userId: user.id } });
    });
  });
});
