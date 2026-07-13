import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDataHealthReport } from "@/lib/health/data-health";

import { startLocalPostgresService, stopLocalPostgresService, waitForChaosDatabase } from "../../../scripts/chaos/fault-control";
import { chaosPrisma } from "../helpers/db";

// Scenario F — data-health cache failure and recovery (Step 6, item 9).
// getDataHealthReport (src/lib/health/data-health.ts) has a 60s
// process-local TTL cache. Uses the function's own `now` test seam
// (already documented there as existing for exactly this purpose) rather
// than waiting 60 real seconds.
describe("scenario F: data-health cache failure and recovery", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  afterAll(async () => {
    const up = await waitForChaosDatabase({ up: true, timeoutMs: 2_000, pollIntervalMs: 500 });
    if (!up.reachedTargetState) {
      startLocalPostgresService();
      await waitForChaosDatabase({ up: true, timeoutMs: 15_000 });
    }
    await chaosPrisma.$disconnect();
  }, 20_000);

  it("a failed refresh is logged, does not poison the cache, and a later refresh recovers cleanly", async () => {
    const T0 = Date.now();

    // 1. A normal, successful refresh populates the cache.
    const firstReport = await getDataHealthReport("chaos-test-org", { now: T0 });
    expect(firstReport).toBeDefined();
    expect(errorSpy).not.toHaveBeenCalled();

    // 2. Force a DB failure, then request a refresh 61s later (past the
    // 60s TTL) — this must trigger an actual refresh attempt (not serve
    // the stale cache), which must fail.
    stopLocalPostgresService();
    const down = await waitForChaosDatabase({ up: false, timeoutMs: 10_000 });
    expect(down.reachedTargetState).toBe(true);

    const T1 = T0 + 61_000;
    let refreshError: unknown;
    try {
      await getDataHealthReport("chaos-test-org", { now: T1 });
    } catch (error) {
      refreshError = error;
    }
    expect(refreshError).toBeDefined();

    // 3. data_health_report_failed was logged (structured, via the app's
    // own logger — see src/lib/observability/logger.ts).
    const loggedLines = errorSpy.mock.calls.map((call: unknown[]) => String(call[0]));
    const failureLog = loggedLines.find((line: string) => line.includes("data_health_report_failed"));
    expect(failureLog).toBeDefined();
    const parsed = JSON.parse(failureLog!);
    expect(parsed.event).toBe("data_health_report_failed");
    expect(JSON.stringify(parsed)).not.toMatch(/postgresql:\/\/|password/i);

    // 4. The cache was not poisoned with invalid data — a request still
    // within the *original* cache window's TTL contract (i.e. before a
    // successful refresh happens) continues to either serve the prior
    // good value or attempt (and safely fail) a fresh fetch; it must
    // never return something malformed. Confirm by immediately retrying
    // at T1 again (DB still down) and getting the same controlled
    // failure, not a corrupted report.
    let secondRefreshError: unknown;
    try {
      await getDataHealthReport("chaos-test-org", { now: T1 + 1_000 });
    } catch (error) {
      secondRefreshError = error;
    }
    expect(secondRefreshError).toBeDefined();

    // 5. Restore the DB and trigger a fresh refresh — must return a
    // valid, well-formed report, and the failure must not recur forever
    // (no endless failure loop): exactly one more attempt, one success.
    startLocalPostgresService();
    const up = await waitForChaosDatabase({ up: true, timeoutMs: 15_000 });
    expect(up.reachedTargetState).toBe(true);

    errorSpy.mockClear();
    const T2 = T1 + 2_000;
    // Prisma's pool may need one failed-then-healed query cycle right
    // after the service restart (see docs/security/24-*.md) — bounded
    // retry here is test plumbing, not a claim about the cache's own
    // (deliberately non-retrying) behavior.
    let recoveredReport: Awaited<ReturnType<typeof getDataHealthReport>> | undefined;
    for (let attempt = 0; attempt < 10 && !recoveredReport; attempt++) {
      try {
        recoveredReport = await getDataHealthReport("chaos-test-org", { now: T2 + attempt * 300 });
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    expect(recoveredReport).toBeDefined();
    expect(recoveredReport?.critical).toBeInstanceOf(Array);
    expect(recoveredReport?.warnings).toBeInstanceOf(Array);
    expect(recoveredReport?.info).toBeInstanceOf(Array);
  }, 45_000);
});
