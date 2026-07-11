// Read-only safety preflight for the chaos-test database. Mirrors
// scripts/perf/preflight.ts. Applies no migration, injects no fault,
// deletes nothing.
//
// Usage:
//   CHAOS_DATABASE_URL="postgresql://..." npm run test:chaos:preflight

import { execFileSync } from "node:child_process";

import { sanitizedDatabaseIdentifier } from "../../tests/integration/helpers/test-db-guard";
import { chaosDatabaseUrl, chaosPrisma } from "./db";

async function main() {
  console.log("Pharmacy Duty Scheduler — chaos-database preflight (read-only, no fault injection)\n");

  const identifier = sanitizedDatabaseIdentifier(chaosDatabaseUrl);
  console.log(`Target database (sanitized): ${identifier}`);
  console.log(
    "Safety guard: PASSED (explicit CHAOS_DATABASE_URL, distinct from DATABASE_URL, recognized " +
      "chaos-name marker, no production marker in host or database name).\n"
  );

  try {
    const versionRows = await chaosPrisma.$queryRaw<{ version: string }[]>`SELECT version() AS version`;
    console.log(`PostgreSQL server version: ${versionRows[0]?.version ?? "(unknown)"}`);

    const connRows = await chaosPrisma.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM pg_stat_activity WHERE datname = current_database()`;
    console.log(`Active connections to this database: ${connRows[0]?.count ?? "(unknown)"}`);

    const maxConnRows = await chaosPrisma.$queryRaw<{ setting: string }[]>`SHOW max_connections`;
    console.log(`max_connections: ${maxConnRows[0]?.setting ?? "(unknown)"}`);
  } catch (error) {
    console.error(`FAIL: could not query ${identifier}.`);
    console.error((error as Error).message);
    process.exit(1);
  } finally {
    await chaosPrisma.$disconnect();
  }

  console.log("\nMigration status (informational only — this command applies nothing):");
  try {
    execFileSync("npx", ["prisma", "migrate", "status"], {
      env: { ...process.env, DATABASE_URL: chaosDatabaseUrl },
      stdio: "inherit",
    });
  } catch {
    console.log(
      "(non-zero exit above may simply mean there are pending migrations — this preflight " +
        "does not apply them; the chaos suite's global setup applies migrations to this same " +
        "guarded chaos database before any scenario runs.)"
    );
  }

  console.log("\nPreflight complete. No fault was injected; no rows were written or deleted; no migration was applied.");
}

main().catch((error) => {
  console.error("FAIL: unexpected preflight error.");
  console.error((error as Error).message);
  process.exit(1);
});
