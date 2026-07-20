// The "otomatik yedekleme" (automatic backup) entry point — wraps the
// existing, already-tested backup-production-db.ts (never duplicates its
// pg_dump/checksum/manifest logic) and adds the two things a one-off
// manual backup doesn't need: retention pruning of old dumps, and a
// last-success marker file a monitoring check can watch.
//
// Intended to be invoked by cron/systemd timer, once a day, on the
// production host itself (see docs/DEPLOYMENT.md → "Otomatik Yedekleme").
// Not intended to be run interactively — CONFIRM_PRODUCTION_BACKUP is set
// here automatically because starting the scheduled job in the first
// place (configuring the cron entry) IS the deliberate human action;
// see backup-production-db.ts's own comment for why that guard exists.
//
// Usage:
//   DATABASE_URL="postgresql://...production..." \
//   npm run db:backup:scheduled
//
// Optional:
//   BACKUP_RETENTION_DAYS=14   (default 14 — backups older than this are
//                               deleted, except the single most recent
//                               one, which is always kept — see
//                               retention.ts)

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { selectBackupsToDelete } from "./retention";

const BACKUPS_DIR = join(process.cwd(), "backups");
const DEFAULT_RETENTION_DAYS = 14;

function runBackup(): string {
  const output = execFileSync("npx", ["tsx", "scripts/backup-restore/backup-production-db.ts"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, CONFIRM_PRODUCTION_BACKUP: "true" },
  });
  process.stdout.write(output);

  const backupFileLine = output.split("\n").find((line) => line.startsWith("BACKUP_FILE="));
  if (!backupFileLine) {
    throw new Error("Backup step did not report a BACKUP_FILE — cannot proceed to retention.");
  }
  return backupFileLine.slice("BACKUP_FILE=".length).trim();
}

// Every backup produces three files sharing the same base name: the
// .dump itself, a .sha256 checksum, and a .manifest.json — deleting a
// backup means deleting all three together, never leaving an orphaned
// checksum/manifest with no corresponding dump.
function pruneOldBackups(retentionDays: number): string[] {
  if (!existsSync(BACKUPS_DIR)) return [];

  const dumpFiles = readdirSync(BACKUPS_DIR)
    .filter((name) => name.endsWith(".dump"))
    .map((name) => ({ name, mtimeMs: statSync(join(BACKUPS_DIR, name)).mtimeMs }));

  const toDelete = selectBackupsToDelete(dumpFiles, retentionDays, Date.now());

  for (const dumpName of toDelete) {
    for (const suffix of ["", ".sha256", ".manifest.json"]) {
      const path = join(BACKUPS_DIR, `${dumpName}${suffix}`);
      if (existsSync(path)) unlinkSync(path);
    }
  }
  return toDelete;
}

async function main() {
  const retentionDays = process.env.BACKUP_RETENTION_DAYS
    ? Number(process.env.BACKUP_RETENTION_DAYS)
    : DEFAULT_RETENTION_DAYS;
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    console.error(`BACKUP_RETENTION_DAYS must be a positive number, got: ${process.env.BACKUP_RETENTION_DAYS}`);
    process.exit(1);
  }

  console.log("=== Scheduled backup: pg_dump ===");
  const backupFile = runBackup();

  console.log(`\n=== Scheduled backup: retention (keep last ${retentionDays} days) ===`);
  const deleted = pruneOldBackups(retentionDays);
  if (deleted.length > 0) {
    console.log(`Deleted ${deleted.length} backup(s) older than ${retentionDays} days:`);
    for (const name of deleted) console.log(`  - ${name}`);
  } else {
    console.log("Nothing to prune.");
  }

  const statusPath = join(BACKUPS_DIR, "last-success.json");
  writeFileSync(
    statusPath,
    JSON.stringify(
      { lastSuccessAt: new Date().toISOString(), backupFile, retentionDays },
      null,
      2
    ) + "\n",
    "utf-8"
  );
  console.log(`\nStatus marker written to ${statusPath}.`);
  console.log("Scheduled backup complete.");
}

main().catch((error) => {
  console.error("FAIL: scheduled backup failed.");
  console.error((error as Error).message);
  process.exit(1);
});
