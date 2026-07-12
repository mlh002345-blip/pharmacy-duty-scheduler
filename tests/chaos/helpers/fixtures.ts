import { randomBytes, randomUUID } from "node:crypto";

import type { UserRole } from "@prisma/client";

import { hashPassword } from "@/lib/auth/password";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { normalizeText } from "@/lib/historical/normalize";

import { findLatestManifest, writeManifest, type ChaosManifest } from "../../../scripts/chaos/manifest";
import { chaosPrisma } from "./db";

// One runId per Vitest worker process, so every fixture created across
// every spec file in that worker shares one CHAOS-<runId> marker and one
// incrementally-updated manifest file — if a scenario crashes mid-fault-
// injection (e.g. the local PostgreSQL service is stopped while an
// assertion is pending), the manifest on disk still reflects everything
// created so far, so `npm run test:chaos:cleanup` can recover it without
// needing afterAll to have run.
const RUN_ID = `${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
export const CHAOS_MARKER = `CHAOS-${RUN_ID}`;

function currentManifest(): ChaosManifest {
  const existing = findLatestManifest();
  if (existing && existing.runId === RUN_ID) return existing;
  return {
    runId: RUN_ID,
    marker: CHAOS_MARKER,
    createdAt: new Date().toISOString(),
    organizationIds: [],
    regionIds: [],
    pharmacyIds: [],
    userIds: [],
    historicalBatchIds: [],
    sessionTokenPrefix: `${CHAOS_MARKER}-session-`,
  };
}

function track(mutate: (m: ChaosManifest) => void): void {
  const manifest = currentManifest();
  mutate(manifest);
  writeManifest(manifest);
}

export function chaosRunId(): string {
  return RUN_ID;
}

export async function createChaosUser(
  overrides: Partial<{
    role: UserRole;
    isActive: boolean;
    email: string;
    password: string;
    organizationId: string;
  }> = {}
) {
  const id = randomUUID().slice(0, 8);
  const organizationId = overrides.organizationId ?? (await createChaosOrganization()).id;
  const user = await chaosPrisma.user.create({
    data: {
      name: `${CHAOS_MARKER} Kullanıcı ${id}`,
      email: overrides.email ?? `${CHAOS_MARKER.toLowerCase()}-${id}@chaos.invalid`,
      passwordHash: await hashPassword(overrides.password ?? "ChaosTest1234!"),
      role: overrides.role ?? "ADMIN",
      isActive: overrides.isActive ?? true,
      organizationId,
    },
  });
  track((m) => m.userIds.push(user.id));
  return user;
}

export async function createChaosSession(userId: string, expiresAt?: Date) {
  const token = randomBytes(32).toString("hex");
  await chaosPrisma.session.create({
    data: { token, userId, expiresAt: expiresAt ?? new Date(Date.now() + 60 * 60 * 1000) },
  });
  return token;
}

export async function createChaosOrganization() {
  const id = randomUUID().slice(0, 8);
  const organization = await chaosPrisma.organization.create({
    data: {
      name: `${CHAOS_MARKER}-Org-${id}`,
      province: "Chaos",
      slug: `${CHAOS_MARKER.toLowerCase()}-org-${id}`,
      isActive: true,
    },
  });
  track((m) => m.organizationIds.push(organization.id));
  return organization;
}

export async function createChaosRegion(
  overrides: Partial<{ name: string; dailyDutyCount: number; organizationId: string }> = {}
) {
  const organizationId = overrides.organizationId ?? (await createChaosOrganization()).id;
  const region = await chaosPrisma.region.create({
    data: {
      name: overrides.name ?? `${CHAOS_MARKER}-Region-${randomUUID().slice(0, 6)}`,
      district: "Chaos İlçe",
      dailyDutyCount: overrides.dailyDutyCount ?? 1,
      isActive: true,
      organizationId,
    },
  });
  track((m) => m.regionIds.push(region.id));
  return region;
}

export async function createChaosPharmacy(
  regionId: string,
  overrides: Partial<{ name: string; isActive: boolean }> = {}
) {
  const name = overrides.name ?? `${CHAOS_MARKER}-Pharmacy-${randomUUID().slice(0, 6)}`;
  const pharmacy = await chaosPrisma.pharmacy.create({
    data: {
      name,
      normalizedName: normalizeText(name),
      pharmacistName: "Chaos Eczacı",
      phone: "0000000000",
      address: "Chaos Adres",
      city: "İstanbul",
      district: "Chaos İlçe",
      requestToken: randomBytes(16).toString("hex"),
      isActive: overrides.isActive ?? true,
      regionId,
    },
  });
  track((m) => m.pharmacyIds.push(pharmacy.id));
  return pharmacy;
}

export async function createChaosDutySchedule(
  regionId: string,
  overrides: Partial<{ month: number; year: number; status: "DRAFT" | "PUBLISHED" }> = {}
) {
  const schedule = await chaosPrisma.dutySchedule.create({
    data: {
      month: overrides.month ?? 1,
      year: overrides.year ?? 2031, // far-future year avoids colliding with any real schedule
      regionId,
      status: overrides.status ?? "PUBLISHED",
    },
  });
  return schedule;
}

export { SESSION_COOKIE_NAME };
