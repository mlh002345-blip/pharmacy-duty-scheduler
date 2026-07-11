// Deterministic synthetic-data generator for Step 5 (large-data volume &
// query-plan validation). Run with:
//   PERF_DATABASE_URL=postgresql://... npx tsx scripts/perf/seed-perf-data.ts --profile quick
// Never touches DATABASE_URL — see tests/integration/helpers/test-db-guard.ts.
//
// Every generated row's identifying text field (Region.name, Pharmacy.name,
// User.name/email, AuditLog.entity note, etc.) is prefixed with the run's
// marker (`PERF-<runId>-...`) so cleanup can prove a row belongs to this
// run without tracking every child id individually (see manifest.ts).

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { AuditAction, DutyRequestSource, DutyRequestStatus, DutyRequestType, HolidayType, HistoricalMatchStatus, UserRole } from "@prisma/client";

import { hashPassword } from "../../src/lib/auth/password";
import { chunk } from "./batch";
import { hashIdentifier } from "../../src/lib/security/hash-identifier";
import { perfDatabaseUrl, perfPrisma } from "./db";
import { sanitizedDatabaseIdentifier } from "../../tests/integration/helpers/test-db-guard";
import { writeManifest, type PerfManifest } from "./manifest";
import { resolveProfile } from "./profiles";
import { createRng, pick, randomInt } from "./rng";

const CREATE_MANY_BATCH_SIZE = 2_000;

function log(message: string): void {
  console.log(`[seed-perf-data] ${message}`);
}

async function batchedCreateMany<T>(
  label: string,
  rows: T[],
  createMany: (batch: T[]) => Promise<unknown>
): Promise<void> {
  if (rows.length === 0) return;
  let inserted = 0;
  for (const batch of chunk(rows, CREATE_MANY_BATCH_SIZE)) {
    await createMany(batch);
    inserted += batch.length;
    log(`${label}: ${inserted}/${rows.length}`);
  }
}

function parseArgs(): { profileName: "quick" | "full" } {
  const flagIndex = process.argv.indexOf("--profile");
  const fromFlag = flagIndex !== -1 ? process.argv[flagIndex + 1] : undefined;
  const fromEnv = process.env.PERF_PROFILE;
  const requested = fromFlag ?? fromEnv;
  return { profileName: requested === "full" ? "full" : "quick" };
}

const CITIES = ["İstanbul", "Ankara", "İzmir", "Bursa", "Antalya", "Adana", "Konya", "Gaziantep"];
const HOLIDAY_NAMES: Array<[string, HolidayType]> = [
  ["Yılbaşı", HolidayType.OFFICIAL],
  ["23 Nisan", HolidayType.OFFICIAL],
  ["19 Mayıs", HolidayType.OFFICIAL],
  ["30 Ağustos", HolidayType.OFFICIAL],
  ["29 Ekim", HolidayType.OFFICIAL],
  ["Ramazan Bayramı 1. Gün", HolidayType.RELIGIOUS],
  ["Kurban Bayramı 1. Gün", HolidayType.RELIGIOUS],
];

function daysBetween(start: Date, days: number): Date {
  const d = new Date(start);
  d.setDate(d.getDate() + days);
  return d;
}

async function main(): Promise<void> {
  const { profileName } = parseArgs();
  const profile = resolveProfile(profileName);
  const runId = `${Date.now().toString(36)}${randomUUID().slice(0, 8)}`;
  const marker = `PERF-${runId}`;
  const rng = createRng(profileName === "full" ? 0xf011 : 0x9a1c7);

  log(`Target: ${sanitizedDatabaseIdentifier(perfDatabaseUrl)}`);
  log(`Profile: ${profile.name} (regions=${profile.regions}, pharmacies=${profile.regions * profile.pharmaciesPerRegion})`);
  log(`Run id: ${runId}`);

  log("Applying migrations to the perf database (prisma migrate deploy)...");
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: perfDatabaseUrl },
    stdio: "inherit",
  });

  const manifest: PerfManifest = {
    runId,
    marker,
    profile: profile.name,
    createdAt: new Date().toISOString(),
    regionIds: [],
    pharmacyIds: [],
    userIds: [],
    historicalBatchIds: [],
    sessionTokenPrefix: `${marker}-session-`,
    loginAttemptBucketKeyPrefix: `${marker}-bucket-`,
    loginAttemptIds: [],
  };

  // ---- Regions -------------------------------------------------------
  const regions = Array.from({ length: profile.regions }, (_, i) => {
    const id = randomUUID();
    manifest.regionIds.push(id);
    return {
      id,
      name: `${marker}-Region-${String(i + 1).padStart(4, "0")}`,
      district: pick(rng, CITIES),
      dailyDutyCount: randomInt(rng, 1, 3),
      isActive: true,
    };
  });
  await batchedCreateMany("Region", regions, (b) => perfPrisma.region.createMany({ data: b }));

  // ---- DutyRule (one per region) -------------------------------------
  const dutyRules = regions.map((r) => ({
    id: randomUUID(),
    regionId: r.id,
    minDaysBetweenDuties: randomInt(rng, 1, 5),
    weekdayWeight: 1,
    saturdayWeight: 1.25,
    sundayWeight: 1.5,
    officialHolidayWeight: 2,
    religiousHolidayWeight: 2,
  }));
  await batchedCreateMany("DutyRule", dutyRules, (b) => perfPrisma.dutyRule.createMany({ data: b }));

  // ---- Pharmacies ------------------------------------------------------
  const pharmacies: Array<{ id: string; regionId: string }> = [];
  const pharmacyRows = regions.flatMap((region, regionIdx) =>
    Array.from({ length: profile.pharmaciesPerRegion }, (_, i) => {
      const id = randomUUID();
      pharmacies.push({ id, regionId: region.id });
      return {
        id,
        name: `${marker}-Pharmacy-${regionIdx}-${i}`,
        pharmacistName: `${marker} Eczacı ${regionIdx}-${i}`,
        phone: `0555${String(1_000_000 + regionIdx * 1000 + i).padStart(7, "0")}`,
        address: `${marker} Test Adresi No:${i}`,
        city: region.district,
        district: region.district,
        requestToken: randomUUID(),
        isActive: rng() > 0.03,
        regionId: region.id,
      };
    })
  );
  manifest.pharmacyIds = pharmacies.map((p) => p.id);
  await batchedCreateMany("Pharmacy", pharmacyRows, (b) => perfPrisma.pharmacy.createMany({ data: b }));

  // ---- Actor Users (ADMIN/STAFF/VIEWER pool) --------------------------
  const sharedPasswordHash = await hashPassword(`${marker}-synthetic-password`);
  const roles: UserRole[] = [UserRole.ADMIN, UserRole.STAFF, UserRole.VIEWER];
  const users = Array.from({ length: profile.actorUserCount }, (_, i) => ({
    id: randomUUID(),
    name: `${marker} Kullanıcı ${i}`,
    email: `${marker.toLowerCase()}-user-${i}@example.invalid`,
    passwordHash: sharedPasswordHash,
    role: i === 0 ? UserRole.ADMIN : pick(rng, roles),
    isActive: true,
  }));
  manifest.userIds = users.map((u) => u.id);
  await batchedCreateMany("User", users, (b) => perfPrisma.user.createMany({ data: b }));

  // ---- Holidays ---------------------------------------------------------
  const holidayYears = [2024, 2025, 2026];
  const holidays = holidayYears.flatMap((year) =>
    HOLIDAY_NAMES.map(([name, type], idx) => ({
      id: randomUUID(),
      name: `${marker}-${name}`,
      date: new Date(Date.UTC(year, idx % 12, 5 + idx)),
      type,
    }))
  );
  await batchedCreateMany("Holiday", holidays, (b) => perfPrisma.holiday.createMany({ data: b }));

  // ---- HistoricalDutyImportBatch + HistoricalDutyRecord -----------------
  const historicalBatchCount = Math.max(1, Math.round(profile.historicalDutyRecordTarget / 5_000));
  const historicalBatches = Array.from({ length: historicalBatchCount }, (_, i) => ({
    id: randomUUID(),
    fileName: `${marker}-import-${i}.xlsx`,
    rowCount: 0,
    matchedCount: 0,
    unmatchedCount: 0,
    warningCount: 0,
    note: `${marker} synthetic batch ${i}`,
    fingerprint: `${marker}-fingerprint-${i}`,
    importedById: pick(rng, users).id,
  }));
  manifest.historicalBatchIds = historicalBatches.map((b) => b.id);
  await batchedCreateMany("HistoricalDutyImportBatch", historicalBatches, (b) =>
    perfPrisma.historicalDutyImportBatch.createMany({ data: b })
  );

  const historicalStart = new Date(Date.UTC(new Date().getUTCFullYear() - profile.historicalYears, 0, 1));
  const historicalSpanDays = profile.historicalYears * 365;
  const historicalMatchStatuses = [
    HistoricalMatchStatus.MATCHED,
    HistoricalMatchStatus.MATCHED,
    HistoricalMatchStatus.MATCHED,
    HistoricalMatchStatus.UNMATCHED,
    HistoricalMatchStatus.IGNORED,
  ];
  const historicalRecords = Array.from({ length: profile.historicalDutyRecordTarget }, (_, i) => {
    const batch = historicalBatches[i % historicalBatches.length];
    const matchStatus = pick(rng, historicalMatchStatuses);
    const matchedPharmacy = matchStatus === HistoricalMatchStatus.MATCHED ? pick(rng, pharmacies) : null;
    return {
      id: randomUUID(),
      rowNumber: i,
      dutyDate: daysBetween(historicalStart, randomInt(rng, 0, historicalSpanDays)),
      rawPharmacyName: `${marker}-raw-pharmacy-${i}`,
      rawRegionName: null,
      rawDutyType: "NORMAL",
      rawPhone: null,
      rawAddress: null,
      rawNote: null,
      dutyType: "NORMAL",
      weight: 1,
      matchStatus,
      warningMessage: matchStatus === HistoricalMatchStatus.UNMATCHED ? "Eşleşme bulunamadı" : null,
      batchId: batch.id,
      pharmacyId: matchedPharmacy?.id ?? null,
      regionId: matchedPharmacy?.regionId ?? null,
    };
  });
  await batchedCreateMany("HistoricalDutyRecord", historicalRecords, (b) =>
    perfPrisma.historicalDutyRecord.createMany({ data: b })
  );

  // ---- DutySchedule (respects @@unique([year, month, regionId])) --------
  type ScheduleRow = { id: string; month: number; year: number; regionId: string; status: "DRAFT" | "PUBLISHED" };
  const schedules: ScheduleRow[] = [];
  const scheduleSeen = new Set<string>();
  const currentYear = new Date().getUTCFullYear();
  outer: for (let yearOffset = 0; yearOffset < 6; yearOffset++) {
    for (let month = 1; month <= 12; month++) {
      for (const region of regions) {
        if (schedules.length >= profile.dutyScheduleTarget) break outer;
        const key = `${currentYear - yearOffset}-${month}-${region.id}`;
        if (scheduleSeen.has(key)) continue;
        scheduleSeen.add(key);
        schedules.push({
          id: randomUUID(),
          month,
          year: currentYear - yearOffset,
          regionId: region.id,
          status: rng() > 0.2 ? "PUBLISHED" : "DRAFT",
        });
      }
    }
  }
  await batchedCreateMany("DutySchedule", schedules, (b) => perfPrisma.dutySchedule.createMany({ data: b }));

  // ---- DutyAssignment (full month of assignments for a density subset) --
  const densitySchedules = schedules.slice(0, Math.min(profile.scheduleAssignmentDensityCount, schedules.length));
  const assignments: Array<{
    id: string;
    date: Date;
    weight: number;
    isManual: boolean;
    dutyScheduleId: string;
    pharmacyId: string;
  }> = [];
  for (const schedule of densitySchedules) {
    const regionPharmacies = pharmacies.filter((p) => p.regionId === schedule.regionId);
    if (regionPharmacies.length === 0) continue;
    const daysInMonth = new Date(Date.UTC(schedule.year, schedule.month, 0)).getUTCDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const pharmacy = pick(rng, regionPharmacies);
      assignments.push({
        id: randomUUID(),
        date: new Date(Date.UTC(schedule.year, schedule.month - 1, day)),
        weight: 1,
        isManual: rng() > 0.9,
        dutyScheduleId: schedule.id,
        pharmacyId: pharmacy.id,
      });
    }
  }
  await batchedCreateMany("DutyAssignment", assignments, (b) => perfPrisma.dutyAssignment.createMany({ data: b }));

  // ---- AuditLog -----------------------------------------------------------
  const auditActions = [AuditAction.CREATE, AuditAction.UPDATE, AuditAction.DELETE];
  const auditEntities = ["Pharmacy", "Region", "DutyAssignment", "DutyRequest", "Unavailability"];
  const auditLogs = Array.from({ length: profile.auditLogTarget }, (_, i) => {
    const assignment = assignments.length > 0 && rng() > 0.5 ? pick(rng, assignments) : null;
    return {
      id: randomUUID(),
      action: pick(rng, auditActions),
      entity: pick(rng, auditEntities),
      entityId: pick(rng, pharmacies).id,
      before: null,
      after: `${marker}-audit-${i}`,
      userId: pick(rng, users).id,
      dutyAssignmentId: assignment?.id ?? null,
      createdAt: daysBetween(historicalStart, randomInt(rng, 0, historicalSpanDays)),
    };
  });
  await batchedCreateMany("AuditLog", auditLogs, (b) => perfPrisma.auditLog.createMany({ data: b }));

  // ---- DutyRequest --------------------------------------------------------
  const requestTypes = [
    DutyRequestType.CANNOT_DUTY,
    DutyRequestType.PREFER_DUTY,
    DutyRequestType.SWAP_REQUEST,
    DutyRequestType.EMERGENCY_EXCUSE,
  ];
  const requestStatuses = [
    DutyRequestStatus.PENDING,
    DutyRequestStatus.APPROVED,
    DutyRequestStatus.REJECTED,
    DutyRequestStatus.CANCELLED,
    DutyRequestStatus.LATE,
  ];
  const requestSources = [DutyRequestSource.ADMIN_ENTRY, DutyRequestSource.PUBLIC_LINK, DutyRequestSource.IMPORT];
  const dutyRequests = Array.from({ length: profile.dutyRequestTarget }, (_, i) => {
    const pharmacy = pick(rng, pharmacies);
    const status = pick(rng, requestStatuses);
    const start = daysBetween(historicalStart, randomInt(rng, 0, historicalSpanDays));
    const isOpen = status === DutyRequestStatus.PENDING || status === DutyRequestStatus.LATE;
    return {
      id: randomUUID(),
      requestType: pick(rng, requestTypes),
      startDate: start,
      endDate: daysBetween(start, randomInt(rng, 0, 3)),
      explanation: `${marker}-request-${i}`,
      status,
      source: pick(rng, requestSources),
      reviewNote: isOpen ? null : `${marker}-reviewed`,
      reviewedAt: isOpen ? null : start,
      pharmacyId: pharmacy.id,
      regionId: pharmacy.regionId,
      reviewedById: isOpen ? null : pick(rng, users).id,
      dedupKey: isOpen ? `${marker}-dedup-${i}` : null,
    };
  });
  await batchedCreateMany("DutyRequest", dutyRequests, (b) => perfPrisma.dutyRequest.createMany({ data: b }));

  // ---- Unavailability -------------------------------------------------
  const unavailabilities = Array.from({ length: profile.unavailabilityTarget }, (_, i) => {
    const start = daysBetween(historicalStart, randomInt(rng, 0, historicalSpanDays));
    return {
      id: randomUUID(),
      startDate: start,
      endDate: daysBetween(start, randomInt(rng, 0, 10)),
      reason: `${marker}-unavailability-${i}`,
      pharmacyId: pick(rng, pharmacies).id,
    };
  });
  await batchedCreateMany("Unavailability", unavailabilities, (b) => perfPrisma.unavailability.createMany({ data: b }));

  // ---- DutyBalanceAdjustment -------------------------------------------
  const balanceAdjustments = Array.from({ length: profile.dutyBalanceAdjustmentTarget }, (_, i) => ({
    id: randomUUID(),
    points: Number((rng() * 4 - 2).toFixed(2)),
    reason: `${marker}-adjustment-${i}`,
    pharmacyId: pick(rng, pharmacies).id,
    createdById: pick(rng, users).id,
  }));
  await batchedCreateMany("DutyBalanceAdjustment", balanceAdjustments, (b) =>
    perfPrisma.dutyBalanceAdjustment.createMany({ data: b })
  );

  // ---- Session ------------------------------------------------------------
  const sessions = Array.from({ length: profile.sessionTarget }, (_, i) => ({
    id: randomUUID(),
    token: `${manifest.sessionTokenPrefix}${i}-${randomUUID()}`,
    expiresAt: daysBetween(new Date(), randomInt(rng, -5, 30)),
    userId: pick(rng, users).id,
  }));
  await batchedCreateMany("Session", sessions, (b) => perfPrisma.session.createMany({ data: b }));

  // ---- LoginAttempt ---------------------------------------------------
  const loginAttempts = Array.from({ length: profile.loginAttemptTarget }, (_, i) => ({
    id: randomUUID(),
    bucketType: i % 2 === 0 ? "NETWORK" : "ACCOUNT",
    bucketKey: hashIdentifier(`${manifest.loginAttemptBucketKeyPrefix}${i}`),
    failureCount: randomInt(rng, 0, 5),
    windowStart: daysBetween(new Date(), -randomInt(rng, 0, 14)),
    blockedUntil: rng() > 0.7 ? daysBetween(new Date(), randomInt(rng, 0, 1)) : null,
  }));
  manifest.loginAttemptIds = loginAttempts.map((a) => a.id);
  await batchedCreateMany("LoginAttempt", loginAttempts, (b) => perfPrisma.loginAttempt.createMany({ data: b }));

  const manifestPath = writeManifest(manifest);
  log(`Manifest written: ${manifestPath}`);
  log(
    `Done. regions=${regions.length} pharmacies=${pharmacyRows.length} users=${users.length} historical=${historicalRecords.length} audit=${auditLogs.length} requests=${dutyRequests.length} unavailability=${unavailabilities.length} schedules=${schedules.length} assignments=${assignments.length} balanceAdjustments=${balanceAdjustments.length} sessions=${sessions.length} loginAttempts=${loginAttempts.length}`
  );
}

main()
  .catch((err) => {
    console.error("[seed-perf-data] Failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await perfPrisma.$disconnect();
  });
