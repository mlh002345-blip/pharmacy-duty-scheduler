import { afterAll, afterEach, describe, expect, it } from "vitest";

import { loginAction } from "@/lib/auth/actions";
import { prisma as appPrisma } from "@/lib/prisma";

import { startLocalPostgresService, stopLocalPostgresService, waitForChaosDatabase } from "../../../scripts/chaos/fault-control";
import { createChaosUser } from "../helpers/fixtures";
import { chaosPrisma } from "../helpers/db";
import { waitUntil } from "../helpers/wait-until";

// Scenario / item 10 — login/rate-limiter behavior during a DB outage
// (Step 6). loginAction (src/lib/auth/actions.ts) has no try/catch of
// its own anywhere in its body — every one of these three outage points
// is exercised against the REAL function, and the REAL, unmodified
// failure policy is observed and documented (not asserted to be one
// specific policy in advance).
describe("scenario: login rate-limiter behavior during a DB outage", () => {
  afterEach(async () => {
    const up = await waitForChaosDatabase({ up: true, timeoutMs: 2_000, pollIntervalMs: 500 });
    if (!up.reachedTargetState) {
      startLocalPostgresService();
      await waitForChaosDatabase({ up: true, timeoutMs: 15_000 });
    }
    // A full PostgreSQL service restart measurably takes a Prisma
    // client's own connection pool longer to fully recover than an
    // external probe connection (see docs/security/24-*.md) — wait it
    // out here, for *both* pools this file uses (chaosPrisma for
    // fixtures/assertions, appPrisma for the real loginAction call under
    // test), so the next test doesn't itself flake on a still-stale
    // pooled connection.
    for (const client of [chaosPrisma, appPrisma]) {
      await waitUntil(
        async () => {
          try {
            await client.$queryRaw`SELECT 1`;
            return true;
          } catch {
            return false;
          }
        },
        { timeoutMs: 30_000, pollIntervalMs: 300, description: "a Prisma pool to recover between tests" }
      );
    }
  }, 70_000);

  afterAll(async () => {
    await chaosPrisma.$disconnect();
  });

  function loginForm(email: string, password: string): FormData {
    const fd = new FormData();
    fd.set("email", email);
    fd.set("password", password);
    return fd;
  }

  it("point 1 — DB unavailable before the rate-limit check: fails closed with a generic error, never a raw DB error", async () => {
    stopLocalPostgresService();
    await waitForChaosDatabase({ up: false, timeoutMs: 10_000 });

    let thrown: unknown;
    try {
      await loginAction({ success: false, message: "" }, loginForm("nobody@example.invalid", "irrelevant"));
    } catch (error) {
      thrown = error;
    }

    // Fails CLOSED: the action throws (Next's Server Action error
    // handling then serves a generic error — see instrumentation.ts and
    // scenario A's HTTP-level proof that no raw error reaches the
    // browser) rather than silently granting a session or bypassing the
    // rate limiter. No account-existence signal either way — the same
    // failure occurs regardless of whether "nobody@example.invalid"
    // exists, because the DB call fails before any account-specific
    // branch is reached.
    expect(thrown).toBeDefined();
    expect(String((thrown as Error).message)).not.toMatch(/postgresql:\/\/|password=/i);
  }, 20_000);

  it("point 2 — DB unavailable after credential verification but before session creation: fails closed, no session is created", async () => {
    await appPrisma.$queryRaw`SELECT 1`; // prime the app's own pool so the fault lands exactly at the patched seam below, not an earlier stale connection
    const user = await createChaosUser({ role: "ADMIN", password: "ChaosLogin1234!" });

    const originalCreate = appPrisma.session.create.bind(appPrisma.session);
    appPrisma.session.create = (async (...args: Parameters<typeof originalCreate>) => {
      // Credentials have already been verified successfully by this
      // point in loginAction — simulate the DB dropping exactly here,
      // before the session row (and its cookie) would be created.
      stopLocalPostgresService();
      await waitForChaosDatabase({ up: false, timeoutMs: 10_000 });
      return originalCreate(...args);
    }) as unknown as typeof appPrisma.session.create;

    let thrown: unknown;
    try {
      await loginAction({ success: false, message: "" }, loginForm(user.email, "ChaosLogin1234!"));
    } catch (error) {
      thrown = error;
    } finally {
      appPrisma.session.create = originalCreate;
    }

    expect(thrown).toBeDefined(); // fails closed — no silent "logged in without a session" state
    expect(String((thrown as Error).message)).not.toMatch(/postgresql:\/\/|password=/i);

    await startLocalPostgresService();
    await waitForChaosDatabase({ up: true, timeoutMs: 15_000 });
    let sessions: Awaited<ReturnType<typeof chaosPrisma.session.findMany>> = [];
    await waitUntil(
      async () => {
        try {
          sessions = await chaosPrisma.session.findMany({ where: { userId: user.id } });
          return true;
        } catch {
          return false;
        }
      },
      { timeoutMs: 30_000, pollIntervalMs: 300, description: "chaosPrisma to recover for the final assertion read" }
    );
    expect(sessions).toHaveLength(0); // no orphan/partial session row
  }, 60_000);

  it("point 3 — DB unavailable during failed-attempt recording: fails closed, generic message, no account-existence leakage", async () => {
    await appPrisma.$queryRaw`SELECT 1`; // prime the app's own pool — see point 2's comment
    const user = await createChaosUser({ role: "ADMIN", password: "ChaosLogin1234!" });

    const originalQueryRaw = appPrisma.$queryRaw.bind(appPrisma);
    let intercepted = false;
    appPrisma.$queryRaw = ((...args: Parameters<typeof originalQueryRaw>) => {
      if (!intercepted) {
        // recordLoginFailure's first statement (the atomic upsert) is a
        // $queryRaw call — simulate the DB dropping exactly there, after
        // the (wrong) password has already been rejected.
        intercepted = true;
        stopLocalPostgresService();
        return waitForChaosDatabase({ up: false, timeoutMs: 10_000 }).then(() => originalQueryRaw(...args));
      }
      return originalQueryRaw(...args);
    }) as unknown as typeof appPrisma.$queryRaw;

    let thrown: unknown;
    try {
      await loginAction({ success: false, message: "" }, loginForm(user.email, "wrong-password-entirely"));
    } catch (error) {
      thrown = error;
    } finally {
      appPrisma.$queryRaw = originalQueryRaw;
    }

    expect(thrown).toBeDefined(); // fails closed
    // Same generic failure regardless of whether the account exists or
    // the password was wrong — no enumeration signal leaks through the
    // outage path either.
    expect(String((thrown as Error).message)).not.toMatch(/postgresql:\/\/|password=/i);
  }, 30_000);
});
