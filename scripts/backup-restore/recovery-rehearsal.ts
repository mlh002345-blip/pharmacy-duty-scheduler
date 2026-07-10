// Combined backup → restore → verify rehearsal. Requires explicit
// confirmation and a properly-guarded RESTORE_DATABASE_URL before doing
// anything; stops immediately (non-zero exit) on any failed guard or
// command — each step below uses execFileSync, which throws on a
// non-zero child exit code, so there is no "continue after failure" path.
//
// Usage:
//   CONFIRM_BACKUP_RESTORE_REHEARSAL=true \
//   CONFIRM_PRODUCTION_BACKUP=true \
//   DATABASE_URL="postgresql://...production-or-source..." \
//   RESTORE_DATABASE_URL="postgresql://...dedicated-restore-db..." \
//   npm run db:recovery:rehearsal
//
// See docs/testing/BACKUP_RESTORE_REHEARSAL.md for the full procedure,
// safety model, and RTO/RPO definitions.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  resolveRestoreDatabaseUrl,
  sanitizedDatabaseIdentifier,
} from "../../tests/integration/helpers/test-db-guard";

function requireConfirmation(envVar: string) {
  if (process.env[envVar] !== "true") {
    console.error(
      `Refusing to run the recovery rehearsal: set ${envVar}=true to confirm this is an ` +
        "intentional run. This is a deliberate-action guard on top of the RESTORE_DATABASE_URL " +
        "safety guard (which still runs and can independently refuse to proceed)."
    );
    process.exit(1);
  }
}

function runCapture(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "inherit"] });
}

function runInherit(command: string, args: string[], env?: NodeJS.ProcessEnv) {
  execFileSync(command, args, { stdio: "inherit", env: env ?? process.env });
}

async function main() {
  requireConfirmation("CONFIRM_BACKUP_RESTORE_REHEARSAL");
  requireConfirmation("CONFIRM_PRODUCTION_BACKUP");

  // The guard runs before any step — including before the backup step —
  // so a misconfigured RESTORE_DATABASE_URL stops the entire rehearsal
  // before a single byte is read from the source.
  const restoreUrl = resolveRestoreDatabaseUrl();
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) {
    console.error("DATABASE_URL is not set. Refusing to run the rehearsal.");
    process.exit(1);
  }

  const sourceIdentifier = sanitizedDatabaseIdentifier(sourceUrl);
  const restoreIdentifier = sanitizedDatabaseIdentifier(restoreUrl);
  console.log("Pharmacy Duty Scheduler — backup/restore recovery rehearsal");
  console.log(`  Source (sanitized):  ${sourceIdentifier}`);
  console.log(`  Target (sanitized):  ${restoreIdentifier}`);
  console.log("  Safety guard: PASSED (see tests/integration/helpers/test-db-guard.ts)\n");

  const timings: Record<string, { start: string; end: string }> = {};

  console.log("=== Step 1/3: backup ===");
  const backupStart = new Date();
  const backupOutput = runCapture("npx", ["tsx", "scripts/backup-restore/backup-production-db.ts"]);
  process.stdout.write(backupOutput);
  const backupEnd = new Date();
  timings.backup = { start: backupStart.toISOString(), end: backupEnd.toISOString() };

  const backupFileLine = backupOutput.split("\n").find((line) => line.startsWith("BACKUP_FILE="));
  if (!backupFileLine) {
    throw new Error("Backup step did not report a BACKUP_FILE — cannot proceed to restore.");
  }
  const backupFile = backupFileLine.slice("BACKUP_FILE=".length).trim();

  console.log("\n=== Step 2/3: restore ===");
  const restoreStart = new Date();
  runInherit("npx", ["tsx", "scripts/backup-restore/restore-backup-to-test.ts"], {
    ...process.env,
    BACKUP_FILE: backupFile,
  });
  const restoreEnd = new Date();
  timings.restore = { start: restoreStart.toISOString(), end: restoreEnd.toISOString() };

  console.log("\n=== Step 3/3: verify ===");
  const verifyStart = new Date();
  runInherit("npx", ["tsx", "scripts/backup-restore/verify-restored-db.ts"]);
  const verifyEnd = new Date();
  timings.verify = { start: verifyStart.toISOString(), end: verifyEnd.toISOString() };

  const totalSeconds = (verifyEnd.getTime() - backupStart.getTime()) / 1000;
  const rtoSeconds = (verifyEnd.getTime() - restoreStart.getTime()) / 1000;

  console.log("\n" + "=".repeat(60));
  console.log("RECOVERY REHEARSAL SUMMARY (sanitized — no credentials)");
  console.log("=".repeat(60));
  console.log(`Source:              ${sourceIdentifier}`);
  console.log(`Restore target:      ${restoreIdentifier}`);
  console.log(`Backup:  ${timings.backup.start} → ${timings.backup.end}`);
  console.log(`Restore: ${timings.restore.start} → ${timings.restore.end}`);
  console.log(`Verify:  ${timings.verify.start} → ${timings.verify.end}`);
  console.log(`Total (backup start → verify end): ${totalSeconds.toFixed(1)}s`);
  console.log(`RTO for this rehearsal (restore start → verify end): ${rtoSeconds.toFixed(1)}s`);
  console.log(
    "RPO: logical dump point-in-time only — data changes after the backup's start time are " +
      "not captured; no continuous/point-in-time-recovery guarantee unless Railway's own " +
      "managed backup feature provides one (not verifiable from this repository)."
  );

  const reportDir = join(process.cwd(), "backups");
  mkdirSync(reportDir, { recursive: true });
  const reportPath = join(reportDir, `rehearsal-report_${backupStart.toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        sourceIdentifier,
        restoreIdentifier,
        backupFile,
        timings,
        totalSeconds,
        rtoSeconds,
      },
      null,
      2
    ) + "\n",
    "utf-8"
  );
  console.log(`\nReport written to ${reportPath} (gitignored, sanitized — no credentials).`);
}

main().catch((error) => {
  console.error("\nFAIL: recovery rehearsal stopped due to an error.");
  console.error((error as Error).message);
  process.exit(1);
});
