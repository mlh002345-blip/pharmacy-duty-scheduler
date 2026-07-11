// Read-only safety preflight for the performance-benchmark database.
// Mirrors scripts/test-preflight.ts's pattern but targets PERF_DATABASE_URL.
// Applies no migration, seeds nothing, deletes nothing.
//
// Usage:
//   PERF_DATABASE_URL="postgresql://..." npm run test:perf:preflight

import { execFileSync } from "node:child_process";

import { sanitizedDatabaseIdentifier } from "../../tests/integration/helpers/test-db-guard";
import { perfDatabaseUrl, perfPrisma } from "./db";

async function main() {
  console.log("Pharmacy Duty Scheduler — perf-database preflight (read-only, no data changes)\n");

  const identifier = sanitizedDatabaseIdentifier(perfDatabaseUrl);
  console.log(`Target database (sanitized): ${identifier}`);
  console.log(
    "Safety guard: PASSED (explicit PERF_DATABASE_URL, distinct from DATABASE_URL, recognized " +
      "perf-name marker, no production marker in host or database name).\n"
  );

  try {
    const versionRows = await perfPrisma.$queryRaw<{ version: string }[]>`SELECT version() AS version`;
    console.log(`PostgreSQL server version: ${versionRows[0]?.version ?? "(unknown)"}`);

    const sizeRows = await perfPrisma.$queryRaw<{ size: string }[]>`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`;
    console.log(`Database size: ${sizeRows[0]?.size ?? "(unknown)"}`);

    const connRows = await perfPrisma.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database()`;
    console.log(`Active connections to this database: ${connRows[0]?.count ?? "(unknown)"}`);
  } catch (error) {
    console.error(`FAIL: could not query ${identifier}.`);
    console.error((error as Error).message);
    process.exit(1);
  } finally {
    await perfPrisma.$disconnect();
  }

  console.log("\nMigration status (informational only — this command applies nothing):");
  try {
    execFileSync("npx", ["prisma", "migrate", "status"], {
      env: { ...process.env, DATABASE_URL: perfDatabaseUrl },
      stdio: "inherit",
    });
  } catch {
    console.log(
      "(non-zero exit above may simply mean there are pending migrations — this preflight " +
        "does not apply them; run `npm run test:perf:seed` to apply migrations to this same " +
        "guarded perf database.)"
    );
  }

  console.log("\nPreflight complete. No rows were read, written, or deleted; no migration was applied.");
}

main().catch((error) => {
  console.error("FAIL: unexpected preflight error.");
  console.error((error as Error).message);
  process.exit(1);
});
