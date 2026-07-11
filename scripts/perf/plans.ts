// Runs EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON) for the critical
// query inventory (categories A-F, see docs/testing/LARGE_DATA_QUERY_PLAN_TEST.md)
// against the seeded PERF_DATABASE_URL, parses each plan via plan-parser.ts,
// and writes a machine-readable JSON report plus a concise markdown summary.
//
// Usage:
//   PERF_DATABASE_URL="postgresql://..." npx tsx scripts/perf/plans.ts

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { sanitizedDatabaseIdentifier } from "../../tests/integration/helpers/test-db-guard";
import { perfDatabaseUrl, perfPrisma } from "./db";
import { BENCHMARK_OUTPUT_DIR, findLatestManifest } from "./manifest";
import { isConcerningSequentialScan, summarizePlan, type ExplainJson, type PlanSummary } from "./plan-parser";

type QuerySpec = {
  category: "A" | "B" | "C" | "D" | "E" | "F";
  label: string;
  sourceRef: string;
  sql: string;
  params: unknown[];
};

type PlanReportEntry = {
  category: string;
  label: string;
  sourceRef: string;
  summary: PlanSummary;
};

async function pickSampleIds() {
  const manifest = findLatestManifest();
  const region = await perfPrisma.region.findFirst({
    where: manifest ? { id: { in: manifest.regionIds } } : undefined,
  });
  const pharmacy = await perfPrisma.pharmacy.findFirst({
    where: manifest ? { id: { in: manifest.pharmacyIds } } : undefined,
  });
  const schedule = await perfPrisma.dutySchedule.findFirst({
    where: region ? { regionId: region.id } : undefined,
    orderBy: { year: "desc" },
  });
  const user = await perfPrisma.user.findFirst({
    where: manifest ? { id: { in: manifest.userIds } } : undefined,
  });
  if (!region || !pharmacy || !user) {
    throw new Error("No seeded perf data found — run `npm run test:perf:seed` first.");
  }
  return { region, pharmacy, schedule, user };
}

function buildQuerySpecs(ids: Awaited<ReturnType<typeof pickSampleIds>>): QuerySpec[] {
  const { region, pharmacy, schedule, user } = ids;
  const monthStart = new Date(Date.UTC(2025, 0, 1));
  const monthEnd = new Date(Date.UTC(2025, 0, 31));

  const specs: QuerySpec[] = [
    // A. Unavailability
    {
      category: "A",
      label: "Unavailability pharmacy/date overlap (schedule pre-check)",
      sourceRef: "src/lib/scheduling/schedule-precheck.ts:148-155",
      sql: `SELECT "id" FROM "Unavailability" WHERE "pharmacyId" = ANY($1::text[]) AND "startDate" <= $2 AND "endDate" >= $3`,
      params: [[pharmacy.id], monthEnd, monthStart],
    },
    {
      category: "A",
      label: "Unavailability invalid date-range health check",
      sourceRef: "src/lib/health/data-health.ts:320-325",
      sql: `SELECT u."id" FROM "Unavailability" u JOIN "Pharmacy" p ON p."id" = u."pharmacyId" WHERE u."endDate" < u."startDate"`,
      params: [],
    },
    {
      category: "A",
      label: "Unavailability list pagination (/mazeretler)",
      sourceRef: "src/app/(dashboard)/mazeretler/page.tsx:36-49",
      sql: `SELECT "id" FROM "Unavailability" ORDER BY "startDate" ASC LIMIT 20 OFFSET 0`,
      params: [],
    },
    {
      category: "A",
      label: "Unavailability full-history lookup for one pharmacy (assignment edit)",
      sourceRef: "src/app/(dashboard)/cizelgeler/[id]/atama/assignment-actions.ts:90-92",
      sql: `SELECT "id" FROM "Unavailability" WHERE "pharmacyId" = $1`,
      params: [pharmacy.id],
    },

    // B. Historical duty and balance
    {
      category: "B",
      label: "HistoricalDutyRecord groupBy pharmacyId (opening balance)",
      sourceRef: "src/lib/balance/duty-balance.ts:118-136",
      sql: `SELECT "pharmacyId", count(*) FROM "HistoricalDutyRecord" WHERE "pharmacyId" IS NOT NULL GROUP BY "pharmacyId"`,
      params: [],
    },
    {
      category: "B",
      label: "HistoricalDutyRecord count matched-in-region (schedule pre-check)",
      sourceRef: "src/lib/scheduling/schedule-precheck.ts:169",
      sql: `SELECT count(*) FROM "HistoricalDutyRecord" WHERE "regionId" = $1 AND "matchStatus" = 'MATCHED'`,
      params: [region.id],
    },
    {
      category: "B",
      label: "Unbounded DutyAssignment history for one pharmacy (editDutyAssignmentAction rule-gap check)",
      sourceRef: "src/app/(dashboard)/cizelgeler/[id]/atama/assignment-actions.ts:140-142",
      sql: `SELECT "id", "date" FROM "DutyAssignment" WHERE "pharmacyId" = $1`,
      params: [pharmacy.id],
    },
    {
      category: "B",
      label: "DutyAssignment groupBy pharmacyId (nobet-dengesi aggregation)",
      sourceRef: "src/lib/balance/duty-balance.ts:55-60",
      sql: `SELECT "pharmacyId", sum("weight") FROM "DutyAssignment" WHERE "pharmacyId" = ANY(SELECT "id" FROM "Pharmacy" WHERE "regionId" = $1) GROUP BY "pharmacyId"`,
      params: [region.id],
    },

    // C. Duty requests
    {
      category: "C",
      label: "DutyRequest approved overlap for pharmacy/date range (schedule pre-check)",
      sourceRef: "src/lib/scheduling/schedule-precheck.ts:156-165",
      sql: `SELECT "id" FROM "DutyRequest" WHERE "pharmacyId" = $1 AND "status" = 'APPROVED' AND "startDate" <= $2 AND "endDate" >= $3`,
      params: [pharmacy.id, monthEnd, monthStart],
    },
    {
      category: "C",
      label: "Public open-request count",
      sourceRef: "src/app/eczane-talep/[token]/actions.ts:58-60",
      sql: `SELECT count(*) FROM "DutyRequest" WHERE "pharmacyId" = $1 AND "status" = 'PENDING' AND "source" = 'PUBLIC_LINK'`,
      params: [pharmacy.id],
    },
    {
      category: "C",
      label: "DutyRequest review-list filters/pagination",
      sourceRef: "src/app/(dashboard)/nobet-talepleri/page.tsx:95-111",
      sql: `SELECT "id" FROM "DutyRequest" ORDER BY (CASE "status" WHEN 'PENDING' THEN 0 ELSE 1 END) ASC, "createdAt" DESC LIMIT 20 OFFSET 0`,
      params: [],
    },

    // D. AuditLog
    {
      category: "D",
      label: "AuditLog createdAt-sorted pagination (/denetim-kayitlari)",
      sourceRef: "src/app/(dashboard)/denetim-kayitlari/page.tsx:137-151",
      sql: `SELECT "id" FROM "AuditLog" ORDER BY "createdAt" DESC LIMIT 20 OFFSET 0`,
      params: [],
    },
    {
      category: "D",
      label: "AuditLog filtered by actor (userId)",
      sourceRef: "src/app/(dashboard)/denetim-kayitlari/page.tsx (potential future filter)",
      sql: `SELECT "id" FROM "AuditLog" WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 20`,
      params: [user.id],
    },

    // E. DutyAssignment and schedules
    ...(schedule
      ? ([
          {
            category: "E" as const,
            label: "DutySchedule detail-page load with assignments",
            sourceRef: "src/app/(dashboard)/cizelgeler/[id]/page.tsx:76-102",
            sql: `SELECT a."id" FROM "DutyAssignment" a WHERE a."dutyScheduleId" = $1 ORDER BY a."date" ASC`,
            params: [schedule.id],
          },
          {
            category: "E" as const,
            label: "Public duty lookup by (year, month, regionId)",
            sourceRef: "src/lib/scheduling/public-duty-lookup.ts:10-13",
            sql: `SELECT "id" FROM "DutySchedule" WHERE "year" = $1 AND "month" = $2 AND "regionId" = $3`,
            params: [schedule.year, schedule.month, schedule.regionId],
          },
        ] satisfies QuerySpec[])
      : []),
    {
      category: "E",
      label: "DutyAssignment uniqueness/conflict lookup",
      sourceRef: "src/app/(dashboard)/cizelgeler/[id]/atama/assignment-actions.ts:40-48",
      sql: `SELECT "id" FROM "DutyAssignment" WHERE "pharmacyId" = $1 AND "date" = $2`,
      params: [pharmacy.id, monthStart],
    },

    // F. Session/LoginAttempt
    {
      category: "F",
      label: "Session token lookup (login/session validation)",
      sourceRef: "src/lib/auth/session.ts:63-66",
      sql: `SELECT "id" FROM "Session" WHERE "token" = $1`,
      params: ["nonexistent-token-for-plan-inspection"],
    },
    {
      category: "F",
      label: "Session invalidate-by-user (password change/deactivation)",
      sourceRef: "src/lib/auth/session.ts:46",
      sql: `SELECT "id" FROM "Session" WHERE "userId" = $1`,
      params: [user.id],
    },
    {
      category: "F",
      label: "LoginAttempt rate-limit bucket lookup",
      sourceRef: "src/lib/auth/login-rate-limit.ts:72-80",
      sql: `SELECT "id" FROM "LoginAttempt" WHERE ("bucketType" = 'NETWORK' AND "bucketKey" = $1) OR ("bucketType" = 'ACCOUNT' AND "bucketKey" = $2)`,
      params: ["nonexistent-network-bucket", "nonexistent-account-bucket"],
    },
  ];

  return specs;
}

function log(message: string): void {
  console.log(`[plans] ${message}`);
}

async function main(): Promise<void> {
  log(`Target database (sanitized): ${sanitizedDatabaseIdentifier(perfDatabaseUrl)}`);
  const ids = await pickSampleIds();
  const specs = buildQuerySpecs(ids);

  const results: PlanReportEntry[] = [];
  for (const spec of specs) {
    const explainSql = `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT JSON) ${spec.sql}`;
    let json: ExplainJson;
    try {
      const rows = await perfPrisma.$queryRawUnsafe<{ "QUERY PLAN": ExplainJson }[]>(explainSql, ...spec.params);
      json = rows[0]["QUERY PLAN"];
    } catch (error) {
      log(`SKIP (${spec.label}): ${(error as Error).message}`);
      continue;
    }
    const summary = summarizePlan(json);
    results.push({ category: spec.category, label: spec.label, sourceRef: spec.sourceRef, summary });
    const concerning = summary.sequentialScans.filter((s) => isConcerningSequentialScan(s));
    const concern = concerning.length > 0 ? ` ⚠ seq scan on ${concerning.map((s) => s.relationName).join(",")}` : "";
    log(`${spec.category} | ${spec.label}: ${summary.executionTimeMs.toFixed(2)}ms${concern}`);
  }

  if (!existsSync(BENCHMARK_OUTPUT_DIR)) mkdirSync(BENCHMARK_OUTPUT_DIR, { recursive: true });
  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = join(BENCHMARK_OUTPUT_DIR, `query-plans-${runStamp}.json`);
  writeFileSync(jsonPath, JSON.stringify(results, null, 2) + "\n", "utf-8");
  log(`Machine-readable report: ${jsonPath}`);

  const md = renderMarkdown(results);
  const mdPath = join(BENCHMARK_OUTPUT_DIR, `query-plans-${runStamp}.md`);
  writeFileSync(mdPath, md, "utf-8");
  log(`Markdown summary: ${mdPath}`);
}

function renderMarkdown(results: PlanReportEntry[]): string {
  const lines: string[] = ["# Query Plan Summary", ""];
  for (const category of ["A", "B", "C", "D", "E", "F"]) {
    const entries = results.filter((r) => r.category === category);
    if (entries.length === 0) continue;
    lines.push(`## Category ${category}`, "");
    for (const e of entries) {
      const concerning = e.summary.sequentialScans.filter((s) => isConcerningSequentialScan(s));
      lines.push(`### ${e.label}`);
      lines.push(`Source: \`${e.sourceRef}\``, "");
      lines.push(
        `- Execution time: ${e.summary.executionTimeMs.toFixed(2)}ms (planning: ${e.summary.planningTimeMs.toFixed(2)}ms)`
      );
      lines.push(
        `- Sequential scans: ${e.summary.sequentialScans.length} (concerning: ${concerning.length}${concerning.length > 0 ? " — " + concerning.map((s) => `${s.relationName} (${s.actualRows}/${s.actualRows + s.rowsRemovedByFilter} rows)`).join(", ") : ""})`
      );
      lines.push(`- Index scans: ${e.summary.indexScans.length}${e.summary.indexScans.length > 0 ? " — " + e.summary.indexScans.map((s) => s.indexName ?? s.relationName).join(", ") : ""}`);
      lines.push(`- Sort disk spills: ${e.summary.sortsSpilledToDisk.length}`);
      lines.push(`- Shared buffers hit/read: ${e.summary.totalSharedHitBlocks}/${e.summary.totalSharedReadBlocks}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

main()
  .catch((err) => {
    console.error("[plans] Failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await perfPrisma.$disconnect();
  });
