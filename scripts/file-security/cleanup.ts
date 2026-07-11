// Deletes rows created by file-security-test runs, scoped strictly to
// ids recorded in each run's manifest — never a table-wide wipe.
//
// Usage:
//   FILE_TEST_DATABASE_URL="postgresql://..." npx tsx scripts/file-security/cleanup.ts [runId]

import { rmSync } from "node:fs";

import { sanitizedDatabaseIdentifier } from "../../tests/integration/helpers/test-db-guard";
import { fileTestDatabaseUrl, fileTestPrisma } from "./db";
import {
  findAllManifests,
  manifestPath,
  readManifest,
  validateManifestForCleanup,
  type FileTestManifest,
} from "./manifest";

function log(message: string): void {
  console.log(`[file-security-cleanup] ${message}`);
}

async function cleanupOneManifest(manifest: FileTestManifest): Promise<void> {
  const validation = validateManifestForCleanup(manifest);
  if (!validation.ok) {
    console.error(`Refusing to clean up run ${manifest.runId}: ${validation.reason}`);
    return;
  }

  log(`Cleaning up run ${manifest.runId} (marker ${manifest.marker})`);
  const { regionIds, pharmacyIds, userIds, historicalBatchIds } = manifest;

  await fileTestPrisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await fileTestPrisma.historicalDutyRecord.deleteMany({ where: { batchId: { in: historicalBatchIds } } });
  await fileTestPrisma.historicalDutyImportBatch.deleteMany({ where: { id: { in: historicalBatchIds } } });
  // Some file-security specs (formula-injection-export, concurrency,
  // interrupted-processing) create real DutySchedule/DutyAssignment rows
  // to exercise the export pipeline — both must be cleared before their
  // referenced Pharmacy/Region rows, or Pharmacy deletion fails on the
  // DutyAssignment_pharmacyId_fkey constraint.
  await fileTestPrisma.dutyAssignment.deleteMany({ where: { pharmacyId: { in: pharmacyIds } } });
  await fileTestPrisma.dutySchedule.deleteMany({ where: { regionId: { in: regionIds } } });
  await fileTestPrisma.dutyRule.deleteMany({ where: { regionId: { in: regionIds } } });
  await fileTestPrisma.pharmacy.deleteMany({ where: { id: { in: pharmacyIds } } });
  await fileTestPrisma.user.deleteMany({ where: { id: { in: userIds } } });
  await fileTestPrisma.region.deleteMany({ where: { id: { in: regionIds } } });

  rmSync(manifestPath(manifest.runId), { force: true });
  log(`Run ${manifest.runId} cleaned up.`);
}

async function main(): Promise<void> {
  log(`Target database (sanitized): ${sanitizedDatabaseIdentifier(fileTestDatabaseUrl)}`);

  const runId = process.argv[2];
  const manifests = runId ? [readManifest(runId)] : findAllManifests();

  if (manifests.length === 0) {
    log("No manifests found — nothing to clean up.");
    return;
  }

  for (const manifest of manifests) {
    await cleanupOneManifest(manifest);
  }
  log("Cleanup complete.");
}

main()
  .catch((err) => {
    console.error("[file-security-cleanup] Failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await fileTestPrisma.$disconnect();
  });
