// Safe, guarded local fault-injection primitives for Step 6 (DB
// resilience/chaos testing). Every function here either (a) targets only
// the guarded CHAOS_DATABASE_URL by name, or (b) acts on the local
// PostgreSQL *service* as a whole — this sandbox runs a single shared
// local Postgres cluster (dev/test/e2e/perf/chaos databases all live in
// it), so "stop/start only the dedicated local test PostgreSQL service"
// from the task's own allowance means stopping/starting that one local
// service process, never a remote/production one. `resolveChaosDatabaseUrl()`
// already refuses to run if CHAOS_DATABASE_URL could resolve to
// production, so nothing here can reach a real Railway database no
// matter what argument is passed.
//
// No destructive action here ever targets a database by anything other
// than a name explicitly re-validated against the chaos guard's marker
// pattern, and no credential or connection string is ever logged (see
// sanitizedDatabaseIdentifier usage throughout).

import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

import { sanitizedDatabaseIdentifier } from "../../tests/integration/helpers/test-db-guard";
import { chaosDatabaseUrl } from "./db";
import { validateFaultTarget } from "./fault-target";

const CHAOS_DB_NAME = new URL(chaosDatabaseUrl).pathname.replace(/^\//, "");

function assertChaosTarget(databaseName: string): void {
  const result = validateFaultTarget(databaseName, CHAOS_DB_NAME);
  if (!result.ok) {
    throw new Error(`Refusing fault injection: ${result.reason}`);
  }
}

function adminUrl(): string {
  const url = new URL(chaosDatabaseUrl);
  url.pathname = "/postgres"; // the always-present maintenance DB, same server/credentials
  return url.toString();
}

async function withAdminConnection<T>(fn: (admin: PrismaClient) => Promise<T>): Promise<T> {
  const admin = new PrismaClient({ datasourceUrl: adminUrl() });
  try {
    return await fn(admin);
  } finally {
    await admin.$disconnect();
  }
}

/**
 * Terminates one specific backend pid — used to simulate a real
 * mid-transaction PostgreSQL disconnect at a precise, deterministic
 * point (see scenario B, tests/chaos/specs/02-transaction-rollback.chaos.test.ts):
 * the transaction's own connection reports its pid via
 * `SELECT pg_backend_pid()`, and this kills exactly that connection —
 * never a broad sweep — right after a real write inside a real
 * transaction, before it can commit.
 */
export async function terminateBackendPid(pid: number): Promise<boolean> {
  return withAdminConnection(async (admin) => {
    const rows = await admin.$queryRaw<{ pg_terminate_backend: boolean }[]>`
      SELECT pg_terminate_backend(${pid}::int)
    `;
    return rows[0]?.pg_terminate_backend ?? false;
  });
}

/** Terminates every backend connected to the chaos database except this admin connection itself. Never touches any other database's sessions. */
export async function terminateBackendsForChaosDatabase(): Promise<number> {
  assertChaosTarget(CHAOS_DB_NAME);
  return withAdminConnection(async (admin) => {
    const rows = await admin.$queryRaw<{ pg_terminate_backend: boolean }[]>`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = ${CHAOS_DB_NAME} AND pid <> pg_backend_pid()
    `;
    return rows.length;
  });
}

/** ALTER DATABASE ... CONNECTION LIMIT n, scoped to the chaos database only. */
export async function setChaosConnectionLimit(limit: number): Promise<void> {
  assertChaosTarget(CHAOS_DB_NAME);
  await withAdminConnection(async (admin) => {
    await admin.$executeRawUnsafe(`ALTER DATABASE "${CHAOS_DB_NAME}" CONNECTION LIMIT ${limit}`);
  });
}

export async function resetChaosConnectionLimit(): Promise<void> {
  await setChaosConnectionLimit(-1);
}

/** Reads pg_stat_activity for the chaos database only — used for connection-count assertions. */
export async function chaosConnectionCount(): Promise<number> {
  return withAdminConnection(async (admin) => {
    const rows = await admin.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = ${CHAOS_DB_NAME}
    `;
    return Number(rows[0]?.count ?? 0);
  });
}

// Stops/starts the *entire local* PostgreSQL service. This sandbox has
// exactly one local PostgreSQL cluster serving every dedicated test
// database (dev/test/e2e/perf/chaos) — there is no per-database
// stop/start primitive in PostgreSQL itself, so this is the closest
// available equivalent to "stop/start only the dedicated local test
// PostgreSQL service" and is never used against anything but this local,
// non-production service.
export function stopLocalPostgresService(): void {
  execFileSync("service", ["postgresql", "stop"], { stdio: "pipe" });
}

export function startLocalPostgresService(): void {
  execFileSync("service", ["postgresql", "start"], { stdio: "pipe" });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls (bounded, no blind sleep) until a fresh connection to the chaos database either succeeds or the timeout elapses. */
export async function waitForChaosDatabase(options: {
  up: boolean;
  timeoutMs: number;
  pollIntervalMs?: number;
}): Promise<{ reachedTargetState: boolean; elapsedMs: number }> {
  const pollIntervalMs = options.pollIntervalMs ?? 200;
  const start = Date.now();
  while (Date.now() - start < options.timeoutMs) {
    const probe = new PrismaClient({ datasourceUrl: chaosDatabaseUrl });
    let reachable: boolean;
    try {
      await probe.$queryRaw`SELECT 1`;
      reachable = true;
    } catch {
      reachable = false;
    } finally {
      await probe.$disconnect().catch(() => {});
    }
    if (reachable === options.up) {
      return { reachedTargetState: true, elapsedMs: Date.now() - start };
    }
    await sleep(pollIntervalMs);
  }
  return { reachedTargetState: false, elapsedMs: Date.now() - start };
}

export function sanitizedChaosTarget(): string {
  return sanitizedDatabaseIdentifier(chaosDatabaseUrl);
}
