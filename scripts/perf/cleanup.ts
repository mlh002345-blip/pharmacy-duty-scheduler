// Deletes rows created by a single performance-benchmark run, and only
// those rows. Never a table-wide TRUNCATE/deleteMany({}) — every delete
// below is scoped to ids recorded in that run's manifest (see
// manifest.ts's rationale for why only "parent" ids are tracked and
// children are deleted by filtering on the parent FK).
//
// Usage:
//   PERF_DATABASE_URL="postgresql://..." npx tsx scripts/perf/cleanup.ts [runId]
// Omitting runId cleans up the most recently written manifest.

import { sanitizedDatabaseIdentifier } from "../../tests/integration/helpers/test-db-guard";
import { perfDatabaseUrl, perfPrisma } from "./db";
import { findLatestManifest, readManifest, validateManifestForCleanup, type PerfManifest } from "./manifest";

function log(message: string): void {
  console.log(`[cleanup] ${message}`);
}

async function main(): Promise<void> {
  const runId = process.argv[2];
  const manifest: PerfManifest | null = runId ? readManifest(runId) : findLatestManifest();

  const validation = validateManifestForCleanup(manifest);
  if (!validation.ok || !manifest) {
    console.error(`Refusing to run cleanup: ${!validation.ok ? validation.reason : "no manifest"}`);
    process.exit(1);
  }

  console.log(`Target database (sanitized): ${sanitizedDatabaseIdentifier(perfDatabaseUrl)}`);
  console.log(`Cleaning up run ${manifest.runId} (marker ${manifest.marker})`);

  const { regionIds, pharmacyIds, userIds, historicalBatchIds, sessionTokenPrefix, loginAttemptIds, marker } = manifest;

  const auditDeleted = await perfPrisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  log(`AuditLog: ${auditDeleted.count}`);

  const balanceDeleted = await perfPrisma.dutyBalanceAdjustment.deleteMany({ where: { pharmacyId: { in: pharmacyIds } } });
  log(`DutyBalanceAdjustment: ${balanceDeleted.count}`);

  const unavailabilityDeleted = await perfPrisma.unavailability.deleteMany({ where: { pharmacyId: { in: pharmacyIds } } });
  log(`Unavailability: ${unavailabilityDeleted.count}`);

  const requestsDeleted = await perfPrisma.dutyRequest.deleteMany({ where: { pharmacyId: { in: pharmacyIds } } });
  log(`DutyRequest: ${requestsDeleted.count}`);

  const historicalDeleted = await perfPrisma.historicalDutyRecord.deleteMany({ where: { batchId: { in: historicalBatchIds } } });
  log(`HistoricalDutyRecord: ${historicalDeleted.count}`);

  const batchesDeleted = await perfPrisma.historicalDutyImportBatch.deleteMany({ where: { id: { in: historicalBatchIds } } });
  log(`HistoricalDutyImportBatch: ${batchesDeleted.count}`);

  const warningsDeleted = await perfPrisma.dutyScheduleWarning.deleteMany({
    where: { schedule: { regionId: { in: regionIds } } },
  });
  log(`DutyScheduleWarning: ${warningsDeleted.count}`);

  const assignmentsDeleted = await perfPrisma.dutyAssignment.deleteMany({
    where: { dutySchedule: { regionId: { in: regionIds } } },
  });
  log(`DutyAssignment: ${assignmentsDeleted.count}`);

  const schedulesDeleted = await perfPrisma.dutySchedule.deleteMany({ where: { regionId: { in: regionIds } } });
  log(`DutySchedule: ${schedulesDeleted.count}`);

  const rulesDeleted = await perfPrisma.dutyRule.deleteMany({ where: { regionId: { in: regionIds } } });
  log(`DutyRule: ${rulesDeleted.count}`);

  const pharmaciesDeleted = await perfPrisma.pharmacy.deleteMany({ where: { id: { in: pharmacyIds } } });
  log(`Pharmacy: ${pharmaciesDeleted.count}`);

  const sessionsDeleted = await perfPrisma.session.deleteMany({ where: { token: { startsWith: sessionTokenPrefix } } });
  log(`Session: ${sessionsDeleted.count}`);

  const loginAttemptsDeleted = await perfPrisma.loginAttempt.deleteMany({ where: { id: { in: loginAttemptIds } } });
  log(`LoginAttempt: ${loginAttemptsDeleted.count}`);

  const usersDeleted = await perfPrisma.user.deleteMany({ where: { id: { in: userIds } } });
  log(`User: ${usersDeleted.count}`);

  const holidaysDeleted = await perfPrisma.holiday.deleteMany({ where: { name: { startsWith: marker } } });
  log(`Holiday: ${holidaysDeleted.count}`);

  const regionsDeleted = await perfPrisma.region.deleteMany({ where: { id: { in: regionIds } } });
  log(`Region: ${regionsDeleted.count}`);

  // Organization.onDelete is Restrict for Region/User/AuditLog/
  // HistoricalDutyImportBatch — deleting it last, after every dependent
  // row above, is required for this to succeed.
  const orgDeleted = await perfPrisma.organization.deleteMany({ where: { id: manifest.organizationId } });
  log(`Organization: ${orgDeleted.count}`);

  log("Cleanup complete.");
}

main()
  .catch((err) => {
    console.error("[cleanup] Failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await perfPrisma.$disconnect();
  });
