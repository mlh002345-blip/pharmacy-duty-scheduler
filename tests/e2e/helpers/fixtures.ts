import { randomBytes, randomUUID } from "node:crypto";

import type { UserRole } from "@prisma/client";

import { hashPassword } from "@/lib/auth/password";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { hashAccountIdentifier } from "@/lib/auth/login-rate-limit";
import { UNTRUSTED_NETWORK_BUCKET_KEY } from "@/lib/security/client-identity";
import { normalizeText } from "@/lib/historical/normalize";

import { e2ePrisma } from "./db";

// Every synthetic row created by an E2E test is tagged with a short,
// per-test-run unique id (via email/name prefixes) so leftover rows are
// trivially identifiable and never collide with another concurrent E2E
// run's data, and is tracked here so `cleanupTrackedIds` can delete
// exactly (and only) what this test run created — never a table-wide
// wipe, safe even on a shared E2E database.
export function testRunId(): string {
  return randomUUID().slice(0, 8);
}

export type TrackedIds = {
  organizationIds: string[];
  userIds: string[];
  userEmails: string[];
  sessionTokens: string[];
  regionIds: string[];
  pharmacyIds: string[];
  dutyScheduleIds: string[];
  dutyRequestIds: string[];
};

export function newTrackedIds(): TrackedIds {
  return {
    organizationIds: [],
    userIds: [],
    userEmails: [],
    sessionTokens: [],
    regionIds: [],
    pharmacyIds: [],
    dutyScheduleIds: [],
    dutyRequestIds: [],
  };
}

// A fixed, well-known password used for every synthetic E2E user — never
// printed, never asserted in full anywhere test output could be logged;
// tests that need to log in use this constant directly rather than a
// value read back from a database column.
export const E2E_TEST_PASSWORD = "E2eTest1234!";

// Most E2E specs only need one organization (single-tenant scenarios);
// tenant-isolation specs call this explicitly for a second organization
// and pass its id into createE2EUser/createE2ERegion.
export async function createE2EOrganization(tracked: TrackedIds) {
  const id = testRunId();
  const organization = await e2ePrisma.organization.create({
    data: { name: `E2E Oda ${id}`, province: "E2E", slug: `e2e-oda-${id}`, isActive: true },
  });
  tracked.organizationIds.push(organization.id);
  return organization;
}

export async function createE2EUser(
  tracked: TrackedIds,
  overrides: Partial<{
    role: UserRole;
    isActive: boolean;
    email: string;
    password: string;
    organizationId: string;
  }> = {}
) {
  const id = testRunId();
  const organizationId = overrides.organizationId ?? (await createE2EOrganization(tracked)).id;
  const user = await e2ePrisma.user.create({
    data: {
      name: `E2E Kullanıcı ${id}`,
      email: overrides.email ?? `e2e-${id}@e2e.invalid`,
      passwordHash: await hashPassword(overrides.password ?? E2E_TEST_PASSWORD),
      role: overrides.role ?? "VIEWER",
      isActive: overrides.isActive ?? true,
      organizationId,
    },
  });
  tracked.userIds.push(user.id);
  tracked.userEmails.push(user.email);
  return user;
}

export async function createE2ESession(tracked: TrackedIds, userId: string, expiresAt?: Date) {
  const token = randomBytes(32).toString("hex");
  await e2ePrisma.session.create({
    data: {
      token,
      userId,
      expiresAt: expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  tracked.sessionTokens.push(token);
  return token;
}

export async function createE2ERegion(
  tracked: TrackedIds,
  overrides: Partial<{ name: string; dailyDutyCount: number; organizationId: string }> = {}
) {
  const organizationId = overrides.organizationId ?? (await createE2EOrganization(tracked)).id;
  const region = await e2ePrisma.region.create({
    data: {
      name: overrides.name ?? `E2E Bölge ${testRunId()}`,
      district: "E2E İlçe",
      dailyDutyCount: overrides.dailyDutyCount ?? 1,
      isActive: true,
      organizationId,
    },
  });
  tracked.regionIds.push(region.id);
  return region;
}

export async function createE2EPharmacy(
  tracked: TrackedIds,
  regionId: string,
  overrides: Partial<{ name: string; requestToken: string; isActive: boolean }> = {}
) {
  const name = overrides.name ?? `E2E Eczane ${testRunId()}`;
  const pharmacy = await e2ePrisma.pharmacy.create({
    data: {
      name,
      normalizedName: normalizeText(name),
      pharmacistName: "E2E Eczacı",
      phone: "0000000000",
      address: "E2E Adres",
      city: "İstanbul",
      district: "E2E İlçe",
      requestToken: overrides.requestToken ?? randomBytes(16).toString("hex"),
      isActive: overrides.isActive ?? true,
      regionId,
    },
  });
  tracked.pharmacyIds.push(pharmacy.id);
  return pharmacy;
}

export async function createE2EDutySchedule(
  tracked: TrackedIds,
  regionId: string,
  overrides: Partial<{ month: number; year: number; status: "DRAFT" | "PUBLISHED" }> = {}
) {
  const schedule = await e2ePrisma.dutySchedule.create({
    data: {
      month: overrides.month ?? 1,
      year: overrides.year ?? 2030, // far-future year avoids colliding with any real schedule
      regionId,
      status: overrides.status ?? "DRAFT",
    },
  });
  tracked.dutyScheduleIds.push(schedule.id);
  return schedule;
}

export async function createE2EDutyRequest(
  tracked: TrackedIds,
  pharmacyId: string,
  regionId: string
) {
  const request = await e2ePrisma.dutyRequest.create({
    data: {
      pharmacyId,
      regionId,
      requestType: "CANNOT_DUTY",
      startDate: new Date("2030-01-10"),
      endDate: new Date("2030-01-11"),
      explanation: "E2E test talebi.",
      status: "PENDING",
      source: "ADMIN_ENTRY",
    },
  });
  tracked.dutyRequestIds.push(request.id);
  return request;
}

// Deletes exactly the rows this E2E test run created, in FK-safe order
// (children before parents). Never issues a table-wide deleteMany, so
// it's safe even on a shared E2E database.
export async function cleanupTrackedIds(tracked: TrackedIds): Promise<void> {
  if (tracked.sessionTokens.length > 0) {
    await e2ePrisma.session.deleteMany({ where: { token: { in: tracked.sessionTokens } } });
  }
  if (tracked.dutyRequestIds.length > 0) {
    await e2ePrisma.dutyRequest.deleteMany({ where: { id: { in: tracked.dutyRequestIds } } });
  }
  if (tracked.dutyScheduleIds.length > 0) {
    await e2ePrisma.dutyScheduleWarning.deleteMany({
      where: { scheduleId: { in: tracked.dutyScheduleIds } },
    });
    await e2ePrisma.auditLog.deleteMany({
      where: {
        OR: [
          { entity: "DutySchedule", entityId: { in: tracked.dutyScheduleIds } },
          { dutyAssignment: { dutyScheduleId: { in: tracked.dutyScheduleIds } } },
        ],
      },
    });
    await e2ePrisma.dutyAssignment.deleteMany({
      where: { dutyScheduleId: { in: tracked.dutyScheduleIds } },
    });
    await e2ePrisma.dutySchedule.deleteMany({ where: { id: { in: tracked.dutyScheduleIds } } });
  }
  if (tracked.pharmacyIds.length > 0) {
    await e2ePrisma.auditLog.deleteMany({
      where: { entity: "Pharmacy", entityId: { in: tracked.pharmacyIds } },
    });
    await e2ePrisma.dutyRequest.deleteMany({ where: { pharmacyId: { in: tracked.pharmacyIds } } });
    await e2ePrisma.dutyBalanceAdjustment.deleteMany({
      where: { pharmacyId: { in: tracked.pharmacyIds } },
    });
    await e2ePrisma.unavailability.deleteMany({ where: { pharmacyId: { in: tracked.pharmacyIds } } });
    await e2ePrisma.pharmacy.deleteMany({ where: { id: { in: tracked.pharmacyIds } } });
  }
  if (tracked.regionIds.length > 0) {
    await e2ePrisma.auditLog.deleteMany({
      where: { entity: "Region", entityId: { in: tracked.regionIds } },
    });
    await e2ePrisma.dutyRule.deleteMany({ where: { regionId: { in: tracked.regionIds } } });
    await e2ePrisma.region.deleteMany({ where: { id: { in: tracked.regionIds } } });
  }
  if (tracked.userEmails.length > 0) {
    // LoginAttempt rows are keyed by a one-way hash of the normalized
    // email (never the raw email itself, and never joined to User) — the
    // exact hashes for this run's own synthetic emails are recomputed
    // here so cleanup can target precisely those rows, never a
    // table-wide wipe.
    const accountBucketKeys = tracked.userEmails.map((email) => hashAccountIdentifier(email));
    await e2ePrisma.loginAttempt.deleteMany({
      where: { bucketType: "ACCOUNT", bucketKey: { in: accountBucketKeys } },
    });
  }
  // The untrusted-network bucket is a single, deterministic, non-secret
  // shared row (TRUST_PROXY_HEADERS is off by default — see
  // src/lib/security/client-identity.ts) that every E2E login-failure
  // scenario across every spec file increments. It's always safe to
  // delete here (it isn't tied to any real identity) and is deleted
  // unconditionally so it never leaks state between spec files that
  // otherwise track completely disjoint synthetic users.
  await e2ePrisma.loginAttempt.deleteMany({
    where: { bucketType: "NETWORK", bucketKey: UNTRUSTED_NETWORK_BUCKET_KEY },
  });
  if (tracked.userIds.length > 0) {
    await e2ePrisma.auditLog.deleteMany({
      where: {
        OR: [{ entity: "User", entityId: { in: tracked.userIds } }, { userId: { in: tracked.userIds } }],
      },
    });
    // PharmacyImportBatch.createdById -> User has no cascade — a batch
    // created by a tracked user must be deleted here or user.deleteMany
    // hits a FK violation (PharmacyImportRow cascades from its batch).
    await e2ePrisma.pharmacyImportBatch.deleteMany({
      where: { createdById: { in: tracked.userIds } },
    });
    await e2ePrisma.session.deleteMany({ where: { userId: { in: tracked.userIds } } });
    await e2ePrisma.user.deleteMany({ where: { id: { in: tracked.userIds } } });
  }
  if (tracked.organizationIds.length > 0) {
    // Organization.onDelete is Restrict for Region/User/AuditLog —
    // deleting it last, after every dependent row above, is required.
    // AuditLog.organizationId is also Restrict, and platform/import
    // actions write AuditLog rows (entity: "Organization" /
    // "PharmacyImportBatch") that none of the entity-specific cleanup
    // above covers — delete every remaining AuditLog row still pointing
    // at a tracked organization before deleting the organizations
    // themselves.
    await e2ePrisma.auditLog.deleteMany({
      where: { organizationId: { in: tracked.organizationIds } },
    });
    await e2ePrisma.organization.deleteMany({ where: { id: { in: tracked.organizationIds } } });
  }
}

export { SESSION_COOKIE_NAME };
