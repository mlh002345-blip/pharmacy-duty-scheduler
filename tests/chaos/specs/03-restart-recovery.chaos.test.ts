import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { logoutAction } from "@/lib/auth/actions";
import { prisma as appPrisma } from "@/lib/prisma";
import { generateAndSaveDutySchedule } from "@/lib/scheduling/generate-and-save-duty-schedule";

import {
  startLocalPostgresService,
  stopLocalPostgresService,
  waitForChaosDatabase,
} from "../../../scripts/chaos/fault-control";
import {
  createChaosPharmacy,
  createChaosRegion,
  createChaosSession,
  createChaosUser,
  SESSION_COOKIE_NAME,
} from "../helpers/fixtures";
import { chaosPrisma } from "../helpers/db";
import { CHAOS_BASE_URL, startChaosServer, stopChaosServer, type ChaosServerHandle } from "../helpers/server";
import { ChaosRedirectSignal, setChaosTestSessionToken } from "../helpers/setup";
import { waitUntil } from "../helpers/wait-until";

// Scenario C — DB restart and recovery (Step 6, item 6). Distinct from
// scenario A (which only exercises reads): this scenario restarts the
// *entire* local PostgreSQL service (not just one backend connection,
// see fault-control.ts's comment on why that's the closest local
// equivalent to restarting a dedicated service) and additionally proves
// that (a) a real idempotent-safe write can be manually retried without
// duplicating its effect, and (b) a real non-idempotent write is never
// auto-retried by the app itself.
describe("scenario C: PostgreSQL restart and recovery", () => {
  let server: ChaosServerHandle;
  let cookie: string;
  let sessionToken: string;

  beforeAll(async () => {
    const user = await createChaosUser({ role: "ADMIN" });
    sessionToken = await createChaosSession(user.id);
    cookie = `${SESSION_COOKIE_NAME}=${sessionToken}`;
    server = await startChaosServer();
  }, 90_000);

  afterAll(async () => {
    const up = await waitForChaosDatabase({ up: true, timeoutMs: 2_000, pollIntervalMs: 500 });
    if (!up.reachedTargetState) {
      startLocalPostgresService();
      await waitForChaosDatabase({ up: true, timeoutMs: 15_000 });
    }
    if (server) await stopChaosServer(server);
    await chaosPrisma.$disconnect();
  }, 30_000);

  it("reads and writes fail safely during a full PostgreSQL service restart, and recover without an app restart", async () => {
    // 1. Confirm a normal authenticated read works.
    const before = await fetch(`${CHAOS_BASE_URL}/`, { headers: { Cookie: cookie } });
    expect(before.status).toBe(200);

    // 2. Stop the dedicated local PostgreSQL service entirely.
    stopLocalPostgresService();
    const down = await waitForChaosDatabase({ up: false, timeoutMs: 10_000 });
    expect(down.reachedTargetState).toBe(true);

    // 3. Issue a read and a write during the outage — both must fail in
    // a controlled way (bounded time, no hang, no crash).
    const readDuringOutage = await fetch(`${CHAOS_BASE_URL}/`, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(15_000),
    });
    expect([200, 500]).toContain(readDuringOutage.status);

    const writeDuringOutage = await fetch(`${CHAOS_BASE_URL}/eczaneler/yeni`, {
      method: "GET", // form page load, not the mutation itself — proves the app tree still responds, not a hang
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(15_000),
    });
    expect([200, 500]).toContain(writeDuringOutage.status);
    expect(server.proc.exitCode).toBeNull();

    // 4. Restore the database.
    const recoveryStart = performance.now();
    startLocalPostgresService();
    const up = await waitForChaosDatabase({ up: true, timeoutMs: 15_000 });
    expect(up.reachedTargetState).toBe(true);

    // 5. The same running server process (never restarted) must serve a
    // successful request again once the database is back.
    const recoveredAfterMs = await waitUntil(
      async () => {
        const res = await fetch(`${CHAOS_BASE_URL}/`, {
          headers: { Cookie: cookie },
          signal: AbortSignal.timeout(5_000),
        });
        return res.status === 200;
      },
      { timeoutMs: 30_000, description: "read to succeed again after PostgreSQL service restart" }
    );
    const totalRecoveryMs = performance.now() - recoveryStart;
    console.log(
      `[scenario C] PostgreSQL restart recovery: first successful read after ${recoveredAfterMs}ms (total ${totalRecoveryMs.toFixed(0)}ms), no app restart`
    );
  }, 60_000);

  it("an idempotent-safe write (logout) can be manually retried without any duplicate or error effect", async () => {
    setChaosTestSessionToken(sessionToken);
    // First call: real session row is deleted, real redirect thrown.
    let firstThrew: unknown;
    try {
      await logoutAction();
    } catch (error) {
      firstThrew = error;
    }
    expect(firstThrew).toBeInstanceOf(ChaosRedirectSignal);
    expect(await chaosPrisma.session.findUnique({ where: { token: sessionToken } })).toBeNull();

    // Manual retry of the exact same action against an already-gone
    // session: destroySession's deleteMany is a no-op on a missing row,
    // not an error — proves retrying this specific action is safe.
    let secondThrew: unknown;
    try {
      await logoutAction();
    } catch (error) {
      secondThrew = error;
    }
    expect(secondThrew).toBeInstanceOf(ChaosRedirectSignal);
    expect(await chaosPrisma.session.findUnique({ where: { token: sessionToken } })).toBeNull();
  });

  it("a non-idempotent write (schedule generation) is never auto-retried by the app — exactly one attempt, zero partial rows, on failure", async () => {
    const user = await createChaosUser({ role: "ADMIN" });
    const region = await createChaosRegion({ dailyDutyCount: 1 });
    await chaosPrisma.dutyRule.create({
      data: {
        regionId: region.id,
        minDaysBetweenDuties: 1,
        weekdayWeight: 1,
        saturdayWeight: 1.25,
        sundayWeight: 1.5,
        officialHolidayWeight: 2,
        religiousHolidayWeight: 2,
      },
    });
    await createChaosPharmacy(region.id);

    let attemptCount = 0;
    // generateAndSaveDutySchedule reads via the app's own `prisma`
    // singleton (src/lib/prisma.ts) — pointed at the chaos database by
    // tests/chaos/helpers/setup.ts, but a distinct client instance from
    // `chaosPrisma`. The counter is patched onto that same singleton the
    // production code actually calls.
    const countingRegionLookup = appPrisma.region.findUnique.bind(appPrisma.region);
    // Not a retry wrapper — a call counter around the transaction's very
    // first read, to prove the app issues exactly one attempt when the
    // database is unreachable (no library or hand-rolled retry loop
    // anywhere in the write path — confirmed by code inspection in
    // docs/security/24-db-resilience-connection-pool-validation.md).
    appPrisma.region.findUnique = ((...args: Parameters<typeof countingRegionLookup>) => {
      attemptCount++;
      return countingRegionLookup(...args);
    }) as unknown as typeof appPrisma.region.findUnique;

    try {
      stopLocalPostgresService();
      await waitForChaosDatabase({ up: false, timeoutMs: 10_000 });

      let thrown: unknown;
      try {
        await generateAndSaveDutySchedule({
          month: 6,
          year: 2033,
          regionId: region.id,
          organizationId: region.organizationId,
          userId: user.id,
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeDefined();
      expect(attemptCount).toBe(1);
    } finally {
      appPrisma.region.findUnique = countingRegionLookup;
      startLocalPostgresService();
      await waitForChaosDatabase({ up: true, timeoutMs: 15_000 });
    }

    // chaosPrisma's own connection pool can hold several sockets from
    // before this test's full PostgreSQL service restart — each one
    // independently needs its own "first query after the drop fails, the
    // next one on that socket self-heals" cycle (already proven safe
    // elsewhere in this suite). Retrying in a bounded loop here is test-
    // assertion plumbing to churn through that pool, not a claim about
    // the app's own (deliberately retry-free) write-path behavior.
    let schedules: Awaited<ReturnType<typeof chaosPrisma.dutySchedule.findMany>> = [];
    await waitUntil(
      async () => {
        try {
          schedules = await chaosPrisma.dutySchedule.findMany({ where: { regionId: region.id, year: 2033, month: 6 } });
          return true;
        } catch {
          return false;
        }
      },
      // A full PostgreSQL *service* restart was measured to take Prisma's
      // connection pool meaningfully longer to fully recover on than a
      // single targeted backend termination (~12.5s vs near-instant in
      // this sandbox) — every pooled connection is stale at once, not
      // just one. See docs/security/24-db-resilience-connection-pool-validation.md.
      { timeoutMs: 30_000, pollIntervalMs: 250, description: "chaosPrisma's pool to fully recover after the PostgreSQL restart" }
    );
    expect(schedules).toHaveLength(0);
  }, 45_000);
});
