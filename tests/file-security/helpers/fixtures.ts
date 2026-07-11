import { randomUUID } from "node:crypto";

import { hashPassword } from "@/lib/auth/password";

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

export async function createFileTestAdmin() {
  const id = randomUUID().slice(0, 8);
  const user = await fileTestPrisma.user.create({
    data: {
      name: `${FILE_TEST_MARKER} Yönetici`,
      email: `${FILE_TEST_MARKER.toLowerCase()}-${id}@filetest.invalid`,
      passwordHash: await hashPassword("FileTest1234!"),
      role: "ADMIN",
      isActive: true,
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

export async function createFileTestRegion() {
  const region = await fileTestPrisma.region.create({
    data: {
      name: `${FILE_TEST_MARKER}-Bölge-${randomUUID().slice(0, 6)}`,
      district: "Test İlçe",
      dailyDutyCount: 1,
      isActive: true,
    },
  });
  track((m) => m.regionIds.push(region.id));
  return region;
}

export async function createFileTestPharmacy(regionId: string, name?: string) {
  const pharmacy = await fileTestPrisma.pharmacy.create({
    data: {
      name: name ?? `${FILE_TEST_MARKER}-Eczane-${randomUUID().slice(0, 6)}`,
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
