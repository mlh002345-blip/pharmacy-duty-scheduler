import { randomUUID } from "node:crypto";

import { hashPassword } from "@/lib/auth/password";
import { normalizeText } from "@/lib/historical/normalize";

import { findAllManifests, writeManifest, type FileTestManifest } from "../../../scripts/file-security/manifest";
import { fileTestPrisma } from "./db";

const RUN_ID = `${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
export const FILE_TEST_MARKER = `FILETEST-${RUN_ID}`;

function currentManifest(): FileTestManifest {
  const existing = findAllManifests().find((m) => m.runId === RUN_ID);
  if (existing) return existing;
  return {
    runId: RUN_ID,
    marker: FILE_TEST_MARKER,
    createdAt: new Date().toISOString(),
    organizationIds: [],
    regionIds: [],
    pharmacyIds: [],
    userIds: [],
    historicalBatchIds: [],
  };
}

function track(mutate: (m: FileTestManifest) => void): void {
  const manifest = currentManifest();
  mutate(manifest);
  writeManifest(manifest);
}

export function fileTestRunId(): string {
  return RUN_ID;
}

// Most file-security specs only need one organization (single-tenant
// scenarios) — this default organization is created once per process
// and reused by createFileTestAdmin/createFileTestRegion unless an
// explicit organizationId is passed. Tenant-isolation-specific tests
// call createFileTestOrganization() again for a genuinely second org.
let defaultOrganizationId: string | undefined;

export async function createFileTestOrganization() {
  const id = randomUUID().slice(0, 8);
  const organization = await fileTestPrisma.organization.create({
    data: {
      name: `${FILE_TEST_MARKER}-Org-${id}`,
      province: "FileTest",
      slug: `${FILE_TEST_MARKER.toLowerCase()}-org-${id}`,
      isActive: true,
    },
  });
  track((m) => m.organizationIds.push(organization.id));
  return organization;
}

async function defaultOrganization(): Promise<string> {
  if (!defaultOrganizationId) {
    defaultOrganizationId = (await createFileTestOrganization()).id;
  }
  return defaultOrganizationId;
}

export async function createFileTestAdmin(organizationId?: string) {
  const id = randomUUID().slice(0, 8);
  const user = await fileTestPrisma.user.create({
    data: {
      name: `${FILE_TEST_MARKER} Yönetici`,
      email: `${FILE_TEST_MARKER.toLowerCase()}-${id}@filetest.invalid`,
      passwordHash: await hashPassword("FileTest1234!"),
      role: "ADMIN",
      isActive: true,
      organizationId: organizationId ?? (await defaultOrganization()),
    },
  });
  track((m) => m.userIds.push(user.id));
  return user;
}

export async function createFileTestSession(userId: string) {
  const token = randomUUID() + randomUUID();
  await fileTestPrisma.session.create({
    data: { token, userId, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  });
  return token;
}

export async function createFileTestRegion(organizationId?: string) {
  const region = await fileTestPrisma.region.create({
    data: {
      name: `${FILE_TEST_MARKER}-Bölge-${randomUUID().slice(0, 6)}`,
      district: "Test İlçe",
      dailyDutyCount: 1,
      isActive: true,
      organizationId: organizationId ?? (await defaultOrganization()),
    },
  });
  track((m) => m.regionIds.push(region.id));
  return region;
}

export async function createFileTestPharmacy(regionId: string, name?: string) {
  const pharmacyName = name ?? `${FILE_TEST_MARKER}-Eczane-${randomUUID().slice(0, 6)}`;
  const pharmacy = await fileTestPrisma.pharmacy.create({
    data: {
      name: pharmacyName,
      normalizedName: normalizeText(pharmacyName),
      pharmacistName: "Test Eczacı",
      phone: "0000000000",
      address: "Test Adres",
      city: "İstanbul",
      district: "Test İlçe",
      isActive: true,
      regionId,
    },
  });
  track((m) => m.pharmacyIds.push(pharmacy.id));
  return pharmacy;
}

export function trackHistoricalBatch(batchId: string): void {
  track((m) => {
    if (!m.historicalBatchIds.includes(batchId)) m.historicalBatchIds.push(batchId);
  });
}
