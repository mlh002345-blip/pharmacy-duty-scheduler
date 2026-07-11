// Read-only safety preflight for the Excel/XLSX file-security test
// database. Mirrors scripts/chaos/preflight.ts and scripts/perf/preflight.ts.
//
// Usage:
//   FILE_TEST_DATABASE_URL="postgresql://..." npm run test:file:preflight

import { execFileSync } from "node:child_process";

import { sanitizedDatabaseIdentifier } from "../../tests/integration/helpers/test-db-guard";
import { fileTestDatabaseUrl, fileTestPrisma } from "./db";

async function main() {
  console.log("Pharmacy Duty Scheduler — file-security-test database preflight (read-only)\n");

  const identifier = sanitizedDatabaseIdentifier(fileTestDatabaseUrl);
  console.log(`Target database (sanitized): ${identifier}`);
  console.log(
    "Safety guard: PASSED (explicit FILE_TEST_DATABASE_URL, distinct from DATABASE_URL, recognized " +
      "file-test-name marker, no production marker in host or database name).\n"
  );

  try {
    const versionRows = await fileTestPrisma.$queryRaw<{ version: string }[]>`SELECT version() AS version`;
    console.log(`PostgreSQL server version: ${versionRows[0]?.version ?? "(unknown)"}`);
  } catch (error) {
    console.error(`FAIL: could not query ${identifier}.`);
    console.error((error as Error).message);
    process.exit(1);
  } finally {
    await fileTestPrisma.$disconnect();
  }

  console.log("\nMigration status (informational only — this command applies nothing):");
  try {
    execFileSync("npx", ["prisma", "migrate", "status"], {
      env: { ...process.env, DATABASE_URL: fileTestDatabaseUrl },
      stdio: "inherit",
    });
  } catch {
    console.log(
      "(non-zero exit above may simply mean there are pending migrations — this preflight " +
        "does not apply them; the test suite's own global setup applies migrations to this " +
        "same guarded database before any test runs.)"
    );
  }

  console.log("\nPreflight complete. No rows were read, written, or deleted; no migration was applied.");
}

main().catch((error) => {
  console.error("FAIL: unexpected preflight error.");
  console.error((error as Error).message);
  process.exit(1);
});
