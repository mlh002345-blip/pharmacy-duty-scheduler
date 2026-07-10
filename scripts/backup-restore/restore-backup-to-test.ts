// Restores a pg_dump custom-format backup into RESTORE_DATABASE_URL only
// — never into DATABASE_URL. The safety guard
// (resolveRestoreDatabaseUrl(), shared with the integration-test
// TEST_DATABASE_URL guard) runs BEFORE any destructive operation and
// throws (refusing to touch anything) if the restore target isn't
// explicitly configured, isn't PostgreSQL, resolves to the same
// host/port/database as DATABASE_URL, lacks a recognized
// test/restore/staging/recovery marker, or looks production-like.
//
// Usage:
//   BACKUP_FILE=backups/pharmacy_..._2026-....dump \
//   RESTORE_DATABASE_URL="postgresql://user:pass@host:5432/pharmacy_restore" \
//   npm run db:restore:test
//
// Sequence (per docs/testing/BACKUP_RESTORE_REHEARSAL.md):
//   1. Validate RESTORE_DATABASE_URL (guard — fails before anything else).
//   2. Drop and recreate the "public" schema in the restore target only.
//   3. pg_restore the backup file into the restore target.
//   4. Report `prisma migrate status` against the restore target
//      (informational only — never applies a migration; the restored
//      dump already contains the applied migration history in
//      `_prisma_migrations`, matching whatever DATABASE_URL had at dump
//      time).
//
// Never seeds. Never touches DATABASE_URL/production.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { PrismaClient } from "@prisma/client";

import {
  resolveRestoreDatabaseUrl,
  sanitizedDatabaseIdentifier,
} from "../../tests/integration/helpers/test-db-guard";
import { parsePgConnection, pgEnv } from "./pg-connection";

const BACKUPS_DIR = join(process.cwd(), "backups");

function resolveBackupFile(): string {
  const explicit = process.env.BACKUP_FILE || process.argv[2];
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`BACKUP_FILE "${explicit}" does not exist.`);
    }
    return explicit;
  }
  if (!existsSync(BACKUPS_DIR)) {
    throw new Error(
      `No BACKUP_FILE given and ${BACKUPS_DIR} does not exist. Run db:backup:production first, ` +
        "or pass BACKUP_FILE=<path> explicitly."
    );
  }
  const dumpFiles = readdirSync(BACKUPS_DIR)
    .filter((name) => name.endsWith(".dump"))
    .map((name) => join(BACKUPS_DIR, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (dumpFiles.length === 0) {
    throw new Error(
      `No .dump files found under ${BACKUPS_DIR}. Run db:backup:production first, or pass ` +
        "BACKUP_FILE=<path> explicitly."
    );
  }
  console.log(`No BACKUP_FILE given — using the most recent dump: ${dumpFiles[0]}`);
  return dumpFiles[0];
}

async function main() {
  // Guard runs first, before the backup file is even resolved — a failed
  // guard must never proceed to any destructive step regardless of what
  // else is configured.
  const restoreUrl = resolveRestoreDatabaseUrl();
  const restoreIdentifier = sanitizedDatabaseIdentifier(restoreUrl);
  console.log(`Restore target (sanitized): ${restoreIdentifier}`);
  console.log("Safety guard: PASSED.");

  const backupFile = resolveBackupFile();
  console.log(`Backup file: ${backupFile}`);

  const conn = parsePgConnection(restoreUrl);

  console.log(`\nDropping and recreating schema "public" in the restore target only...`);
  // A short-lived Prisma client, used only to run this one DDL statement
  // against the guarded restore target — never against DATABASE_URL, and
  // never anywhere else in this script.
  const ddlClient = new PrismaClient({ datasourceUrl: restoreUrl });
  try {
    await ddlClient.$executeRawUnsafe('DROP SCHEMA IF EXISTS "public" CASCADE');
    await ddlClient.$executeRawUnsafe('CREATE SCHEMA "public"');
  } finally {
    await ddlClient.$disconnect();
  }

  console.log(`Restoring via pg_restore (custom format, no owner/privileges)...`);
  execFileSync(
    "pg_restore",
    [
      "--no-owner",
      "--no-privileges",
      "-h",
      conn.host,
      "-p",
      conn.port,
      "-U",
      conn.user,
      "-d",
      conn.database,
      backupFile,
    ],
    { env: pgEnv(conn), stdio: ["ignore", "inherit", "inherit"] }
  );

  console.log(`\nMigration status of the restored database (informational only — applies nothing):`);
  execFileSync("npx", ["prisma", "migrate", "status"], {
    env: { ...process.env, DATABASE_URL: restoreUrl },
    stdio: "inherit",
  });

  console.log(`\nRestore complete into ${restoreIdentifier}. DATABASE_URL/production was never touched.`);
}

main().catch((error) => {
  console.error("FAIL: restore failed.");
  console.error((error as Error).message);
  process.exit(1);
});
