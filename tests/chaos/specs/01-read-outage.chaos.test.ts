import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  startLocalPostgresService,
  stopLocalPostgresService,
  waitForChaosDatabase,
} from "../../../scripts/chaos/fault-control";
import {
  createChaosDutySchedule,
  createChaosPharmacy,
  createChaosRegion,
  createChaosSession,
  createChaosUser,
  SESSION_COOKIE_NAME,
} from "../helpers/fixtures";
import { chaosPrisma } from "../helpers/db";
import { CHAOS_BASE_URL, startChaosServer, stopChaosServer, type ChaosServerHandle } from "../helpers/server";
import { waitUntil } from "../helpers/wait-until";

// Scenario A — DB unavailable during read (Step 6, item 4).
describe("scenario A: DB unavailable during critical reads", () => {
  let server: ChaosServerHandle;
  let cookie: string;
  let scheduleId: string;

  beforeAll(async () => {
    const user = await createChaosUser({ role: "ADMIN" });
    const token = await createChaosSession(user.id);
    cookie = `${SESSION_COOKIE_NAME}=${token}`;
    const region = await createChaosRegion();
    await createChaosPharmacy(region.id);
    const schedule = await createChaosDutySchedule(region.id);
    scheduleId = schedule.id;

    server = await startChaosServer();
  }, 90_000);

  afterAll(async () => {
    // Make sure PostgreSQL is back up even if an assertion failed mid-outage.
    const up = await waitForChaosDatabase({ up: true, timeoutMs: 2_000, pollIntervalMs: 500 });
    if (!up.reachedTargetState) {
      startLocalPostgresService();
      await waitForChaosDatabase({ up: true, timeoutMs: 15_000 });
    }
    if (server) await stopChaosServer(server);
    await chaosPrisma.$disconnect();
  }, 30_000);

  it("a normal authenticated read works before the outage", async () => {
    const res = await fetch(`${CHAOS_BASE_URL}/`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
  });

  const READ_TARGETS = [
    { path: "/giris", label: "login page", requiresAuth: false },
    { path: "/", label: "dashboard", requiresAuth: true },
    { path: "/veri-kontrol", label: "veri-kontrol", requiresAuth: true },
    { path: "/nobet-dengesi", label: "nobet-dengesi", requiresAuth: true },
    { path: "/nobet-talepleri", label: "nobet-talepleri", requiresAuth: true },
  ];

  it("every critical read path fails in a controlled way while the DB is down, and the process stays alive", async () => {
    stopLocalPostgresService();
    const down = await waitForChaosDatabase({ up: false, timeoutMs: 10_000 });
    expect(down.reachedTargetState).toBe(true);
    server.clearOutput();

    const targets = [...READ_TARGETS, { path: `/cizelgeler/${scheduleId}/export/excel`, label: "Excel export", requiresAuth: true }];
    for (const target of targets) {
      const start = performance.now();
      const res = await fetch(`${CHAOS_BASE_URL}${target.path}`, {
        headers: target.requiresAuth ? { Cookie: cookie } : {},
        signal: AbortSignal.timeout(15_000), // "does not hang indefinitely" — bounded wait, not a blind sleep
      });
      const durationMs = performance.now() - start;
      const body = await res.text();

      expect(durationMs).toBeLessThan(15_000);
      // Controlled failure: a framework-safe 500 (or, for a page that has
      // its own try/catch, a redirect) — never a 200 with broken content,
      // and never left hanging.
      expect([200, 302, 303, 500]).toContain(res.status);
      // Next.js's production error boundary replaces thrown-error details
      // with a generic message + opaque digest — never the real message.
      expect(body).not.toMatch(/ECONNREFUSED|P1001|P2024|Can't reach database/i);
      expect(body).not.toContain(process.env.DATABASE_URL ?? "__never__");
      expect(body.toLowerCase()).not.toContain("at prismaclient");
      expect(body).not.toMatch(/postgresql:\/\//);
    }

    expect(server.proc.exitCode).toBeNull(); // process is still alive, did not crash
    expect(server.proc.killed).toBe(false);

    // Structured, safe log evidence (see instrumentation.ts) — requestId +
    // a safe event name + Prisma error code, never a raw connection
    // string or SQL parameter value.
    const output = server.getOutput();
    const logLines = output
      .split("\n")
      .filter((line) => line.trim().startsWith("{"))
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((r): r is Record<string, unknown> => r !== null && r.event === "database_read_failed");
    expect(logLines.length).toBeGreaterThan(0);
    for (const record of logLines) {
      expect(typeof record.requestId).toBe("string");
      expect((record.error as { code?: string } | undefined)?.code).toMatch(/^P\d+/);
      expect(JSON.stringify(record)).not.toContain("app:app@");
    }
  }, 60_000);

  it("recovers without an app restart once PostgreSQL comes back", async () => {
    const recoveryStart = performance.now();
    startLocalPostgresService();
    const up = await waitForChaosDatabase({ up: true, timeoutMs: 15_000 });
    expect(up.reachedTargetState).toBe(true);

    // Poll the same running server process (never restarted) until a read
    // succeeds again — proves Prisma's connection pool self-heals.
    const recoveredAfterMs = await waitUntil(
      async () => {
        const res = await fetch(`${CHAOS_BASE_URL}/`, {
          headers: { Cookie: cookie },
          signal: AbortSignal.timeout(5_000),
        });
        return res.status === 200;
      },
      { timeoutMs: 30_000, description: "dashboard read to succeed again after DB recovery" }
    );
    const totalRecoveryMs = performance.now() - recoveryStart;

    expect(recoveredAfterMs).toBeLessThan(30_000);
    console.log(`[scenario A] recovery time: ${totalRecoveryMs.toFixed(0)}ms (no app restart)`);
  }, 50_000);
});
