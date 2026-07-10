import { randomBytes, randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";

// Every row created by an integration test is tagged with a short,
// per-test-run unique id (via name/email prefixes) so that even if
// cleanup were ever skipped, leftover rows are trivially identifiable
// and never collide with another concurrent test run's data.
export function testRunId(): string {
  return randomUUID().slice(0, 8);
}

export type TrackedIds = {
  userIds: string[];
  regionIds: string[];
  pharmacyIds: string[];
  dutyScheduleIds: string[];
  historicalBatchIds: string[];
};

export function newTrackedIds(): TrackedIds {
  return {
    userIds: [],
    regionIds: [],
    pharmacyIds: [],
    dutyScheduleIds: [],
    historicalBatchIds: [],
  };
}

export async function createTestRegion(
  tracked: TrackedIds,
  overrides: Partial<{ name: string; dailyDutyCount: number }> = {}
) {
  const region = await prisma.region.create({
    data: {
      name: overrides.name ?? `Test Bölge ${testRunId()}`,
      district: "Test İlçe",
      dailyDutyCount: overrides.dailyDutyCount ?? 1,
      isActive: true,
    },
  });
  tracked.regionIds.push(region.id);
  return region;
}

export async function createTestDutyRule(regionId: string) {
  return prisma.dutyRule.create({
    data: {
      regionId,
      minDaysBetweenDuties: 0,
      weekdayWeight: 1,
      saturdayWeight: 1.25,
      sundayWeight: 1.5,
      officialHolidayWeight: 2,
      religiousHolidayWeight: 2,
    },
  });
}

export async function createTestPharmacy(
  tracked: TrackedIds,
  regionId: string,
  overrides: Partial<{ name: string; requestToken: string; isActive: boolean }> = {}
) {
  const pharmacy = await prisma.pharmacy.create({
    data: {
      name: overrides.name ?? `Test Eczane ${testRunId()}`,
      pharmacistName: "Test Eczacı",
      phone: "0000000000",
      address: "Test Adres",
      city: "İstanbul",
      district: "Test İlçe",
      requestToken: overrides.requestToken ?? randomBytes(16).toString("hex"),
      isActive: overrides.isActive ?? true,
      regionId,
    },
  });
  tracked.pharmacyIds.push(pharmacy.id);
  return pharmacy;
}

export async function createTestUser(
  tracked: TrackedIds,
  overrides: Partial<{ role: "ADMIN" | "STAFF" | "VIEWER"; isActive: boolean; email: string }> = {}
) {
  const id = testRunId();
  const user = await prisma.user.create({
    data: {
      name: `Test Kullanıcı ${id}`,
      email: overrides.email ?? `test-${id}@integration.test`,
      passwordHash: await hashPassword("Test1234!"),
      role: overrides.role ?? "ADMIN",
      isActive: overrides.isActive ?? true,
    },
  });
  tracked.userIds.push(user.id);
  return user;
}

export async function createTestSessionToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: { token, userId, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  });
  return token;
}

// Deletes exactly the rows this test run created, in FK-safe order
// (children before parents). Never touches any row outside the tracked
// id lists, so it can never affect data outside this test's own writes —
// even on a shared test database. Safe to call even if some ids were
// never actually created for a given run.
export async function cleanupTrackedIds(tracked: TrackedIds): Promise<void> {
  if (tracked.dutyScheduleIds.length > 0) {
    await prisma.dutyScheduleWarning.deleteMany({
      where: { scheduleId: { in: tracked.dutyScheduleIds } },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { entity: "DutySchedule", entityId: { in: tracked.dutyScheduleIds } },
          {
            dutyAssignment: { dutyScheduleId: { in: tracked.dutyScheduleIds } },
          },
        ],
      },
    });
    await prisma.dutyAssignment.deleteMany({
      where: { dutyScheduleId: { in: tracked.dutyScheduleIds } },
    });
    await prisma.dutySchedule.deleteMany({ where: { id: { in: tracked.dutyScheduleIds } } });
  }

  if (tracked.historicalBatchIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { entity: "HistoricalDutyImportBatch", entityId: { in: tracked.historicalBatchIds } },
    });
    await prisma.historicalDutyRecord.deleteMany({
      where: { batchId: { in: tracked.historicalBatchIds } },
    });
    await prisma.historicalDutyImportBatch.deleteMany({
      where: { id: { in: tracked.historicalBatchIds } },
    });
  }

  if (tracked.pharmacyIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { entity: "Pharmacy", entityId: { in: tracked.pharmacyIds } },
    });
    await prisma.dutyRequest.deleteMany({ where: { pharmacyId: { in: tracked.pharmacyIds } } });
    await prisma.dutyBalanceAdjustment.deleteMany({
      where: { pharmacyId: { in: tracked.pharmacyIds } },
    });
    await prisma.unavailability.deleteMany({ where: { pharmacyId: { in: tracked.pharmacyIds } } });
    await prisma.pharmacy.deleteMany({ where: { id: { in: tracked.pharmacyIds } } });
  }

  if (tracked.regionIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { entity: "Region", entityId: { in: tracked.regionIds } },
    });
    await prisma.dutyRule.deleteMany({ where: { regionId: { in: tracked.regionIds } } });
    await prisma.region.deleteMany({ where: { id: { in: tracked.regionIds } } });
  }

  if (tracked.userIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { OR: [{ entity: "User", entityId: { in: tracked.userIds } }, { userId: { in: tracked.userIds } }] },
    });
    await prisma.session.deleteMany({ where: { userId: { in: tracked.userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: tracked.userIds } } });
  }
}
