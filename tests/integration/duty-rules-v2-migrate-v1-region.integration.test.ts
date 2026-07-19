// Duty Rules V2 — Phase 15: migrateV1RegionToV2, against a real Postgres
// database. Proves the one-click migration produces a genuinely usable,
// ACTIVE V2 plan version — and that the resulting configuration
// regenerates the exact same shape of schedule V1 already produces
// (dailyDutyCount pharmacies every day, weights carried over) — not just
// that rows exist.

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { migrateV1RegionToV2 } from "@/lib/duty-rules-v2/migration/migrate-v1-region-to-v2";
import { assembleV1CompatibilityEngineInput } from "@/lib/duty-rules-v2/ui/assemble-v1-compatibility-engine-input";
import { buildDutyEngineContext } from "@/lib/duty-rules-v2/engine/build-engine-context";
import { loadDutyPlanVersion } from "@/lib/duty-rules-v2/load-duty-plan-version";

import {
  createTestOrganization,
  createTestPharmacy,
  createTestRegion,
  createTestUser,
  createTestDutyRule,
  cleanupTrackedIds,
  newTrackedIds,
  testRunId,
} from "./helpers/fixtures";

describe("Duty Rules V2 Phase 15 — migrateV1RegionToV2 (real Postgres)", () => {
  const tracked = newTrackedIds();
  const cleanupIds = { planIds: [] as string[], poolIds: [] as string[] };

  afterEach(async () => {
    if (cleanupIds.planIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { entity: "DutyPlan", entityId: { in: cleanupIds.planIds } } });
      await prisma.auditLog.deleteMany({ where: { entity: "DutyPlanVersion" } }).catch(() => {});
      await prisma.dutyPlan.deleteMany({ where: { id: { in: cleanupIds.planIds } } });
      cleanupIds.planIds.length = 0;
    }
    if (cleanupIds.poolIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { entity: "RotationPool", entityId: { in: cleanupIds.poolIds } } });
      await prisma.rotationPool.deleteMany({ where: { id: { in: cleanupIds.poolIds } } });
      cleanupIds.poolIds.length = 0;
    }
    await cleanupTrackedIds(tracked);
  });

  it("migrates a real V1 region and immediately activates it", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id, dailyDutyCount: 2 });
    const user = await createTestUser(tracked, { organizationId: organization.id, role: "ADMIN" });
    await createTestDutyRule(region.id);
    const active = [
      await createTestPharmacy(tracked, region.id),
      await createTestPharmacy(tracked, region.id),
      await createTestPharmacy(tracked, region.id),
    ];
    await createTestPharmacy(tracked, region.id, { isActive: false });

    const result = await migrateV1RegionToV2({ organizationId: organization.id, regionId: region.id, userId: user.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    cleanupIds.planIds.push(result.planId);
    cleanupIds.poolIds.push(result.poolId);

    expect(result.activated).toBe(true);
    expect(result.memberCount).toBe(active.length);

    const version = await prisma.dutyPlanVersion.findUniqueOrThrow({
      where: { id: result.versionId },
      include: { dayTypeRules: true },
    });
    expect(version.status).toBe("ACTIVE");
    // Left null on purpose — cizelgeler/v2/yeni's mode-selection keeps
    // deriving policy from the live DutyRule (V1-compatibility mode).
    expect(version.minDaysBetweenDuties).toBeNull();

    const weightByDayType = new Map(version.dayTypeRules.map((r) => [r.dayType, r.weight]));
    expect(weightByDayType.get("WEEKDAY")).toBe(1);
    expect(weightByDayType.get("SATURDAY")).toBe(1.25);
    expect(weightByDayType.get("SUNDAY")).toBe(1.5);
    expect(weightByDayType.get("OFFICIAL_HOLIDAY")).toBe(2);
    expect(weightByDayType.get("RELIGIOUS_HOLIDAY")).toBe(2);
    expect(weightByDayType.get("HOLIDAY_EVE")).toBeNull();
    expect(version.dayTypeRules.every((r) => r.isServed)).toBe(true);

    const loaded = await loadDutyPlanVersion({
      organizationId: organization.id,
      regionId: region.id,
      planVersionId: result.versionId,
    });
    expect(loaded.status).toBe("ACTIVE");

    const assembled = await assembleV1CompatibilityEngineInput({
      organizationId: organization.id,
      regionId: region.id,
      periodStart: "2031-09-01",
      periodEnd: "2031-09-14",
    });
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;

    const engineResult = buildDutyEngineContext(assembled.input);
    expect(engineResult.completeDraftSchedule.status).toBe("COMPLETE");
    const byDate = new Map<string, number>();
    for (const a of engineResult.completeDraftSchedule.assignments) {
      byDate.set(a.date, (byDate.get(a.date) ?? 0) + 1);
    }
    expect(byDate.size).toBe(14);
    for (const count of byDate.values()) {
      expect(count).toBe(region.dailyDutyCount);
    }
  });

  it("rejects a region with no V1 DutyRule", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const user = await createTestUser(tracked, { organizationId: organization.id, role: "ADMIN" });

    const result = await migrateV1RegionToV2({ organizationId: organization.id, regionId: region.id, userId: user.id });
    expect(result).toMatchObject({ ok: false, code: "NO_DUTY_RULE" });

    const planCount = await prisma.dutyPlan.count({ where: { regionId: region.id } });
    expect(planCount).toBe(0);
  });

  it("rejects a foreign region (cross-tenant, non-disclosing)", async () => {
    const organizationA = await createTestOrganization(tracked);
    const organizationB = await createTestOrganization(tracked);
    const regionB = await createTestRegion(tracked, { organizationId: organizationB.id });
    const userA = await createTestUser(tracked, { organizationId: organizationA.id, role: "ADMIN" });
    await createTestDutyRule(regionB.id);

    const result = await migrateV1RegionToV2({ organizationId: organizationA.id, regionId: regionB.id, userId: userA.id });
    expect(result).toMatchObject({ ok: false, code: "REGION_NOT_FOUND" });
  });

  it("refuses to duplicate an existing plan instead of creating a second one", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const user = await createTestUser(tracked, { organizationId: organization.id, role: "ADMIN" });
    await createTestDutyRule(region.id);
    await createTestPharmacy(tracked, region.id);

    const first = await migrateV1RegionToV2({ organizationId: organization.id, regionId: region.id, userId: user.id });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    cleanupIds.planIds.push(first.planId);
    cleanupIds.poolIds.push(first.poolId);

    const second = await migrateV1RegionToV2({ organizationId: organization.id, regionId: region.id, userId: user.id });
    expect(second).toMatchObject({ ok: false, code: "ALREADY_HAS_PLAN" });

    const planCount = await prisma.dutyPlan.count({ where: { regionId: region.id } });
    expect(planCount).toBe(1);
  });

  it("creates the plan but leaves it unactivated when the region itself is inactive", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id, name: `Pasif Bölge ${testRunId()}` });
    const user = await createTestUser(tracked, { organizationId: organization.id, role: "ADMIN" });
    await createTestDutyRule(region.id);
    await createTestPharmacy(tracked, region.id);
    await prisma.region.update({ where: { id: region.id }, data: { isActive: false } });

    const result = await migrateV1RegionToV2({ organizationId: organization.id, regionId: region.id, userId: user.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    cleanupIds.planIds.push(result.planId);
    cleanupIds.poolIds.push(result.poolId);

    expect(result.activated).toBe(false);
    expect(result.activationBlockingIssues.some((i) => i.code === "REGION_INACTIVE")).toBe(true);

    const version = await prisma.dutyPlanVersion.findUniqueOrThrow({ where: { id: result.versionId } });
    expect(version.status).toBe("DRAFT");
  });
});
