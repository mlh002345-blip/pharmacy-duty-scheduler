import { afterEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";

import { prisma } from "@/lib/prisma";
import {
  previewPharmacyImportAction,
  importPharmacyBatchAction,
} from "@/app/(dashboard)/eczaneler/ice-aktar/actions";
import { IntegrationRedirectSignal, setIntegrationTestSessionToken } from "./helpers/setup";
import {
  createTestOrganization,
  createTestPharmacy,
  createTestRegion,
  createTestSessionToken,
  createTestUser,
  cleanupTrackedIds,
  newTrackedIds,
} from "./helpers/fixtures";

// Multi-Tenancy Chunk 3 — generic ADMIN-only Pharmacy Excel Import.
// Real Postgres, real Server Actions: proves ADMIN-only access, that
// organizationId always comes from the session (never the upload), that
// the final import is one all-or-nothing transaction, and that region
// matching never crosses an organization boundary even with identically
// named regions.
describe("pharmacy Excel import (real Postgres)", () => {
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
    return new File([arrayBuffer as ArrayBuffer], "test-import.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  function previewFormData(file: File, defaultAreaCode?: string): FormData {
    const fd = new FormData();
    fd.set("file", file);
    if (defaultAreaCode) fd.set("defaultAreaCode", defaultAreaCode);
    return fd;
  }

  async function runPreview(file: File, defaultAreaCode?: string) {
    try {
      await previewPharmacyImportAction(
        { success: false, message: "" },
        previewFormData(file, defaultAreaCode)
      );
      throw new Error("expected a redirect");
    } catch (error) {
      if (error instanceof IntegrationRedirectSignal) return error.path;
      throw error;
    }
  }

  function extractBatchId(redirectPath: string): string {
    // "/eczaneler/ice-aktar/onizleme/<id>?success=..."
    return redirectPath.split("/").pop()!.split("?")[0];
  }

  it("denies STAFF, VIEWER, and anonymous callers; only ADMIN may preview", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const file = await buildWorkbookFile([[region.name, "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "Evet"]]);

    for (const role of ["STAFF", "VIEWER"] as const) {
      const user = await createTestUser(tracked, { role, organizationId: organization.id });
      const token = await createTestSessionToken(user.id);
      setIntegrationTestSessionToken(token);
      const result = await previewPharmacyImportAction(
        { success: false, message: "" },
        previewFormData(file)
      );
      expect(result.success).toBe(false);
    }

    setIntegrationTestSessionToken(undefined);
    await expect(
      previewPharmacyImportAction({ success: false, message: "" }, previewFormData(file))
    ).rejects.toMatchObject({ path: "/giris" });
  });

  it("ADMIN preview creates an org-scoped batch, and a fully-ready file can be imported in one transaction", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await createTestSessionToken(admin.id);
    setIntegrationTestSessionToken(token);

    const file = await buildWorkbookFile([
      [region.name, "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "Evet"],
      [region.name, "Şifa Eczanesi", "Zeynep Kaya", "0216 000 00 00", "Hayır"],
    ]);

    const redirectPath = await runPreview(file);
    const batchId = extractBatchId(redirectPath);

    const batch = await prisma.pharmacyImportBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: { rows: true },
    });
    expect(batch.organizationId).toBe(organization.id);
    expect(batch.status).toBe("PREVIEWED");
    expect(batch.totalRows).toBe(2);
    expect(batch.readyRows).toBe(2);
    expect(batch.rows.every((r) => r.status === "READY")).toBe(true);

    setIntegrationTestSessionToken(token);
    await expect(importPharmacyBatchAction(batchId)).rejects.toBeInstanceOf(IntegrationRedirectSignal);

    const createdPharmacies = await prisma.pharmacy.findMany({
      where: { regionId: region.id },
      orderBy: { name: "asc" },
    });
    tracked.pharmacyIds.push(...createdPharmacies.map((p) => p.id));
    expect(createdPharmacies).toHaveLength(2);
    expect(createdPharmacies[0]).toMatchObject({
      name: "Deva Eczanesi",
      pharmacistName: "Ada Yılmaz",
      phone: "+90 212 212 19 18",
      isActive: true,
      city: organization.province,
      district: region.district,
      address: "",
    });
    expect(createdPharmacies[1].isActive).toBe(false);

    const finalBatch = await prisma.pharmacyImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(finalBatch.status).toBe("IMPORTED");
    expect(finalBatch.consumedAt).not.toBeNull();

    const auditLog = await prisma.auditLog.findFirstOrThrow({
      where: { entity: "PharmacyImportBatch", entityId: batchId, action: "CREATE" },
    });
    expect(auditLog.organizationId).toBe(organization.id);
    const after = JSON.parse(auditLog.after!);
    expect(after).toMatchObject({ createdCount: 2 });
    // Never the raw workbook content, and never a full pharmacy list.
    expect(JSON.stringify(after)).not.toContain("Deva Eczanesi");
  });

  it("never matches a region belonging to a different organization, even with an identical name", async () => {
    const orgA = await createTestOrganization(tracked);
    const orgB = await createTestOrganization(tracked);
    const sharedRegionName = "Aynı İsimli Bölge";
    const regionA = await createTestRegion(tracked, { organizationId: orgA.id, name: sharedRegionName });
    await createTestRegion(tracked, { organizationId: orgB.id, name: sharedRegionName });

    const adminA = await createTestUser(tracked, { role: "ADMIN", organizationId: orgA.id });
    const tokenA = await createTestSessionToken(adminA.id);
    setIntegrationTestSessionToken(tokenA);

    const file = await buildWorkbookFile([
      [sharedRegionName, "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "Evet"],
    ]);
    const redirectPath = await runPreview(file);
    const batchId = extractBatchId(redirectPath);

    const batch = await prisma.pharmacyImportBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: { rows: true },
    });
    expect(batch.rows[0].regionId).toBe(regionA.id);
    expect(batch.organizationId).toBe(orgA.id);
  });

  it("an organization B ADMIN cannot import or even view organization A's batch (org-scoped 404)", async () => {
    const orgA = await createTestOrganization(tracked);
    const orgB = await createTestOrganization(tracked);
    const regionA = await createTestRegion(tracked, { organizationId: orgA.id });
    const adminA = await createTestUser(tracked, { role: "ADMIN", organizationId: orgA.id });
    const adminB = await createTestUser(tracked, { role: "ADMIN", organizationId: orgB.id });
    const tokenA = await createTestSessionToken(adminA.id);
    const tokenB = await createTestSessionToken(adminB.id);

    setIntegrationTestSessionToken(tokenA);
    const file = await buildWorkbookFile([
      [regionA.name, "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "Evet"],
    ]);
    const redirectPath = await runPreview(file);
    const batchId = extractBatchId(redirectPath);

    setIntegrationTestSessionToken(tokenB);
    await expect(importPharmacyBatchAction(batchId)).rejects.toBeInstanceOf(IntegrationRedirectSignal);

    const batch = await prisma.pharmacyImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe("PREVIEWED"); // never imported by the wrong org's admin

    const pharmaciesInRegionA = await prisma.pharmacy.findMany({ where: { regionId: regionA.id } });
    expect(pharmaciesInRegionA).toHaveLength(0);
  });

  it("blocks the whole batch (all-or-nothing) when any row is not fully ready, and no pharmacy is created", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await createTestSessionToken(admin.id);
    setIntegrationTestSessionToken(token);

    const file = await buildWorkbookFile([
      [region.name, "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "Evet"],
      ["Var Olmayan Bölge", "Şifa Eczanesi", "Zeynep Kaya", "0216 000 00 00", "Evet"],
    ]);
    const redirectPath = await runPreview(file);
    const batchId = extractBatchId(redirectPath);

    const batch = await prisma.pharmacyImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.readyRows).toBe(1);
    expect(batch.invalidRows).toBe(1);

    setIntegrationTestSessionToken(token);
    await expect(importPharmacyBatchAction(batchId)).rejects.toBeInstanceOf(IntegrationRedirectSignal);

    const finalBatch = await prisma.pharmacyImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(finalBatch.status).toBe("PREVIEWED"); // never flipped to IMPORTED

    const createdPharmacies = await prisma.pharmacy.findMany({ where: { regionId: region.id } });
    expect(createdPharmacies).toHaveLength(0);
  });

  it("blocks an already-existing pharmacy (same org, same region, same normalized name) from being re-imported", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    await createTestPharmacy(tracked, region.id, { name: "Deva Eczanesi" });
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await createTestSessionToken(admin.id);
    setIntegrationTestSessionToken(token);

    const file = await buildWorkbookFile([
      [region.name, "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "Evet"],
    ]);
    const redirectPath = await runPreview(file);
    const batchId = extractBatchId(redirectPath);

    const batch = await prisma.pharmacyImportBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: { rows: true },
    });
    expect(batch.rows[0].status).toBe("ALREADY_EXISTS");
    expect(batch.readyRows).toBe(0);
  });

  it("combines a bare 7-digit phone with the ADMIN-supplied default area code end-to-end", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await createTestSessionToken(admin.id);
    setIntegrationTestSessionToken(token);

    const file = await buildWorkbookFile([[region.name, "Deva Eczanesi", "Ada Yılmaz", "2121918", "Evet"]]);
    const redirectPath = await runPreview(file, "228");
    const batchId = extractBatchId(redirectPath);

    const batch = await prisma.pharmacyImportBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: { rows: true },
    });
    expect(batch.rows[0].phone).toBe("+90 228 212 19 18");
    expect(batch.rows[0].status).toBe("READY");
  });

  it("blocks a bare 7-digit phone when no default area code was supplied", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await createTestSessionToken(admin.id);
    setIntegrationTestSessionToken(token);

    const file = await buildWorkbookFile([[region.name, "Deva Eczanesi", "Ada Yılmaz", "2121918", "Evet"]]);
    const redirectPath = await runPreview(file);
    const batchId = extractBatchId(redirectPath);

    const batch = await prisma.pharmacyImportBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: { rows: true },
    });
    expect(batch.rows[0].status).toBe("INVALID");
    expect(batch.rows[0].safeErrorCode).toBe("PHONE_MISSING_DEFAULT_AREA_CODE");
  });
});
