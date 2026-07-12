import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { historicalImportAction } from "@/app/(dashboard)/gecmis-nobetler/actions";
import { getOpeningBalanceByPharmacy } from "@/lib/balance/duty-balance";
import { IntegrationRedirectSignal, setIntegrationTestSessionToken } from "./helpers/setup";
import { raceThroughGate } from "./helpers/gate";
import {
  createTestPharmacy,
  createTestRegion,
  createTestSessionToken,
  createTestUser,
  cleanupTrackedIds,
  newTrackedIds,
} from "./helpers/fixtures";

describe("concurrent historical-import fingerprint dedup (real Postgres)", () => {
  const tracked = newTrackedIds();

  afterEach(async () => {
    setIntegrationTestSessionToken(undefined);
    await cleanupTrackedIds(tracked);
  });

  it("creates exactly one batch + record set when the same import is submitted concurrently twice", async () => {
    const region = await createTestRegion(tracked);
    const pharmacy = await createTestPharmacy(tracked, region.id);
    const admin = await createTestUser(tracked, {
      role: "ADMIN",
      organizationId: region.organizationId,
    });
    const token = await createTestSessionToken(admin.id);
    setIntegrationTestSessionToken(token);

    const rawRows = [
      {
        rowNumber: 1,
        tarih: "10.03.2027",
        bolge: region.name,
        eczaneAdi: pharmacy.name,
        nobetTuru: "Normal",
        telefon: "0000000000",
        adres: "Test Adres",
        not: "",
      },
    ];

    function importFormData(): FormData {
      const fd = new FormData();
      fd.set("mode", "import");
      fd.set("rawRows", JSON.stringify(rawRows));
      fd.set("fileName", "gecmis-nobetler-test.xlsx");
      return fd;
    }

    async function runImport() {
      try {
        const result = await historicalImportAction(
          { success: false, message: "" },
          importFormData()
        );
        return { redirected: false as const, result };
      } catch (error) {
        if (error instanceof IntegrationRedirectSignal) {
          return { redirected: true as const, result: null };
        }
        throw error;
      }
    }

    const [r1, r2] = await raceThroughGate(runImport, runImport);

    expect(r1.status).toBe("fulfilled");
    expect(r2.status).toBe("fulfilled");
    const outcomes = [
      r1.status === "fulfilled" ? r1.value : null,
      r2.status === "fulfilled" ? r2.value : null,
    ];

    const batches = await prisma.historicalDutyImportBatch.findMany({
      where: { importedById: admin.id },
    });
    tracked.historicalBatchIds.push(...batches.map((b) => b.id));

    expect(batches).toHaveLength(1);
    expect(batches[0].fingerprint).not.toBeNull();

    const records = await prisma.historicalDutyRecord.findMany({
      where: { batchId: batches[0].id },
    });
    expect(records).toHaveLength(1);
    expect(records[0].pharmacyId).toBe(pharmacy.id);
    expect(records[0].regionId).toBe(region.id);

    // Exactly one winner (redirected = real success) and one loser (the
    // friendly duplicate-import message), never a raw Prisma error and
    // never two winners.
    const winners = outcomes.filter((o) => o !== null && o.redirected).length;
    const losers = outcomes.filter(
      (o) => o !== null && !o.redirected && o.result?.message === "Bu geçmiş nöbet aktarımı daha önce içeri alınmış."
    ).length;
    expect(winners).toBe(1);
    expect(losers).toBe(1);

    const auditLogs = await prisma.auditLog.findMany({
      where: { entity: "HistoricalDutyImportBatch", entityId: batches[0].id },
    });
    expect(auditLogs).toHaveLength(1);

    // The duty-balance aggregation sums HistoricalDutyRecord.weight — if a
    // second (duplicate) batch/record set had been written, this would be
    // double-counted. With exactly one record of weight 1 (weekday
    // "Normal"), the opening balance for this pharmacy must be exactly 1.
    const balance = await getOpeningBalanceByPharmacy(region.id);
    expect(balance.get(pharmacy.id)).toBe(1);
  });
});
