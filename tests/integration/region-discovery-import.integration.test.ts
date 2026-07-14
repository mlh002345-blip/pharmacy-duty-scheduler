import { afterEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";

import { prisma } from "@/lib/prisma";
import {
  previewPharmacyImportAction,
  importPharmacyBatchAction,
} from "@/app/(dashboard)/eczaneler/ice-aktar/actions";
import {
  approveRegionCandidateAction,
  assignRowToCandidateAction,
  createManualRegionCandidateAction,
  matchRegionCandidateAction,
  resetRegionCandidateAction,
  updateRegionCandidateAction,
} from "@/app/(dashboard)/eczaneler/ice-aktar/candidate-actions";
import {
  createRegionAction,
  setRegionStatusAction,
} from "@/app/(dashboard)/bolgeler/actions";
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
  testRunId,
} from "./helpers/fixtures";

// Automatic Region Discovery — real Postgres, real Server Actions:
// candidate lifecycle, the all-or-nothing region+pharmacy transaction,
// concurrency, cross-tenant isolation, and manual-region-CRUD
// preservation. See docs/features/AUTOMATIC_REGION_DISCOVERY.md.
describe("automatic region discovery import (real Postgres)", () => {
  const tracked = newTrackedIds();

  afterEach(async () => {
    setIntegrationTestSessionToken(undefined);
    await cleanupTrackedIds(tracked);
  });

  async function buildWorkbookFile(
    rows: (string | number)[][],
    headers = ["Bölge", "İlçe", "Eczane Adı", "Eczacı Adı Soyadı", "Telefon", "Adres", "Aktif"]
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

  // Runs an action that is expected to finish with a redirect; returns
  // the redirect path.
  async function expectRedirect(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof IntegrationRedirectSignal) return error.path;
      throw error;
    }
    throw new Error("expected a redirect");
  }

  async function previewAndGetBatchId(
    token: string,
    rows: (string | number)[][],
    headers?: string[]
  ): Promise<string> {
    setIntegrationTestSessionToken(token);
    const fd = new FormData();
    fd.set("file", await buildWorkbookFile(rows, headers));
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

  async function trackPharmaciesAndRegions(organizationId: string): Promise<void> {
    const regions = await prisma.region.findMany({
      where: { organizationId },
      select: { id: true },
    });
    for (const region of regions) {
      if (!tracked.regionIds.includes(region.id)) tracked.regionIds.push(region.id);
      const pharmacies = await prisma.pharmacy.findMany({
        where: { regionId: region.id },
        select: { id: true },
      });
      tracked.pharmacyIds.push(...pharmacies.map((p) => p.id));
    }
  }

  async function setupOrgAdmin() {
    const organization = await createTestOrganization(tracked);
    const admin = await createTestUser(tracked, { role: "ADMIN", organizationId: organization.id });
    const token = await createTestSessionToken(admin.id);
    tracked.organizationIds.push(organization.id);
    return { organization, admin, token };
  }

  it("creates approved new regions and their pharmacies together in one transaction, with audit records", async () => {
    const { organization, token } = await setupOrgAdmin();
    const run = testRunId();
    const regionA = `Yeni Bölge A ${run}`;
    const regionB = `Yeni Bölge B ${run}`;

    const batchId = await previewAndGetBatchId(token, [
      [regionA, "Merkez İlçe", "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "Bir Cad. 1", "Evet"],
      [regionA, "", "Şifa Eczanesi", "Zeynep Kaya", "0216 000 00 00", "", "Evet"],
      [regionB, "", "Umut Eczanesi", "Mehmet Demir", "0212 111 11 11", "", "Hayır"],
    ]);

    const candidates = await prisma.pharmacyImportRegionCandidate.findMany({
      where: { batchId },
      orderBy: { sourceValue: "asc" },
    });
    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => c.status === "NEW_REGION_CANDIDATE" && !c.approvedAt)).toBe(true);
    // The candidate seen with an explicit İlçe proposes it as district.
    expect(candidates.find((c) => c.sourceValue === regionA)?.proposedDistrict).toBe("Merkez İlçe");

    // Import is blocked before approval — nothing is written.
    await expectRedirect(importPharmacyBatchAction(batchId));
    expect(await prisma.region.count({ where: { organizationId: organization.id } })).toBe(0);
    expect(
      (await prisma.pharmacyImportBatch.findUniqueOrThrow({ where: { id: batchId } })).status
    ).toBe("PREVIEWED");

    for (const candidate of candidates) {
      await expectRedirect(approveRegionCandidateAction(candidate.id, new FormData()));
    }

    await expectRedirect(importPharmacyBatchAction(batchId));
    await trackPharmaciesAndRegions(organization.id);

    const regions = await prisma.region.findMany({
      where: { organizationId: organization.id },
      include: { pharmacies: true },
    });
    expect(regions).toHaveLength(2);
    const createdA = regions.find((r) => r.name === regionA)!;
    const createdB = regions.find((r) => r.name === regionB)!;
    expect(createdA.district).toBe("Merkez İlçe");
    expect(createdA.isActive).toBe(true);
    expect(createdA.pharmacies).toHaveLength(2);
    expect(createdB.pharmacies).toHaveLength(1);
    expect(createdB.pharmacies[0].isActive).toBe(false);

    // Pharmacy fields per the documented derivation rules.
    const deva = createdA.pharmacies.find((p) => p.name === "Deva Eczanesi")!;
    expect(deva.address).toBe("Bir Cad. 1");
    expect(deva.district).toBe("Merkez İlçe");
    expect(deva.city).toBe(organization.province);

    const batch = await prisma.pharmacyImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe("IMPORTED");
    expect(batch.consumedAt).not.toBeNull();

    const regionAudits = await prisma.auditLog.findMany({
      where: { organizationId: organization.id, entity: "Region", action: "CREATE" },
    });
    expect(regionAudits).toHaveLength(2);
    const batchAudits = await prisma.auditLog.findMany({
      where: { entity: "PharmacyImportBatch", entityId: batchId },
    });
    expect(batchAudits).toHaveLength(1);
  });

  it("a pharmacy-stage unique violation rolls back newly created regions and every pharmacy — zero partial state, no success AuditLog", async () => {
    const { organization, token } = await setupOrgAdmin();
    const existingRegion = await createTestRegion(tracked, { organizationId: organization.id });
    const run = testRunId();
    const newRegionName = `Yepyeni Bölge ${run}`;

    const batchId = await previewAndGetBatchId(token, [
      [newRegionName, "", "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "", "Evet"],
      [existingRegion.name, "", "Çakışan Eczanesi", "Zeynep Kaya", "0216 000 00 00", "", "Evet"],
    ]);
    const candidate = await prisma.pharmacyImportRegionCandidate.findFirstOrThrow({
      where: { batchId, normalizedSourceValue: normalizeText(newRegionName) },
    });
    await expectRedirect(approveRegionCandidateAction(candidate.id, new FormData()));

    // Between preview and import, the colliding pharmacy appears (e.g. a
    // manual create) — the import's pharmacy insert must hit the DB
    // unique constraint and roll EVERYTHING back, including the region
    // created earlier in the same transaction.
    await createTestPharmacy(tracked, existingRegion.id, { name: "Çakışan Eczanesi" });

    const path = await expectRedirect(importPharmacyBatchAction(batchId));
    expect(path).toContain("error=");

    expect(
      await prisma.region.count({
        where: { organizationId: organization.id, name: newRegionName },
      })
    ).toBe(0);
    expect(await prisma.pharmacy.count({ where: { name: "Deva Eczanesi", region: { organizationId: organization.id } } })).toBe(0);
    const batch = await prisma.pharmacyImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe("PREVIEWED");
    expect(batch.consumedAt).toBeNull();
    expect(
      await prisma.auditLog.count({ where: { entity: "PharmacyImportBatch", entityId: batchId } })
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: organization.id, entity: "Region", action: "CREATE" },
      })
    ).toBe(0);
  });

  it("an inactive matched region stays inactive with the keep-inactive decision; pharmacies import into it", async () => {
    const { organization, token } = await setupOrgAdmin();
    const inactiveRegion = await createTestRegion(tracked, { organizationId: organization.id });
    await prisma.region.update({ where: { id: inactiveRegion.id }, data: { isActive: false } });

    const batchId = await previewAndGetBatchId(token, [
      [inactiveRegion.name, "", "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "", "Evet"],
    ]);
    const candidate = await prisma.pharmacyImportRegionCandidate.findFirstOrThrow({
      where: { batchId },
    });
    expect(candidate.status).toBe("MATCHED_EXISTING_INACTIVE");

    // Blocked until the explicit decision.
    await expectRedirect(importPharmacyBatchAction(batchId));
    expect(await prisma.pharmacy.count({ where: { regionId: inactiveRegion.id } })).toBe(0);

    const keepForm = new FormData();
    keepForm.set("mode", "keep-inactive");
    await expectRedirect(approveRegionCandidateAction(candidate.id, keepForm));
    await expectRedirect(importPharmacyBatchAction(batchId));
    await trackPharmaciesAndRegions(organization.id);

    const region = await prisma.region.findUniqueOrThrow({ where: { id: inactiveRegion.id } });
    expect(region.isActive).toBe(false); // NEVER silently reactivated
    expect(await prisma.pharmacy.count({ where: { regionId: inactiveRegion.id } })).toBe(1);
  });

  it("the explicit reactivate decision reactivates the region inside the import transaction, audited", async () => {
    const { organization, token } = await setupOrgAdmin();
    const inactiveRegion = await createTestRegion(tracked, { organizationId: organization.id });
    await prisma.region.update({ where: { id: inactiveRegion.id }, data: { isActive: false } });

    const batchId = await previewAndGetBatchId(token, [
      [inactiveRegion.name, "", "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "", "Evet"],
    ]);
    const candidate = await prisma.pharmacyImportRegionCandidate.findFirstOrThrow({
      where: { batchId },
    });
    const reactivateForm = new FormData();
    reactivateForm.set("mode", "reactivate");
    await expectRedirect(approveRegionCandidateAction(candidate.id, reactivateForm));
    await expectRedirect(importPharmacyBatchAction(batchId));
    await trackPharmaciesAndRegions(organization.id);

    const region = await prisma.region.findUniqueOrThrow({ where: { id: inactiveRegion.id } });
    expect(region.isActive).toBe(true);
    const reactivationAudit = await prisma.auditLog.findMany({
      where: { entity: "Region", entityId: inactiveRegion.id, action: "UPDATE" },
    });
    expect(reactivationAudit.length).toBeGreaterThanOrEqual(1);
  });

  it("two concurrent imports approving the same new region name produce exactly one Region row", async () => {
    const { organization, token } = await setupOrgAdmin();
    const run = testRunId();
    const regionName = `Yarış Bölgesi ${run}`;

    const batchId1 = await previewAndGetBatchId(token, [
      [regionName, "", "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "", "Evet"],
    ]);
    const batchId2 = await previewAndGetBatchId(token, [
      [regionName, "", "Şifa Eczanesi", "Zeynep Kaya", "0216 000 00 00", "", "Evet"],
    ]);
    for (const batchId of [batchId1, batchId2]) {
      const candidate = await prisma.pharmacyImportRegionCandidate.findFirstOrThrow({
        where: { batchId },
      });
      await expectRedirect(approveRegionCandidateAction(candidate.id, new FormData()));
    }

    setIntegrationTestSessionToken(token);
    const [first, second] = await raceThroughGate(
      () => expectRedirect(importPharmacyBatchAction(batchId1)),
      () => expectRedirect(importPharmacyBatchAction(batchId2))
    );
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    await trackPharmaciesAndRegions(organization.id);

    // The DB unique constraint is the final authority: exactly one
    // logical region regardless of which import won.
    expect(
      await prisma.region.count({ where: { organizationId: organization.id, name: regionName } })
    ).toBe(1);

    // At least one batch imported; a rolled-back loser stays PREVIEWED
    // and can be retried safely, now matching the existing region.
    const batches = await prisma.pharmacyImportBatch.findMany({
      where: { id: { in: [batchId1, batchId2] } },
    });
    const importedCount = batches.filter((b) => b.status === "IMPORTED").length;
    expect(importedCount).toBeGreaterThanOrEqual(1);
    const loser = batches.find((b) => b.status === "PREVIEWED");
    if (loser) {
      await expectRedirect(importPharmacyBatchAction(loser.id));
      await trackPharmaciesAndRegions(organization.id);
      expect(
        await prisma.region.count({ where: { organizationId: organization.id, name: regionName } })
      ).toBe(1); // retry reused the existing region, no duplicate
    }
    expect(
      await prisma.pharmacy.count({ where: { region: { organizationId: organization.id } } })
    ).toBe(2);
  });

  it("two organizations importing the identical new region name each get their own region", async () => {
    const orgA = await setupOrgAdmin();
    const orgB = await setupOrgAdmin();
    const run = testRunId();
    const regionName = `Ortak Bölge ${run}`;

    for (const { token, organization } of [orgA, orgB]) {
      const batchId = await previewAndGetBatchId(token, [
        [regionName, "", "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "", "Evet"],
      ]);
      const candidate = await prisma.pharmacyImportRegionCandidate.findFirstOrThrow({
        where: { batchId },
      });
      await expectRedirect(approveRegionCandidateAction(candidate.id, new FormData()));
      await expectRedirect(importPharmacyBatchAction(batchId));
      await trackPharmaciesAndRegions(organization.id);
    }

    expect(
      await prisma.region.count({ where: { organizationId: orgA.organization.id, name: regionName } })
    ).toBe(1);
    expect(
      await prisma.region.count({ where: { organizationId: orgB.organization.id, name: regionName } })
    ).toBe(1);
  });

  it("another organization's ADMIN can neither view nor mutate a foreign candidate", async () => {
    const orgA = await setupOrgAdmin();
    const orgB = await setupOrgAdmin();
    const run = testRunId();

    const batchId = await previewAndGetBatchId(orgA.token, [
      [`Gizli Bölge ${run}`, "", "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "", "Evet"],
    ]);
    const candidate = await prisma.pharmacyImportRegionCandidate.findFirstOrThrow({
      where: { batchId },
    });

    setIntegrationTestSessionToken(orgB.token);
    const path = await expectRedirect(approveRegionCandidateAction(candidate.id, new FormData()));
    expect(path).toContain("error=");

    const untouched = await prisma.pharmacyImportRegionCandidate.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    expect(untouched.approvedAt).toBeNull();
    expect(untouched.status).toBe("NEW_REGION_CANDIDATE");
  });

  it("a manual preview candidate maps multiple unresolved rows and imports as one region", async () => {
    const { organization, token } = await setupOrgAdmin();
    const run = testRunId();

    // Rows with an empty Bölge column and no İlçe/Adres → unresolved.
    const batchId = await previewAndGetBatchId(token, [
      ["", "", "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "", "Evet"],
      ["", "", "Şifa Eczanesi", "Zeynep Kaya", "0216 000 00 00", "", "Evet"],
    ]);
    expect(await prisma.pharmacyImportRegionCandidate.count({ where: { batchId } })).toBe(0);

    setIntegrationTestSessionToken(token);
    const manualForm = new FormData();
    manualForm.set("proposedName", `Manuel Bölge ${run}`);
    manualForm.set("proposedCity", "Test İli");
    manualForm.set("proposedDistrict", "Test İlçesi");
    manualForm.set("proposedIsActive", "on");
    await expectRedirect(createManualRegionCandidateAction(batchId, manualForm));

    const manual = await prisma.pharmacyImportRegionCandidate.findFirstOrThrow({
      where: { batchId, sourceType: "MANUAL" },
    });
    expect(manual.approvedAt).not.toBeNull();

    const rows = await prisma.pharmacyImportRow.findMany({ where: { batchId } });
    for (const row of rows) {
      const assignForm = new FormData();
      assignForm.set("candidateId", manual.id);
      await expectRedirect(assignRowToCandidateAction(row.id, assignForm));
    }

    await expectRedirect(importPharmacyBatchAction(batchId));
    await trackPharmaciesAndRegions(organization.id);

    const region = await prisma.region.findFirstOrThrow({
      where: { organizationId: organization.id, name: `Manuel Bölge ${run}` },
      include: { pharmacies: true },
    });
    expect(region.district).toBe("Test İlçesi");
    expect(region.pharmacies).toHaveLength(2);
    // The ADMIN-approved preview city is used for the new region's rows.
    expect(region.pharmacies.every((p) => p.city === "Test İli")).toBe(true);
  });

  it("an address-derived suggestion must be confirmed: rejected → unresolved; accepted → imports", async () => {
    const { organization, token } = await setupOrgAdmin();
    const run = testRunId();
    const districtName = "Adresköyü";

    const batchId = await previewAndGetBatchId(token, [
      ["", "", "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", `Gül Mah. Sok. 3, ${districtName} / Bilinmezİl`, "Evet"],
    ]);
    const candidate = await prisma.pharmacyImportRegionCandidate.findFirstOrThrow({
      where: { batchId },
    });
    expect(candidate.status).toBe("ADDRESS_SUGGESTION");
    expect(candidate.sourceType).toBe("ADDRESS_SUGGESTION");

    // Import blocked while the suggestion is unconfirmed.
    await expectRedirect(importPharmacyBatchAction(batchId));
    expect(await prisma.region.count({ where: { organizationId: organization.id } })).toBe(0);

    // Reject → UNRESOLVED (still blocked, still no region).
    setIntegrationTestSessionToken(token);
    const rejectForm = new FormData();
    rejectForm.set("mode", "reject-suggestion");
    await expectRedirect(resetRegionCandidateAction(candidate.id, rejectForm));
    expect(
      (await prisma.pharmacyImportRegionCandidate.findUniqueOrThrow({ where: { id: candidate.id } }))
        .status
    ).toBe("UNRESOLVED");

    // Approve it as a new region after all (UNRESOLVED → approved).
    await expectRedirect(approveRegionCandidateAction(candidate.id, new FormData()));
    await expectRedirect(importPharmacyBatchAction(batchId));
    await trackPharmaciesAndRegions(organization.id);

    expect(
      await prisma.region.count({
        where: { organizationId: organization.id, name: districtName },
      })
    ).toBe(1);
  });

  it("editing a candidate's proposed fields is honored by the final import", async () => {
    const { organization, token } = await setupOrgAdmin();
    const run = testRunId();

    const batchId = await previewAndGetBatchId(token, [
      [`Ham Değer ${run}`, "", "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "", "Evet"],
    ]);
    const candidate = await prisma.pharmacyImportRegionCandidate.findFirstOrThrow({
      where: { batchId },
    });

    setIntegrationTestSessionToken(token);
    const editForm = new FormData();
    editForm.set("proposedName", `Düzenlenmiş Bölge ${run}`);
    editForm.set("proposedCity", "Yeni İl");
    editForm.set("proposedDistrict", "Yeni İlçe");
    // no proposedIsActive → created as INACTIVE new region
    await expectRedirect(updateRegionCandidateAction(candidate.id, editForm));
    await expectRedirect(approveRegionCandidateAction(candidate.id, new FormData()));
    await expectRedirect(importPharmacyBatchAction(batchId));
    await trackPharmaciesAndRegions(organization.id);

    const region = await prisma.region.findFirstOrThrow({
      where: { organizationId: organization.id, name: `Düzenlenmiş Bölge ${run}` },
      include: { pharmacies: true },
    });
    expect(region.district).toBe("Yeni İlçe");
    expect(region.isActive).toBe(false); // approved as a new INACTIVE region
    expect(region.pharmacies).toHaveLength(1);
  });

  it("a region created manually while the preview is open is reused, not duplicated", async () => {
    const { organization, token } = await setupOrgAdmin();
    const run = testRunId();
    const regionName = `Sonradan Gelen ${run}`;

    const batchId = await previewAndGetBatchId(token, [
      [regionName, "", "Deva Eczanesi", "Ada Yılmaz", "0212 212 19 18", "", "Evet"],
    ]);
    const candidate = await prisma.pharmacyImportRegionCandidate.findFirstOrThrow({
      where: { batchId },
    });
    await expectRedirect(approveRegionCandidateAction(candidate.id, new FormData()));

    // The region appears via the ordinary fixture path (as if another
    // window created it manually) between approval and import.
    const manualRegion = await createTestRegion(tracked, {
      organizationId: organization.id,
      name: regionName,
    });

    await expectRedirect(importPharmacyBatchAction(batchId));
    await trackPharmaciesAndRegions(organization.id);

    expect(
      await prisma.region.count({ where: { organizationId: organization.id, name: regionName } })
    ).toBe(1);
    expect(await prisma.pharmacy.count({ where: { regionId: manualRegion.id } })).toBe(1);
  });

  it("manual region CRUD (create, activate/passivate) still works through the real bolgeler actions", async () => {
    const { organization, token } = await setupOrgAdmin();
    const run = testRunId();
    setIntegrationTestSessionToken(token);

    const fd = new FormData();
    fd.set("name", `Elle Bölge ${run}`);
    fd.set("district", "Elle İlçe");
    fd.set("dailyDutyCount", "1");
    fd.set("isActive", "on");
    await expectRedirect(createRegionAction({ success: false, message: "" }, fd));

    const region = await prisma.region.findFirstOrThrow({
      where: { organizationId: organization.id, name: `Elle Bölge ${run}` },
    });
    tracked.regionIds.push(region.id);
    expect(region.isActive).toBe(true);

    await expectRedirect(setRegionStatusAction(region.id, false));
    expect(
      (await prisma.region.findUniqueOrThrow({ where: { id: region.id } })).isActive
    ).toBe(false);

    await expectRedirect(setRegionStatusAction(region.id, true));
    expect(
      (await prisma.region.findUniqueOrThrow({ where: { id: region.id } })).isActive
    ).toBe(true);
  });
});
