// Compares DATABASE_URL (source, read-only) against RESTORE_DATABASE_URL
// (the restored target) to prove the restore is usable and internally
// consistent. Every query against both databases is read-only — this
// script never writes to either.
//
// Usage:
//   RESTORE_DATABASE_URL="postgresql://..." npm run db:verify:restore
//
// Never selects or prints: passwordHash, Session.token,
// Pharmacy.requestToken, or any other secret/token column.
//
// The comparison LOGIC lives in scripts/backup-restore/compare.ts (pure
// functions, unit-tested in compare.test.ts) — this file is only
// responsible for running the (real, read-only) queries and driving that
// logic.

import { createHash } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import {
  resolveRestoreDatabaseUrl,
  sanitizedDatabaseIdentifier,
} from "../../tests/integration/helpers/test-db-guard";
import {
  compareChecksum,
  compareMigrationHistory,
  compareOrphanCount,
  compareRowCount,
  compareUniqueIndexPresence,
  type Mismatch,
} from "./compare";

const TABLES = [
  "User",
  "Session",
  "Region",
  "Pharmacy",
  "DutyRule",
  "Holiday",
  "Unavailability",
  "DutySchedule",
  "DutyAssignment",
  "DutyScheduleWarning",
  "DutyRequest",
  "HistoricalDutyImportBatch",
  "HistoricalDutyRecord",
  "DutyBalanceAdjustment",
  "AuditLog",
  "LoginAttempt",
] as const;

async function countRows(prisma: PrismaClient, table: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*)::bigint AS count FROM "${table}"`
  );
  return Number(rows[0]?.count ?? 0);
}

async function orphanCount(prisma: PrismaClient, sql: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(sql);
  return Number(rows[0]?.count ?? 0);
}

async function checksumNonSecretRows(prisma: PrismaClient, sql: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql);
  const canonical = JSON.stringify(rows, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  );
  return createHash("sha256").update(canonical).digest("hex");
}

async function getMigrationNames(prisma: PrismaClient): Promise<string[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      `SELECT migration_name FROM "_prisma_migrations" ORDER BY migration_name`
    );
    return rows.map((r) => r.migration_name);
  } catch {
    return [];
  }
}

async function getUniqueIndexNames(prisma: PrismaClient): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexdef ILIKE 'CREATE UNIQUE%'`
  );
  return new Set(rows.map((r) => r.indexname));
}

async function main() {
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) {
    console.error("DATABASE_URL is not set. Refusing to verify.");
    process.exit(1);
  }

  const restoreUrl = resolveRestoreDatabaseUrl();
  const sourceIdentifier = sanitizedDatabaseIdentifier(sourceUrl);
  const restoreIdentifier = sanitizedDatabaseIdentifier(restoreUrl);
  console.log(`Source (sanitized):   ${sourceIdentifier}`);
  console.log(`Restore (sanitized):  ${restoreIdentifier}`);
  console.log("All queries below are read-only against both databases.\n");

  const source = new PrismaClient({ datasourceUrl: sourceUrl });
  const restored = new PrismaClient({ datasourceUrl: restoreUrl });
  const mismatches: Mismatch[] = [];

  try {
    console.log("Row counts:");
    for (const table of TABLES) {
      const [sourceCount, restoredCount] = await Promise.all([
        countRows(source, table),
        countRows(restored, table),
      ]);
      const mismatch = compareRowCount(table, sourceCount, restoredCount);
      console.log(
        `  ${table.padEnd(28)} source=${sourceCount} restored=${restoredCount}  ${mismatch ? "MISMATCH" : "OK"}`
      );
      if (mismatch) mismatches.push(mismatch);
    }

    console.log("\nForeign-key integrity (restored database):");
    const orphanChecks: [string, string][] = [
      [
        "DutyAssignment -> DutySchedule",
        `SELECT COUNT(*)::bigint AS count FROM "DutyAssignment" a LEFT JOIN "DutySchedule" s ON s.id = a."dutyScheduleId" WHERE s.id IS NULL`,
      ],
      [
        "DutyAssignment -> Pharmacy",
        `SELECT COUNT(*)::bigint AS count FROM "DutyAssignment" a LEFT JOIN "Pharmacy" p ON p.id = a."pharmacyId" WHERE p.id IS NULL`,
      ],
      [
        "DutyRequest -> Pharmacy",
        `SELECT COUNT(*)::bigint AS count FROM "DutyRequest" r LEFT JOIN "Pharmacy" p ON p.id = r."pharmacyId" WHERE p.id IS NULL`,
      ],
      [
        "HistoricalDutyRecord -> Pharmacy (matched rows only)",
        `SELECT COUNT(*)::bigint AS count FROM "HistoricalDutyRecord" h LEFT JOIN "Pharmacy" p ON p.id = h."pharmacyId" WHERE h."pharmacyId" IS NOT NULL AND p.id IS NULL`,
      ],
      [
        "DutyScheduleWarning -> DutySchedule",
        `SELECT COUNT(*)::bigint AS count FROM "DutyScheduleWarning" w LEFT JOIN "DutySchedule" s ON s.id = w."scheduleId" WHERE s.id IS NULL`,
      ],
      [
        "Session -> User",
        `SELECT COUNT(*)::bigint AS count FROM "Session" se LEFT JOIN "User" u ON u.id = se."userId" WHERE u.id IS NULL`,
      ],
    ];
    for (const [label, sql] of orphanChecks) {
      const count = await orphanCount(restored, sql);
      const mismatch = compareOrphanCount(label, count);
      console.log(`  ${label.padEnd(45)} ${mismatch ? "MISMATCH" : "OK"}`);
      if (mismatch) mismatches.push(mismatch);
    }

    console.log("\nUnique constraints present (restored database):");
    const expectedUniqueIndexes = [
      "User_email_key",
      "Session_token_key",
      "Region_name_key",
      "Pharmacy_requestToken_key",
      "DutyRequest_dedupKey_key",
      "HistoricalDutyImportBatch_fingerprint_key",
      "LoginAttempt_bucketType_bucketKey_key",
    ];
    const restoredIndexes = await getUniqueIndexNames(restored);
    for (const indexName of expectedUniqueIndexes) {
      const mismatch = compareUniqueIndexPresence(indexName, restoredIndexes.has(indexName));
      console.log(`  ${indexName.padEnd(45)} ${mismatch ? "MISSING" : "OK"}`);
      if (mismatch) mismatches.push(mismatch);
    }

    console.log("\nMigration history:");
    const [sourceMigrations, restoredMigrations] = await Promise.all([
      getMigrationNames(source),
      getMigrationNames(restored),
    ]);
    const migrationMismatch = compareMigrationHistory(sourceMigrations, restoredMigrations);
    console.log(
      `  source: ${sourceMigrations.length} applied, restored: ${restoredMigrations.length} applied  ` +
        (migrationMismatch ? "MISMATCH" : "OK")
    );
    if (migrationMismatch) mismatches.push(migrationMismatch);

    console.log("\nNon-secret aggregate checksums (never includes passwordHash/token/requestToken):");
    const checksumChecks: [string, string][] = [
      ["Region(name,district)", `SELECT name, district FROM "Region" ORDER BY name`],
      [
        "Pharmacy(name,city,district,isActive)",
        `SELECT name, city, district, "isActive" FROM "Pharmacy" ORDER BY name, id`,
      ],
      [
        "DutySchedule(year,month,regionId,status)",
        `SELECT year, month, "regionId", status FROM "DutySchedule" ORDER BY year, month, "regionId"`,
      ],
      ["User(email,role,isActive)", `SELECT email, role, "isActive" FROM "User" ORDER BY email`],
    ];
    for (const [label, sql] of checksumChecks) {
      const [sourceChecksum, restoredChecksum] = await Promise.all([
        checksumNonSecretRows(source, sql),
        checksumNonSecretRows(restored, sql),
      ]);
      const mismatch = compareChecksum(label, sourceChecksum, restoredChecksum);
      console.log(`  ${label.padEnd(45)} ${mismatch ? "MISMATCH" : "OK"}`);
      if (mismatch) mismatches.push(mismatch);
    }
  } finally {
    await source.$disconnect();
    await restored.$disconnect();
  }

  console.log("\n" + "=".repeat(60));
  if (mismatches.length === 0) {
    console.log("VERIFICATION PASSED — restore matches source on every check above.");
  } else {
    console.log(`VERIFICATION FAILED — ${mismatches.length} mismatch(es):`);
    for (const m of mismatches) {
      console.log(`  - ${m.check}: ${m.detail}`);
    }
  }
  console.log("=".repeat(60));

  if (mismatches.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error("FAIL: verification failed to run.");
  console.error((error as Error).message);
  process.exit(1);
});
