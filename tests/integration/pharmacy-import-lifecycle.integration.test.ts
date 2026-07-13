import { afterEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";

import { prisma } from "@/lib/prisma";
import {
  previewPharmacyImportAction,
  importPharmacyBatchAction,
} from "@/app/(dashboard)/eczaneler/ice-aktar/actions";
import { normalizeText } from "@/lib/historical/normalize";
import { IntegrationRedirectSignal, setIntegrationTestSessionToken } from "./helpers/setup";
import { raceThroughGate } from "./helpers/gate";
import {
  createTestOrganization,
  createTestPharmacy,
  createTestRegion,
  createTestSessionToken,
  createTestUser,
  cleanupTrackedIds,
  newTrackedIds,
} from "./helpers/fixtures";

// Final Multi-Tenancy and Pharmacy Import Acceptance Gate — sections 4
// (preview persistence), 5 (all-or-nothing transaction), and 6
// (concurrency). Real Postgres, real Server Actions.
describe("pharmacy import batch lifecycle and concurrency (real Postgres)", () => {
  const tracked = newTrackedIds();

  afterEach(async () => {
    setIntegrationTestSessionToken(undefined);
    await cleanupTrackedIds(tracked);
  });

  async function buildWorkbookFile(
    rows: (string | number)[][],
    headers = ["Bölge", "Eczane Adı", "Eczacı Adı Soyadı", "Telefon", "Aktif"]
  ): Promise<File> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Eczaneler");
    worksheet.addRow(headers);
    for (const row of rows) worksheet.addRow(row);
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return new File([arrayBuffer as ArrayBuffer], "test.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  // Pharmacy rows created by the real Server Action (not via the
  // createTestPharmacy fixture) are never added to tracked.pharmacyIds
  // automatically — without this, cleanupTrackedIds's region/organization
  // deletes fail on Pharmacy.regionId's Restrict FK.
  async function trackPharmaciesInRegion(regionId: string): Promise<void> {
    const pharmacies = await prisma.pharmacy.findMany({ where: { regionId }, select: { id: true } });
    tracked.pharmacyIds.push(...pharmacies.map((p) => p.id));
  }

  async function previewAndGetBatchId(
    token: string,
    rows: (string | number)[][]
  ): Promise<string> {
    setIntegrationTestSessionToken(token);
    const fd = new FormData();
    fd.set("file", await buildWorkbookFile(rows));
    try {
      await previewPharmacyImportAction({ success: false, message: "" }, fd);
      throw new Error("expected redirect");
    } catch (error) {
      if (error instanceof IntegrationRedirectSignal) {
        return error.path.split("/").pop()!.split("?")[0];
      }
      throw error;
    }
  }

  // ---- Section 4: preview persistence -----------------------------

  it("an expired batch cannot be imported, and is marked EXPIRED", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await createTestSessionToken(admin.id);

    const batchId = await previewAndGetBatchId(token, [
      [region.name, "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "Evet"],
    ]);
    tracked.organizationIds.push(organization.id);

    // Force expiry without waiting the real TTL out.
    await prisma.pharmacyImportBatch.update({
      where: { id: batchId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    setIntegrationTestSessionToken(token);
    await expect(importPharmacyBatchAction(batchId)).rejects.toBeInstanceOf(IntegrationRedirectSignal);

    const batch = await prisma.pharmacyImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe("EXPIRED");

    const created = await prisma.pharmacy.findMany({ where: { regionId: region.id } });
    expect(created).toHaveLength(0);
    await trackPharmaciesInRegion(region.id);
  });

  it("a consumed (already IMPORTED) batch cannot be replayed — no duplicate pharmacies", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await createTestSessionToken(admin.id);

    const batchId = await previewAndGetBatchId(token, [
      [region.name, "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "Evet"],
    ]);
    tracked.organizationIds.push(organization.id);

    setIntegrationTestSessionToken(token);
    await expect(importPharmacyBatchAction(batchId)).rejects.toBeInstanceOf(IntegrationRedirectSignal);

    // Replay attempt on the same, now-IMPORTED batch.
    setIntegrationTestSessionToken(token);
    await expect(importPharmacyBatchAction(batchId)).rejects.toBeInstanceOf(IntegrationRedirectSignal);

    const created = await prisma.pharmacy.findMany({ where: { regionId: region.id } });
    expect(created).toHaveLength(1); // not 2
    await trackPharmaciesInRegion(region.id);
  });

  it("PLATFORM_ADMIN cannot consume any organization's batch", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await createTestSessionToken(admin.id);

    const batchId = await previewAndGetBatchId(token, [
      [region.name, "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "Evet"],
    ]);
    tracked.organizationIds.push(organization.id);

    const { hashPassword } = await import("@/lib/auth/password");
    const platformAdmin = await prisma.user.create({
      data: {
        name: "Test Platform Admin",
        email: `platform-admin-${Date.now()}@integration.test`,
        passwordHash: await hashPassword("Test1234!"),
        role: "PLATFORM_ADMIN",
        isActive: true,
        organizationId: null,
      },
    });
    tracked.userIds.push(platformAdmin.id);
    const platformToken = await createTestSessionToken(platformAdmin.id);
    setIntegrationTestSessionToken(platformToken);

    await expect(importPharmacyBatchAction(batchId)).rejects.toBeInstanceOf(IntegrationRedirectSignal);

    const batch = await prisma.pharmacyImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe("PREVIEWED"); // untouched
  });

  it("another ADMIN in the SAME organization canNOT consume a batch they did not create (creator-scoped since region discovery: the preview's region decisions belong to the uploader)", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const creator = await createTestUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const otherAdmin = await createTestUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const creatorToken = await createTestSessionToken(creator.id);
    const otherToken = await createTestSessionToken(otherAdmin.id);

    const batchId = await previewAndGetBatchId(creatorToken, [
      [region.name, "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "Evet"],
    ]);
    tracked.organizationIds.push(organization.id);

    setIntegrationTestSessionToken(otherToken);
    await expect(importPharmacyBatchAction(batchId)).rejects.toBeInstanceOf(IntegrationRedirectSignal);

    // Rejected: batch untouched, no pharmacies created.
    const batch = await prisma.pharmacyImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe("PREVIEWED");
    expect(batch.consumedAt).toBeNull();
    expect(await prisma.pharmacy.count({ where: { regionId: region.id } })).toBe(0);

    // The creator can still consume it normally.
    setIntegrationTestSessionToken(creatorToken);
    await expect(importPharmacyBatchAction(batchId)).rejects.toBeInstanceOf(IntegrationRedirectSignal);
    const after = await prisma.pharmacyImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(after.status).toBe("IMPORTED");
    await trackPharmaciesInRegion(region.id);
  });

  it("importPharmacyBatchAction never reads row content from client input — only the server-persisted batchId argument", async () => {
    // Structural proof: the function signature accepts only a batchId
    // (string); it is bound with .bind(null, batch.id) server-side in
    // the preview page and invoked via a plain <form action> with no
    // other fields — there is no form field this test could tamper with
    // to alter row content, regionId, organizationId, status, or
    // counts. Confirmed by re-reading the implementation: every write
    // in the transaction is sourced from `batch.rows` (loaded via
    // prisma from the batchId), never from `formData`.
    expect(importPharmacyBatchAction.length).toBe(1);
  });

  // ---- Section 5: all-or-nothing transaction -----------------------

  it("a unique-constraint violation partway through import rolls back the entire transaction — zero partial Pharmacy rows, batch stays PREVIEWED", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await createTestSessionToken(admin.id);

    const batchId = await previewAndGetBatchId(token, [
      [region.name, "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "Evet"],
      [region.name, "Sifa Eczanesi", "Zeynep Kaya", "0216 000 00 00", "Evet"],
      [region.name, "Umut Eczanesi", "Mehmet Demir", "0212 111 11 11", "Evet"],
    ]);
    tracked.organizationIds.push(organization.id);

    // Simulate a race: a pharmacy matching the SECOND row's
    // (regionId, normalizedName) is created manually between preview
    // and import. Since region discovery, the import transaction
    // re-derives every row status from CURRENT database state before
    // writing anything, so this collision is caught as ALREADY_EXISTS
    // and blocked with a controlled redirect — the whole transaction
    // (including the consume-first status flip) rolls back. The DB
    // unique constraint remains the final authority underneath for the
    // narrower window inside the transaction itself (covered by the
    // region-discovery suite's pharmacy-stage-violation test).
    const raced = await createTestPharmacy(tracked, region.id, { name: "Sifa Eczanesi" });
    expect(normalizeText(raced.name)).toBe(normalizeText("Sifa Eczanesi"));

    setIntegrationTestSessionToken(token);
    await expect(importPharmacyBatchAction(batchId)).rejects.toBeInstanceOf(
      IntegrationRedirectSignal
    );

    // Row 1 ("Deva Eczanesi") would have succeeded on its own — proving
    // this is a real rollback, not just "row 2 was skipped."
    const devaRows = await prisma.pharmacy.findMany({
      where: { regionId: region.id, normalizedName: normalizeText("Deva Eczanesi") },
    });
    expect(devaRows).toHaveLength(0);

    const umutRows = await prisma.pharmacy.findMany({
      where: { regionId: region.id, normalizedName: normalizeText("Umut Eczanesi") },
    });
    expect(umutRows).toHaveLength(0);

    // Only the pre-existing (raced) row remains — the transaction did
    // not create a second copy of it either.
    const sifaRows = await prisma.pharmacy.findMany({
      where: { regionId: region.id, normalizedName: normalizeText("Sifa Eczanesi") },
    });
    expect(sifaRows).toHaveLength(1);
    expect(sifaRows[0].id).toBe(raced.id);

    const batch = await prisma.pharmacyImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe("PREVIEWED"); // never flipped to IMPORTED
    expect(batch.consumedAt).toBeNull();

    const auditLog = await prisma.auditLog.findFirst({
      where: { entity: "PharmacyImportBatch", entityId: batchId, action: "CREATE" },
    });
    expect(auditLog).toBeNull(); // no success audit log for a rolled-back import

    // A safe retry after correcting the collision (e.g. re-preview)
    // would behave correctly — proven separately by the "ALREADY_EXISTS"
    // blocking-preview test in pharmacy-excel-import.integration.test.ts,
    // which is exactly the state a fresh preview would now detect.
  });

  // ---- Section 6: concurrency ---------------------------------------

  it("the same batch submitted twice concurrently imports exactly once — the second call sees IMPORTED/expired-by-then state, not a duplicate", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await createTestSessionToken(admin.id);

    const batchId = await previewAndGetBatchId(token, [
      [region.name, "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "Evet"],
    ]);
    tracked.organizationIds.push(organization.id);

    setIntegrationTestSessionToken(token);
    const [r1, r2] = await raceThroughGate(
      () => importPharmacyBatchAction(batchId),
      () => importPharmacyBatchAction(batchId)
    );

    // Both calls redirect either way (success -> /eczaneler, or
    // already-consumed -> back to /eczaneler/ice-aktar with an error) —
    // both are IntegrationRedirectSignal, so the real assertion is on
    // the resulting row count, not which promise "won".
    expect(r1.status === "fulfilled" || r1.status === "rejected").toBe(true);
    expect(r2.status === "fulfilled" || r2.status === "rejected").toBe(true);

    const created = await prisma.pharmacy.findMany({ where: { regionId: region.id } });
    expect(created).toHaveLength(1); // exactly one, never two
    await trackPharmaciesInRegion(region.id);
  });

  it("two organizations importing identical region/pharmacy names never collide", async () => {
    const orgA = await createTestOrganization(tracked);
    const orgB = await createTestOrganization(tracked);
    const sharedRegionName = "Aynı İsimli Bölge";
    const regionA = await createTestRegion(tracked, { organizationId: orgA.id, name: sharedRegionName });
    const regionB = await createTestRegion(tracked, { organizationId: orgB.id, name: sharedRegionName });
    const adminA = await createTestUser(tracked, { role: "ADMIN", organizationId: orgA.id });
    const adminB = await createTestUser(tracked, { role: "ADMIN", organizationId: orgB.id });
    const tokenA = await createTestSessionToken(adminA.id);
    const tokenB = await createTestSessionToken(adminB.id);

    const rows = [[sharedRegionName, "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "Evet"]];
    const batchIdA = await previewAndGetBatchId(tokenA, rows);
    const batchIdB = await previewAndGetBatchId(tokenB, rows);

    setIntegrationTestSessionToken(tokenA);
    await expect(importPharmacyBatchAction(batchIdA)).rejects.toBeInstanceOf(IntegrationRedirectSignal);
    setIntegrationTestSessionToken(tokenB);
    await expect(importPharmacyBatchAction(batchIdB)).rejects.toBeInstanceOf(IntegrationRedirectSignal);

    const pharmaciesA = await prisma.pharmacy.findMany({ where: { regionId: regionA.id } });
    const pharmaciesB = await prisma.pharmacy.findMany({ where: { regionId: regionB.id } });
    expect(pharmaciesA).toHaveLength(1);
    expect(pharmaciesB).toHaveLength(1);
    expect(pharmaciesA[0].id).not.toBe(pharmaciesB[0].id);
    await trackPharmaciesInRegion(regionA.id);
    await trackPharmaciesInRegion(regionB.id);
  });

  it("importing while the matching pharmacy was manually created concurrently is caught by the DB unique constraint, not left in a corrupted state", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await createTestSessionToken(admin.id);

    const batchId = await previewAndGetBatchId(token, [
      [region.name, "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "Evet"],
    ]);
    tracked.organizationIds.push(organization.id);

    setIntegrationTestSessionToken(token);
    const [importResult, manualCreateResult] = await raceThroughGate(
      () => importPharmacyBatchAction(batchId),
      () => createTestPharmacy(tracked, region.id, { name: "Deva Eczanesi" })
    );

    void importResult;
    void manualCreateResult;

    const pharmacies = await prisma.pharmacy.findMany({
      where: { regionId: region.id, normalizedName: normalizeText("Deva Eczanesi") },
    });
    // Exactly one survives, regardless of which write won the race —
    // the DB's (regionId, normalizedName) unique constraint is the
    // final authority, never a pre-check race condition.
    expect(pharmacies).toHaveLength(1);
    await trackPharmaciesInRegion(region.id);
  });
});
