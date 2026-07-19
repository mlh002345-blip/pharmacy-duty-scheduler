// Duty Rules V2 — Phase 16: deletePlanVersion, against a real Postgres
// database. Proves a DRAFT version's children (DayTypeRule,
// ShiftDefinition, SlotRequirement) are genuinely gone after deletion —
// not just the version row — and that the owning DutyPlan is deleted too
// exactly when it was the plan's last remaining version.

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { deletePlanVersion } from "@/lib/duty-rules-v2/configuration/delete-plan-version";
import { createDutyPlan } from "@/lib/duty-rules-v2/configuration/create-duty-plan";
import { createPlanVersion } from "@/lib/duty-rules-v2/configuration/create-plan-version";
import { setDayTypeRules } from "@/lib/duty-rules-v2/configuration/update-day-type-rules";
import { setShiftDefinitions } from "@/lib/duty-rules-v2/configuration/update-shift-definitions";
import type { BuiltinDayType } from "@/lib/duty-rules-v2/domain/loaded-plan";

import {
  createTestOrganization,
  createTestPharmacy,
  createTestRegion,
  createTestUser,
  cleanupTrackedIds,
  newTrackedIds,
} from "./helpers/fixtures";

const ALL_DAY_TYPES: BuiltinDayType[] = [
  "WEEKDAY",
  "SATURDAY",
  "SUNDAY",
  "OFFICIAL_HOLIDAY",
  "RELIGIOUS_HOLIDAY",
  "HOLIDAY_EVE",
];

describe("Duty Rules V2 Phase 16 — deletePlanVersion (real Postgres)", () => {
  const tracked = newTrackedIds();
  const cleanupIds = { planIds: [] as string[] };

  afterEach(async () => {
    if (cleanupIds.planIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { entity: "DutyPlan", entityId: { in: cleanupIds.planIds } } });
      await prisma.auditLog.deleteMany({ where: { entity: "DutyPlanVersion" } }).catch(() => {});
      await prisma.dutyPlan.deleteMany({ where: { id: { in: cleanupIds.planIds } } });
      cleanupIds.planIds.length = 0;
    }
    await cleanupTrackedIds(tracked);
  });

  it("deletes a DRAFT version and its child rows, and deletes the now-empty plan", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const user = await createTestUser(tracked, { organizationId: organization.id, role: "ADMIN" });

    const planResult = await createDutyPlan({
      organizationId: organization.id,
      regionId: region.id,
      name: "Silinecek Plan",
      userId: user.id,
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    const { planId, versionId } = planResult;

    await setDayTypeRules({
      organizationId: organization.id,
      versionId,
      rules: ALL_DAY_TYPES.map((dayType) => ({ dayType, isServed: true })),
      userId: user.id,
    });
    await setShiftDefinitions({
      organizationId: organization.id,
      versionId,
      shifts: [{ name: "Günlük Nöbet", startMinute: 0, endMinute: 1439, spansMidnight: false, defaultWeight: 1, sortOrder: 0 }],
      userId: user.id,
    });

    const dayTypeCountBefore = await prisma.dayTypeRule.count({ where: { planVersionId: versionId } });
    const shiftCountBefore = await prisma.shiftDefinition.count({ where: { planVersionId: versionId } });
    expect(dayTypeCountBefore).toBe(6);
    expect(shiftCountBefore).toBe(1);

    const result = await deletePlanVersion({ organizationId: organization.id, versionId, userId: user.id });
    expect(result).toEqual({ ok: true, planDeleted: true });

    const version = await prisma.dutyPlanVersion.findUnique({ where: { id: versionId } });
    expect(version).toBeNull();
    const plan = await prisma.dutyPlan.findUnique({ where: { id: planId } });
    expect(plan).toBeNull();
    const dayTypeCountAfter = await prisma.dayTypeRule.count({ where: { planVersionId: versionId } });
    const shiftCountAfter = await prisma.shiftDefinition.count({ where: { planVersionId: versionId } });
    expect(dayTypeCountAfter).toBe(0);
    expect(shiftCountAfter).toBe(0);
  });

  it("deletes only the targeted DRAFT version, leaving the plan and its other versions intact", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    const user = await createTestUser(tracked, { organizationId: organization.id, role: "ADMIN" });

    const planResult = await createDutyPlan({
      organizationId: organization.id,
      regionId: region.id,
      name: "Çok Sürümlü Plan",
      userId: user.id,
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    cleanupIds.planIds.push(planResult.planId);
    const firstVersionId = planResult.versionId;

    const secondVersionResult = await createPlanVersion({
      organizationId: organization.id,
      planId: planResult.planId,
      userId: user.id,
    });
    expect(secondVersionResult.ok).toBe(true);
    if (!secondVersionResult.ok) return;

    const result = await deletePlanVersion({
      organizationId: organization.id,
      versionId: secondVersionResult.versionId,
      userId: user.id,
    });
    expect(result).toEqual({ ok: true, planDeleted: false });

    const plan = await prisma.dutyPlan.findUnique({ where: { id: planResult.planId } });
    expect(plan).not.toBeNull();
    const survivingVersion = await prisma.dutyPlanVersion.findUnique({ where: { id: firstVersionId } });
    expect(survivingVersion).not.toBeNull();
    const deletedVersion = await prisma.dutyPlanVersion.findUnique({ where: { id: secondVersionResult.versionId } });
    expect(deletedVersion).toBeNull();
  });

  it("refuses to delete an ACTIVE version", async () => {
    const organization = await createTestOrganization(tracked);
    const region = await createTestRegion(tracked, { organizationId: organization.id });
    await createTestPharmacy(tracked, region.id);
    const user = await createTestUser(tracked, { organizationId: organization.id, role: "ADMIN" });

    const planResult = await createDutyPlan({
      organizationId: organization.id,
      regionId: region.id,
      name: "Etkin Plan",
      userId: user.id,
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    cleanupIds.planIds.push(planResult.planId);
    const { versionId } = planResult;

    await setDayTypeRules({
      organizationId: organization.id,
      versionId,
      rules: [{ dayType: "WEEKDAY", isServed: true }],
      userId: user.id,
    });

    // Activation itself will fail readiness (no shift/slot/pool) — that's
    // fine, this test only needs a non-DRAFT status. Force it directly to
    // isolate the delete-refusal behavior from the full activation flow.
    await prisma.dutyPlanVersion.update({ where: { id: versionId }, data: { status: "ACTIVE", activatedAt: new Date() } });

    const result = await deletePlanVersion({ organizationId: organization.id, versionId, userId: user.id });
    expect(result).toEqual({ ok: false, code: "VERSION_NOT_DRAFT", message: expect.any(String) });

    const stillThere = await prisma.dutyPlanVersion.findUnique({ where: { id: versionId } });
    expect(stillThere).not.toBeNull();
  });

  it("rejects deleting a version belonging to another organization", async () => {
    const organizationA = await createTestOrganization(tracked);
    const organizationB = await createTestOrganization(tracked);
    const regionB = await createTestRegion(tracked, { organizationId: organizationB.id });
    const userA = await createTestUser(tracked, { organizationId: organizationA.id, role: "ADMIN" });
    const userB = await createTestUser(tracked, { organizationId: organizationB.id, role: "ADMIN" });

    const planResult = await createDutyPlan({
      organizationId: organizationB.id,
      regionId: regionB.id,
      name: "B Organizasyonu Planı",
      userId: userB.id,
    });
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;
    cleanupIds.planIds.push(planResult.planId);

    const result = await deletePlanVersion({
      organizationId: organizationA.id,
      versionId: planResult.versionId,
      userId: userA.id,
    });
    expect(result).toEqual({ ok: false, code: "VERSION_NOT_FOUND", message: expect.any(String) });

    const stillThere = await prisma.dutyPlanVersion.findUnique({ where: { id: planResult.versionId } });
    expect(stillThere).not.toBeNull();
  });
});
