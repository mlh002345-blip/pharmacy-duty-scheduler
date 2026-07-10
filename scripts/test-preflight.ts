// Pre-pilot safety preflight for the real-Postgres integration-test
// database. Read-only and non-destructive by design: it validates
// TEST_DATABASE_URL against the same safety guard used by
// `npm run test:integration`, connects and runs a single read-only
// `SELECT version()`, and reports Prisma's migration status — but it
// NEVER applies a migration, seeds, truncates, or deletes anything.
//
// Usage:
//   TEST_DATABASE_URL="postgresql://..." npm run test:preflight
//
// Exits non-zero (without connecting to anything) if TEST_DATABASE_URL
// is missing, equals DATABASE_URL (byte-identical or same host/db),
// isn't a valid PostgreSQL URL, lacks a recognized test-database name
// marker, or looks production-like — see
// tests/integration/helpers/test-db-guard.ts for the exact rules.

import { execFileSync } from "node:child_process";

import { PrismaClient } from "@prisma/client";

import {
  resolveTestDatabaseUrl,
  sanitizedDatabaseIdentifier,
} from "../tests/integration/helpers/test-db-guard";

async function main() {
  console.log("Pharmacy Duty Scheduler — test-database preflight (read-only, no data changes)\n");

  let testDatabaseUrl: string;
  try {
    testDatabaseUrl = resolveTestDatabaseUrl();
  } catch (error) {
    console.error("FAIL: TEST_DATABASE_URL failed the safety guard.");
    console.error((error as Error).message);
    process.exit(1);
  }

  const identifier = sanitizedDatabaseIdentifier(testDatabaseUrl);
  console.log(`Target database (sanitized): ${identifier}`);
  console.log("Safety guard: PASSED (explicit TEST_DATABASE_URL, distinct from DATABASE_URL, ");
  console.log("recognized test-name marker, no production marker in host or database name).\n");

  const prisma = new PrismaClient({ datasourceUrl: testDatabaseUrl });
  try {
    const versionRows = await prisma.$queryRaw<{ version: string }[]>`SELECT version() AS version`;
    const version = versionRows[0]?.version ?? "(unknown)";
    console.log(`PostgreSQL server version: ${version}`);
  } catch (error) {
    console.error(`FAIL: could not connect to ${identifier}.`);
    console.error((error as Error).message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }

  console.log("\nMigration status (informational only — this command applies nothing):");
  try {
    execFileSync("npx", ["prisma", "migrate", "status"], {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "inherit",
    });
  } catch {
    // `prisma migrate status` exits non-zero when there are pending
    // migrations — that's informational output for the operator to read
    // above, not a preflight failure in itself (the integration suite's
    // own globalSetup is what applies migrations, and only ever against
    // the same guarded TEST_DATABASE_URL).
    console.log(
      "(non-zero exit above may simply mean there are pending migrations — " +
        "this preflight does not apply them; run `npm run test:integration` " +
        "to apply migrations to this same guarded test database, or inspect " +
        "the output above.)"
    );
  }

  console.log(
    "\nPreflight complete. No rows were read, written, or deleted; no migration was applied."
  );
}

main().catch((error) => {
  console.error("FAIL: unexpected preflight error.");
  console.error((error as Error).message);
  process.exit(1);
});
