import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createPublicDutyRequestAction } from "@/app/eczane-talep/[token]/actions";
import { reviewDutyRequestAction } from "@/app/(dashboard)/nobet-talepleri/actions";
import { initialActionState } from "@/lib/action-state";
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

function publicRequestFormData(): FormData {
  const fd = new FormData();
  fd.set("requestType", "CANNOT_DUTY");
  fd.set("startDate", "2027-03-10");
  fd.set("endDate", "2027-03-11");
  fd.set("explanation", "Aynı anda gönderilen eşzamanlı test talebi.");
  return fd;
}

describe("concurrent public duty-request dedup (real Postgres)", () => {
  const tracked = newTrackedIds();

  afterEach(async () => {
    setIntegrationTestSessionToken(undefined);
    await cleanupTrackedIds(tracked);
  });

  it("allows exactly one DutyRequest row when the same request is submitted concurrently twice", async () => {
    const region = await createTestRegion(tracked);
    const pharmacy = await createTestPharmacy(tracked, region.id);
    const token = pharmacy.requestToken!;

    const [r1, r2] = await raceThroughGate(
      () => createPublicDutyRequestAction(token, initialActionState, publicRequestFormData()),
      () => createPublicDutyRequestAction(token, initialActionState, publicRequestFormData())
    );

    expect(r1.status).toBe("fulfilled");
    expect(r2.status).toBe("fulfilled");
    const results = [
      r1.status === "fulfilled" ? r1.value : null,
      r2.status === "fulfilled" ? r2.value : null,
    ];

    // Both calls must return a friendly success/idempotent result — no raw
    // Prisma error is ever allowed to escape to the caller.
    for (const result of results) {
      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
    }

    const requests = await prisma.dutyRequest.findMany({
      where: { pharmacyId: pharmacy.id },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].pharmacyId).toBe(pharmacy.id);
    expect(requests[0].regionId).toBe(region.id);
    expect(requests[0].status).toBe("PENDING");
    expect(requests[0].dedupKey).not.toBeNull();

    // Exactly one of the two responses should carry the "already received"
    // duplicate wording; the other the first-time success wording. Order is
    // not guaranteed under real concurrency, so just assert both variants
    // are represented across the two results.
    const messages = results.map((r) => r!.message);
    const hasFreshSuccess = messages.some((m) => m.includes("incelemesine gönderildi"));
    const hasDuplicateNotice = messages.some((m) => m.includes("daha önce alınmış"));
    expect(hasFreshSuccess).toBe(true);
    expect(hasDuplicateNotice).toBe(true);
  });

  it("allows a new submission after the prior request is closed and clears dedupKey", async () => {
    const region = await createTestRegion(tracked);
    const pharmacy = await createTestPharmacy(tracked, region.id);
    const requestToken = pharmacy.requestToken!;
    const admin = await createTestUser(tracked, {
      role: "ADMIN",
      organizationId: region.organizationId,
    });
    const sessionToken = await createTestSessionToken(admin.id);

    const first = await createPublicDutyRequestAction(
      requestToken,
      initialActionState,
      publicRequestFormData()
    );
    expect(first.success).toBe(true);

    const created = await prisma.dutyRequest.findFirstOrThrow({
      where: { pharmacyId: pharmacy.id },
    });
    expect(created.dedupKey).not.toBeNull();

    setIntegrationTestSessionToken(sessionToken);
    const reviewFormData = new FormData();
    reviewFormData.set("decision", "APPROVED");
    reviewFormData.set("reviewNote", "");

    let redirected: IntegrationRedirectSignal | null = null;
    try {
      await reviewDutyRequestAction(created.id, initialActionState, reviewFormData);
    } catch (error) {
      if (error instanceof IntegrationRedirectSignal) {
        redirected = error;
      } else {
        throw error;
      }
    }
    expect(redirected).not.toBeNull();

    const closed = await prisma.dutyRequest.findUniqueOrThrow({ where: { id: created.id } });
    expect(closed.status).toBe("APPROVED");
    expect(closed.dedupKey).toBeNull();

    const second = await createPublicDutyRequestAction(
      requestToken,
      initialActionState,
      publicRequestFormData()
    );
    expect(second.success).toBe(true);
    expect(second.message).toContain("incelemesine gönderildi");

    const allRequests = await prisma.dutyRequest.findMany({
      where: { pharmacyId: pharmacy.id },
      orderBy: { createdAt: "asc" },
    });
    expect(allRequests).toHaveLength(2);
    expect(allRequests[0].id).toBe(created.id);
    expect(allRequests[0].status).toBe("APPROVED");
    expect(allRequests[1].status).toBe("PENDING");
    expect(allRequests[1].dedupKey).not.toBeNull();
  });
});
