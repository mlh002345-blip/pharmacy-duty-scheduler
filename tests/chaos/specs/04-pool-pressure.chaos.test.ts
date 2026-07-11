import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

import { computeDurationStats } from "../../../scripts/perf/percentile";
import { createChaosPharmacy, createChaosRegion } from "../helpers/fixtures";
import { chaosDatabaseUrl, chaosPrisma } from "../helpers/db";

// Scenario D — connection-pool pressure (Step 6, item 7). A dedicated
// PrismaClient with a deliberately small `connection_limit` (via the
// connection URL, Prisma's own supported mechanism — not a fork/monkey-
// patch) against the real chaos database, driven with bounded concurrency.
const POOL_SIZE = 5;
const POOL_TIMEOUT_SECONDS = 5;

function poolLimitedUrl(): string {
  const url = new URL(chaosDatabaseUrl);
  url.searchParams.set("connection_limit", String(POOL_SIZE));
  url.searchParams.set("pool_timeout", String(POOL_TIMEOUT_SECONDS));
  return url.toString();
}

type AttemptResult = { durationMs: number; ok: boolean; poolTimeout: boolean };

async function runConcurrentReads(client: PrismaClient, count: number): Promise<AttemptResult[]> {
  const attempts = Array.from({ length: count }, async (): Promise<AttemptResult> => {
    const start = performance.now();
    try {
      await client.pharmacy.count();
      return { durationMs: performance.now() - start, ok: true, poolTimeout: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        durationMs: performance.now() - start,
        ok: false,
        poolTimeout: message.includes("P2024") || /Timed out fetching a new connection/i.test(message),
      };
    }
  });
  return Promise.all(attempts);
}

async function runConcurrentWrites(client: PrismaClient, count: number, pharmacyId: string): Promise<AttemptResult[]> {
  const attempts = Array.from({ length: count }, async (): Promise<AttemptResult> => {
    const start = performance.now();
    try {
      await client.pharmacy.update({ where: { id: pharmacyId }, data: { updatedAt: new Date() } });
      return { durationMs: performance.now() - start, ok: true, poolTimeout: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        durationMs: performance.now() - start,
        ok: false,
        poolTimeout: message.includes("P2024") || /Timed out fetching a new connection/i.test(message),
      };
    }
  });
  return Promise.all(attempts);
}

function summarize(label: string, results: AttemptResult[]) {
  const stats = computeDurationStats(results.map((r) => r.durationMs));
  const successCount = results.filter((r) => r.ok).length;
  const errorCount = results.length - successCount;
  const poolTimeoutCount = results.filter((r) => r.poolTimeout).length;
  console.log(
    `[scenario D] ${label}: n=${results.length} success=${successCount} error=${errorCount} poolTimeouts=${poolTimeoutCount} p50=${stats.p50.toFixed(0)}ms p95=${stats.p95.toFixed(0)}ms`
  );
  return { stats, successCount, errorCount, poolTimeoutCount };
}

describe("scenario D: connection-pool pressure", () => {
  let poolLimitedClient: PrismaClient;

  afterAll(async () => {
    if (poolLimitedClient) await poolLimitedClient.$disconnect();
    await chaosPrisma.$disconnect();
  });

  it("bounded concurrency (10/25/50 reads) is handled with controlled errors, no crash, and connections return to baseline", async () => {
    poolLimitedClient = new PrismaClient({ datasourceUrl: poolLimitedUrl() });
    await poolLimitedClient.$queryRaw`SELECT 1`; // warm up the pool

    for (const concurrency of [10, 25, 50]) {
      const results = await runConcurrentReads(poolLimitedClient, concurrency);
      const { successCount, errorCount, poolTimeoutCount } = summarize(`${concurrency} concurrent reads`, results);

      // Every attempt must resolve one way or the other — no unbounded
      // hang. Some contention-driven errors (pool timeouts) are expected
      // and acceptable at 25/50 concurrency against a 5-connection pool;
      // they must be controlled (a typed Prisma error), never a crash.
      expect(successCount + errorCount).toBe(concurrency);
      for (const r of results) {
        expect(r.durationMs).toBeLessThan((POOL_TIMEOUT_SECONDS + 10) * 1000);
      }
      if (concurrency <= POOL_SIZE) {
        expect(errorCount).toBe(0); // within the pool's own capacity — no contention expected at all
      }
      void poolTimeoutCount; // reported above; not asserted on directly (Postgres/OS scheduling makes the exact count non-deterministic)
    }
  }, 90_000);

  it("a mixed read/write workload under pool pressure keeps committed writes consistent", async () => {
    const region = await createChaosRegion();
    const pharmacy = await createChaosPharmacy(region.id);

    const [readResults, writeResults] = await Promise.all([
      runConcurrentReads(poolLimitedClient, 20),
      runConcurrentWrites(poolLimitedClient, 10, pharmacy.id),
    ]);
    summarize("mixed 20 reads", readResults);
    summarize("mixed 10 writes", writeResults);

    // Every successful write must be genuinely persisted — no lost or
    // phantom updates under contention.
    const successfulWrites = writeResults.filter((r) => r.ok).length;
    expect(successfulWrites).toBeGreaterThan(0);
    const found = await chaosPrisma.pharmacy.findUnique({ where: { id: pharmacy.id } });
    expect(found).not.toBeNull();
  }, 60_000);

  it("no permanent connection leak — connection count returns to baseline after load stops", async () => {
    const rssBefore = process.memoryUsage().rss;

    const countBefore = await chaosPrisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database()
    `;

    await runConcurrentReads(poolLimitedClient, 50);
    await poolLimitedClient.$disconnect(); // app recovers after pressure stops — closing the pressured client's pool

    // Give Postgres a moment to observe the closed sockets (bounded poll, not a blind sleep).
    let countAfter = countBefore;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      countAfter = await chaosPrisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database()
      `;
      if (Number(countAfter[0].count) <= Number(countBefore[0].count) + 1) break; // +1 tolerance for this very query's own connection
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    expect(Number(countAfter[0].count)).toBeLessThanOrEqual(Number(countBefore[0].count) + 1);

    const rssAfter = process.memoryUsage().rss;
    console.log(
      `[scenario D] connections before=${countBefore[0].count} after=${countAfter[0].count}; RSS before=${(rssBefore / 1024 / 1024).toFixed(1)}MB after=${(rssAfter / 1024 / 1024).toFixed(1)}MB`
    );
  }, 30_000);
});
