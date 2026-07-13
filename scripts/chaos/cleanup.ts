// Deletes rows created by chaos-test runs, scoped strictly to ids
// recorded in each run's manifest — never a table-wide wipe. Cleans up
// every manifest found under chaos-output/ by default (a chaos run can
// crash mid-fault-injection before its own afterAll cleanup runs, so
// this command exists as the manual/backup recovery path), or a single
// run if a runId is passed.
//
// Usage:
//   CHAOS_DATABASE_URL="postgresql://..." npx tsx scripts/chaos/cleanup.ts [runId]

import { rmSync } from "node:fs";

import { sanitizedDatabaseIdentifier } from "../../tests/integration/helpers/test-db-guard";
import { chaosDatabaseUrl, chaosPrisma } from "./db";
import {
  findAllManifests,
  manifestPath,
  readManifest,
  validateManifestForCleanup,
  type ChaosManifest,
} from "./manifest";

function log(message: string): void {
  console.log(`[chaos-cleanup] ${message}`);
}

async function cleanupOneManifest(manifest: ChaosManifest): Promise<void> {
  const validation = validateManifestForCleanup(manifest);
  if (!validation.ok) {
    console.error(`Refusing to clean up run ${manifest.runId}: ${validation.reason}`);
    return;
  }

  log(`Cleaning up run ${manifest.runId} (marker ${manifest.marker})`);
  const { organizationIds, regionIds, pharmacyIds, userIds, historicalBatchIds, sessionTokenPrefix } = manifest;

  await chaosPrisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await chaosPrisma.dutyBalanceAdjustment.deleteMany({ where: { pharmacyId: { in: pharmacyIds } } });
  await chaosPrisma.unavailability.deleteMany({ where: { pharmacyId: { in: pharmacyIds } } });
  await chaosPrisma.dutyRequest.deleteMany({ where: { pharmacyId: { in: pharmacyIds } } });
  await chaosPrisma.historicalDutyRecord.deleteMany({ where: { batchId: { in: historicalBatchIds } } });
  await chaosPrisma.historicalDutyImportBatch.deleteMany({ where: { id: { in: historicalBatchIds } } });
  await chaosPrisma.dutyScheduleWarning.deleteMany({ where: { schedule: { regionId: { in: regionIds } } } });
  await chaosPrisma.dutyAssignment.deleteMany({ where: { dutySchedule: { regionId: { in: regionIds } } } });
  await chaosPrisma.dutySchedule.deleteMany({ where: { regionId: { in: regionIds } } });
  await chaosPrisma.dutyRule.deleteMany({ where: { regionId: { in: regionIds } } });
  await chaosPrisma.pharmacy.deleteMany({ where: { id: { in: pharmacyIds } } });
  await chaosPrisma.session.deleteMany({ where: { token: { startsWith: sessionTokenPrefix } } });
  await chaosPrisma.user.deleteMany({ where: { id: { in: userIds } } });
  await chaosPrisma.region.deleteMany({ where: { id: { in: regionIds } } });
  // Organization.onDelete is Restrict for Region/User/AuditLog — deleting
  // it last, after every dependent row above, is required for this to
  // succeed.
  await chaosPrisma.organization.deleteMany({ where: { id: { in: organizationIds } } });

  rmSync(manifestPath(manifest.runId), { force: true });
  log(`Run ${manifest.runId} cleaned up.`);
}

async function main(): Promise<void> {
  log(`Target database (sanitized): ${sanitizedDatabaseIdentifier(chaosDatabaseUrl)}`);

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
    console.error("[chaos-cleanup] Failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await chaosPrisma.$disconnect();
  });
