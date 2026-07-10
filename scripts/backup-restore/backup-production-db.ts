// Takes a read-only logical backup of DATABASE_URL (the source — intended
// to be the real Railway production database, but this script works
// identically against any PostgreSQL source) using `pg_dump --format=custom
// --no-owner --no-privileges`. Never writes to the source in any way.
//
// Usage:
//   CONFIRM_PRODUCTION_BACKUP=true npm run db:backup:production
//
// Requires CONFIRM_PRODUCTION_BACKUP=true so this can never run as an
// accidental side effect of some other script/CI step — backing up
// production, while read-only and safe in itself, still opens a real
// connection to it and should always be a deliberate, explicit action.
//
// Output: a timestamped .dump file under backups/ (gitignored — see
// .gitignore), plus a .sha256 checksum file and a .manifest.json summary
// (sanitized source identifier, timestamps, PostgreSQL version, file
// size, checksum — never credentials).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { PrismaClient } from "@prisma/client";

import { sanitizedDatabaseIdentifier } from "../../tests/integration/helpers/test-db-guard";
import { parsePgConnection, pgEnv } from "./pg-connection";
import { sha256File, writeChecksumFile, writeManifest } from "./manifest";

const BACKUPS_DIR = join(process.cwd(), "backups");

function timestampForFilename(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function main() {
  if (process.env.CONFIRM_PRODUCTION_BACKUP !== "true") {
    console.error(
      "Refusing to back up: set CONFIRM_PRODUCTION_BACKUP=true to confirm you intend to " +
        "open a read-only connection to the database at DATABASE_URL and dump it. This is a " +
        "deliberate-action guard, not a data-safety guard — pg_dump itself never writes to " +
        "the source."
    );
    process.exit(1);
  }

  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) {
    console.error("DATABASE_URL is not set. Refusing to back up.");
    process.exit(1);
  }

  let parsedSource: URL;
  try {
    parsedSource = new URL(sourceUrl);
  } catch {
    console.error("DATABASE_URL is not a valid connection URL. Refusing to back up.");
    process.exit(1);
  }
  if (parsedSource.protocol !== "postgres:" && parsedSource.protocol !== "postgresql:") {
    console.error("DATABASE_URL must be a PostgreSQL connection string. Refusing to back up.");
    process.exit(1);
  }

  const sourceIdentifier = sanitizedDatabaseIdentifier(parsedSource);
  console.log(`Source (sanitized): ${sourceIdentifier}`);
  console.log(
    "This must be confirmed by the operator to be the intended source (e.g. the real " +
      "Railway production database) before running this command — this script cannot verify " +
      "that on its own beyond the connection succeeding."
  );

  if (!existsSync(BACKUPS_DIR)) {
    mkdirSync(BACKUPS_DIR, { recursive: true });
  }

  const conn = parsePgConnection(sourceUrl);
  const startedAt = new Date();
  const safeDbName = conn.database.replace(/[^a-zA-Z0-9_-]/g, "_");
  const dumpFilePath = join(BACKUPS_DIR, `${safeDbName}_${timestampForFilename(startedAt)}.dump`);

  console.log(`Starting pg_dump (custom format, no owner/privileges) → ${dumpFilePath}`);
  execFileSync(
    "pg_dump",
    [
      "--format=custom",
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
      "-f",
      dumpFilePath,
    ],
    { env: pgEnv(conn), stdio: ["ignore", "inherit", "inherit"] }
  );
  const finishedAt = new Date();

  // Read-only query for the manifest — a fresh, short-lived Prisma client
  // pointed only at the source, never used for any write.
  const prisma = new PrismaClient({ datasourceUrl: sourceUrl });
  let postgresVersion = "(unknown)";
  try {
    const rows = await prisma.$queryRaw<{ version: string }[]>`SELECT version() AS version`;
    postgresVersion = rows[0]?.version ?? postgresVersion;
  } finally {
    await prisma.$disconnect();
  }

  const fileSizeBytes = statSync(dumpFilePath).size;
  const sha256 = await sha256File(dumpFilePath);
  writeChecksumFile(dumpFilePath, sha256);
  const manifestPath = writeManifest(dumpFilePath, {
    sourceIdentifier,
    dumpStartedAt: startedAt.toISOString(),
    dumpFinishedAt: finishedAt.toISOString(),
    postgresVersion,
    format: "custom",
    fileSizeBytes,
    sha256,
  });

  console.log(`\nBackup complete.`);
  console.log(`  File:      ${dumpFilePath}`);
  console.log(`  Size:      ${fileSizeBytes} bytes`);
  console.log(`  SHA-256:   ${sha256}`);
  console.log(`  Manifest:  ${manifestPath}`);
  console.log(`  Duration:  ${(finishedAt.getTime() - startedAt.getTime()) / 1000}s`);
  // Machine-readable marker line for the recovery-rehearsal orchestrator
  // to pick up the exact file path without re-deriving the timestamp.
  console.log(`BACKUP_FILE=${dumpFilePath}`);
}

main().catch((error) => {
  console.error("FAIL: backup failed.");
  console.error((error as Error).message);
  process.exit(1);
});
