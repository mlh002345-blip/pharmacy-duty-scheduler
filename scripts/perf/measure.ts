// Baseline application measurement against a real production build
// (`next build && next start`) pointed at PERF_DATABASE_URL, using
// authenticated requests from a synthetic benchmark user. Never touches
// DATABASE_URL — the app process itself is launched with DATABASE_URL
// overridden to the guarded perf database for the duration of this run
// only (same technique as playwright.config.ts's webServer for Step 4's
// E2E suite).
//
// Usage:
//   PERF_DATABASE_URL="postgresql://..." npx tsx scripts/perf/measure.ts

import { randomBytes } from "node:crypto";
import { ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { SESSION_COOKIE_NAME } from "../../src/lib/auth/session";
import { sanitizedDatabaseIdentifier } from "../../tests/integration/helpers/test-db-guard";
import { perfDatabaseUrl, perfPrisma } from "./db";
import { BENCHMARK_OUTPUT_DIR, findLatestManifest } from "./manifest";
import { computeDurationStats, type DurationStats } from "./percentile";

const PORT = 3211;
const BASE_URL = `http://localhost:${PORT}`;
const WARMUP_ITERATIONS = 3;
const MEASURE_ITERATIONS = 10;
const SERVER_READY_TIMEOUT_MS = 180_000;

type PageTarget = {
  path: string;
  label: string;
  method?: "GET";
};

type MeasurementResult = {
  label: string;
  path: string;
  status: number | null;
  errorRate: number;
  responseSizeBytes: number | null;
  durationStats: DurationStats;
};

function log(message: string): void {
  console.log(`[measure] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await sleep(1_000);
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

function readRssKb(pid: number): number | null {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf-8");
    const match = status.match(/VmRSS:\s+(\d+) kB/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

async function ensureBenchmarkUserSession(): Promise<{ cookie: string }> {
  const manifest = findLatestManifest();
  if (!manifest || manifest.userIds.length === 0) {
    throw new Error("No perf manifest with seeded users found — run `npm run test:perf:seed` first.");
  }
  const adminUser = await perfPrisma.user.findFirst({
    where: { id: { in: manifest.userIds }, role: "ADMIN" },
  });
  if (!adminUser) throw new Error("No seeded ADMIN user found in the perf dataset.");

  const token = randomBytes(32).toString("hex");
  await perfPrisma.session.create({
    data: {
      token,
      userId: adminUser.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return { cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function findPopulatedScheduleId(): Promise<string | null> {
  const manifest = findLatestManifest();
  if (!manifest) return null;
  const assignment = await perfPrisma.dutyAssignment.findFirst({
    where: { dutySchedule: { regionId: { in: manifest.regionIds } } },
    select: { dutyScheduleId: true, id: true },
  });
  return assignment?.dutyScheduleId ?? null;
}

async function findAssignmentEditPath(scheduleId: string): Promise<string | null> {
  const assignment = await perfPrisma.dutyAssignment.findFirst({ where: { dutyScheduleId: scheduleId } });
  if (!assignment) return null;
  return `/cizelgeler/${scheduleId}/atama/${assignment.id}/duzenle`;
}

async function measureTarget(target: PageTarget, cookie: string): Promise<MeasurementResult> {
  const durations: number[] = [];
  let lastStatus: number | null = null;
  let lastSize: number | null = null;
  let errors = 0;

  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    try {
      await fetch(`${BASE_URL}${target.path}`, { headers: { Cookie: cookie } });
    } catch {
      // warm-up failures are not counted
    }
  }

  for (let i = 0; i < MEASURE_ITERATIONS; i++) {
    const start = performance.now();
    try {
      const res = await fetch(`${BASE_URL}${target.path}`, { headers: { Cookie: cookie } });
      const body = await res.arrayBuffer();
      const duration = performance.now() - start;
      durations.push(duration);
      lastStatus = res.status;
      lastSize = body.byteLength;
      if (res.status >= 500) errors++;
    } catch {
      durations.push(performance.now() - start);
      errors++;
    }
  }

  return {
    label: target.label,
    path: target.path,
    status: lastStatus,
    errorRate: errors / MEASURE_ITERATIONS,
    responseSizeBytes: lastSize,
    durationStats: computeDurationStats(durations),
  };
}

async function main(): Promise<void> {
  log(`Target database (sanitized): ${sanitizedDatabaseIdentifier(perfDatabaseUrl)}`);

  const { cookie } = await ensureBenchmarkUserSession();
  const scheduleId = await findPopulatedScheduleId();
  const assignmentEditPath = scheduleId ? await findAssignmentEditPath(scheduleId) : null;

  const targets: PageTarget[] = [
    { path: "/", label: "Dashboard" },
    { path: "/eczaneler", label: "Eczaneler" },
    { path: "/mazeretler", label: "Mazeretler" },
    { path: "/nobet-talepleri", label: "Nöbet Talepleri" },
    { path: "/gecmis-nobetler", label: "Geçmiş Nöbetler" },
    { path: "/nobet-dengesi", label: "Nöbet Dengesi" },
    { path: "/veri-kontrol", label: "Veri Kontrol" },
    { path: "/denetim-kayitlari", label: "Denetim Kayıtları" },
    { path: "/cizelgeler", label: "Çizelgeler" },
  ];
  if (scheduleId) targets.push({ path: `/cizelgeler/${scheduleId}`, label: "Çizelge Detay (populated)" });
  if (assignmentEditPath) targets.push({ path: assignmentEditPath, label: "Atama Düzenle" });
  if (scheduleId) {
    targets.push({ path: `/cizelgeler/${scheduleId}/export/excel`, label: "Excel Export" });
    targets.push({ path: `/cizelgeler/${scheduleId}/export/pdf`, label: "PDF Export" });
  }

  log(`Building and starting production server on port ${PORT}...`);
  const serverProcess: ChildProcess = spawn("sh", ["-c", `npm run build && npm run start -- -p ${PORT}`], {
    env: { ...process.env, DATABASE_URL: perfDatabaseUrl, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout?.on("data", () => {});
  serverProcess.stderr?.on("data", () => {});

  try {
    await waitForServer(BASE_URL, SERVER_READY_TIMEOUT_MS);
    log("Server ready.");

    const rssBefore = serverProcess.pid ? readRssKb(serverProcess.pid) : null;
    const connBefore = await perfPrisma.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database()`;
    const dbSizeBefore = await perfPrisma.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database())::bigint AS size`;

    const results: MeasurementResult[] = [];
    for (const target of targets) {
      log(`Measuring ${target.label} (${target.path})...`);
      const result = await measureTarget(target, cookie);
      results.push(result);
      log(
        `  status=${result.status} p50=${result.durationStats.p50?.toFixed(0)}ms p95=${result.durationStats.p95?.toFixed(0)}ms errorRate=${result.errorRate}`
      );
    }

    const rssAfter = serverProcess.pid ? readRssKb(serverProcess.pid) : null;
    const connAfter = await perfPrisma.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database()`;
    const dbSizeAfter = await perfPrisma.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database())::bigint AS size`;

    if (!existsSync(BENCHMARK_OUTPUT_DIR)) mkdirSync(BENCHMARK_OUTPUT_DIR, { recursive: true });
    const report = {
      measuredAt: new Date().toISOString(),
      warmupIterations: WARMUP_ITERATIONS,
      measureIterations: MEASURE_ITERATIONS,
      processMemoryRssKb: { before: rssBefore, after: rssAfter },
      pgActiveConnections: { before: Number(connBefore[0]?.count ?? 0), after: Number(connAfter[0]?.count ?? 0) },
      pgDatabaseSizeBytes: { before: Number(dbSizeBefore[0]?.size ?? 0), after: Number(dbSizeAfter[0]?.size ?? 0) },
      results,
    };
    const outPath = join(BENCHMARK_OUTPUT_DIR, `measure-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf-8");
    log(`Report written: ${outPath}`);
  } finally {
    serverProcess.kill("SIGTERM");
    await sleep(500);
    if (!serverProcess.killed) serverProcess.kill("SIGKILL");
    await perfPrisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[measure] Failed:", err);
  process.exitCode = 1;
});
