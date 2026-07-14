import { describe, expect, it } from "vitest";

import type { PrismaClient } from "@prisma/client";

import type { LoadedRotationPool } from "./domain/loaded-plan";
import { DutyPlanLoaderError, throwForIssues, type LoaderIssue } from "./errors";
import {
  DUTY_PLAN_LOADER_VERSION,
  buildLoadedDutyPlanVersion,
  loadDutyPlanVersion,
} from "./load-duty-plan-version";
import { fetchDutyPlanVersionRecord } from "./plan-version-repository";
import type { PlanVersionRecord } from "./plan-version-record";
import {
  canCommitFromPlanVersion,
  canPreviewPlanVersion,
  canSimulatePlanVersion,
} from "./plan-version-policy";
import { resolvePoolMembershipAsOf } from "./resolve-pool-membership";
import { canonicalSerialize } from "./v1-adapter";
import { validateStructure, validateTenantIntegrity } from "./validate-loaded-plan";

// ---------------------------------------------------------------------------
// In-memory record factory (no PostgreSQL anywhere in this file).
// ---------------------------------------------------------------------------

const DAY_TYPES = [
  "WEEKDAY",
  "SATURDAY",
  "SUNDAY",
  "OFFICIAL_HOLIDAY",
  "RELIGIOUS_HOLIDAY",
  "HOLIDAY_EVE",
] as const;

function makeRecord(mutate?: (record: PlanVersionRecord) => void): PlanVersionRecord {
  const record: PlanVersionRecord = {
    id: "pv-1",
    versionNumber: 1,
    status: "APPROVED",
    validFrom: new Date("2026-08-01T00:00:00.000Z"),
    validTo: null,
    updatedAt: new Date("2026-07-14T09:30:00.000Z"),
    plan: {
      id: "plan-1",
      name: "Merkez Planı",
      organizationId: "org-1",
      regionId: "region-1",
      region: { id: "region-1", organizationId: "org-1", isActive: true },
    },
    dayTypeRules: DAY_TYPES.map((dayType, index) => ({
      id: `dtr-${index}`,
      dayType,
      isServed: true,
      customDayCategory: null,
      slotRequirements: [
        {
          id: `slot-${index}`,
          name: null,
          requiredCount: 2,
          sortOrder: 0,
          dayTypeRuleId: `dtr-${index}`,
          shiftDefinitionId: "shift-1",
          rotationPoolId: "pool-1",
        },
      ],
    })),
    shiftDefinitions: [
      {
        id: "shift-1",
        name: "Gece Nöbeti",
        startMinute: 19 * 60,
        endMinute: 8 * 60,
        spansMidnight: true,
        defaultWeight: 1,
        sortOrder: 0,
      },
    ],
    rotationPools: [
      {
        id: "pool-1",
        name: "Merkez Havuzu",
        strategy: "FAIRNESS_SCORE",
        organizationId: "org-1",
        regionId: "region-1",
        memberships: [
          {
            id: "m-1",
            pharmacyId: "ph-a",
            joinedAt: new Date("2026-01-01T00:00:00.000Z"),
            leftAt: null,
            sortIndex: null,
            pharmacy: {
              id: "ph-a",
              name: "Çınar Eczanesi",
              isActive: true,
              regionId: "region-1",
              regionOrganizationId: "org-1",
            },
          },
          {
            id: "m-2",
            pharmacyId: "ph-b",
            joinedAt: new Date("2026-01-01T00:00:00.000Z"),
            leftAt: new Date("2026-06-01T00:00:00.000Z"),
            sortIndex: null,
            pharmacy: {
              id: "ph-b",
              name: "Işık Eczanesi",
              isActive: true,
              regionId: "region-1",
              regionOrganizationId: "org-1",
            },
          },
          {
            id: "m-3",
            pharmacyId: "ph-c",
            joinedAt: new Date("2026-01-01T00:00:00.000Z"),
            leftAt: null,
            sortIndex: null,
            pharmacy: {
              id: "ph-c",
              name: "Öz Deva Eczanesi",
              isActive: false,
              regionId: "region-1",
              regionOrganizationId: "org-1",
            },
          },
        ],
        rotationStates: [
          {
            id: "rs-1",
            dayTypeScope: "ALL",
            currentRound: 0,
            carriedForward: [],
            lockVersion: 0,
            lastServedMembershipId: "m-1",
          },
        ],
      },
    ],
  };
  mutate?.(record);
  return record;
}

function issuesOf(record: PlanVersionRecord): LoaderIssue[] {
  return [
    ...validateTenantIntegrity(record, { organizationId: "org-1", regionId: "region-1" }),
    ...validateStructure(record),
  ];
}

function expectIssue(record: PlanVersionRecord, code: LoaderIssue["code"], subjectId?: string) {
  const issues = issuesOf(record);
  const match = issues.find((i) => i.code === code);
  expect(match, `expected issue ${code} in ${JSON.stringify(issues)}`).toBeDefined();
  if (subjectId !== undefined) expect(match?.subjectId).toBe(subjectId);
}

// ---------------------------------------------------------------------------
// 1) Transformation.
// ---------------------------------------------------------------------------

describe("buildLoadedDutyPlanVersion — transformation", () => {
  it("transforms a complete valid record into the engine-ready domain model", () => {
    const loaded = buildLoadedDutyPlanVersion(makeRecord(), { effectiveDate: "2026-08-15" });

    expect(loaded.loaderVersion).toBe(DUTY_PLAN_LOADER_VERSION);
    expect(loaded.organizationId).toBe("org-1");
    expect(loaded.regionId).toBe("region-1");
    expect(loaded.planId).toBe("plan-1");
    expect(loaded.planName).toBe("Merkez Planı");
    expect(loaded.planVersionId).toBe("pv-1");
    expect(loaded.versionNumber).toBe(1);
    expect(loaded.status).toBe("APPROVED");
    expect(loaded.validFrom).toBe("2026-08-01");
    expect(loaded.validTo).toBeNull();
    expect(loaded.dayTypeRules.map((r) => r.dayType)).toEqual([...DAY_TYPES]);
    expect(loaded.shiftDefinitions).toHaveLength(1);
    expect(loaded.slotRequirements).toHaveLength(6);
    expect(loaded.slotRequirements.every((s) => s.requiredCount === 2)).toBe(true);
    expect(loaded.rotationPools).toHaveLength(1);
    expect(loaded.rotationPools[0].strategy).toBe("FAIRNESS_SCORE");
    expect(loaded.rotationPools[0].memberships.map((m) => m.id)).toEqual(["m-1", "m-2", "m-3"]);
    expect(loaded.rotationPools[0].rotationStates[0]).toMatchObject({
      dayTypeScope: "ALL",
      currentRound: 0,
      lockVersion: 0,
      lastServedMembershipId: "m-1",
    });
    // Dates are normalized strings — no Date objects anywhere.
    expect(loaded.rotationPools[0].memberships[0].joinedOn).toBe("2026-01-01");
    expect(loaded.rotationPools[0].memberships[1].leftOn).toBe("2026-06-01");
    expect(canonicalSerialize(loaded)).not.toMatch(/20\d\d-\d\d-\d\dT/);
    // Snapshot resolved for the requested date: ph-a eligible; ph-b left
    // on 06-01 (exclusive) and ph-c inactive are excluded.
    expect(loaded.membershipSnapshots).toHaveLength(1);
    expect(loaded.membershipSnapshots?.[0].eligible.map((e) => e.pharmacyId)).toEqual(["ph-a"]);
    expect(loaded.membershipSnapshots?.[0].excluded.map((e) => e.reason).sort()).toEqual([
      "LEFT_BEFORE_EFFECTIVE_DATE",
      "PHARMACY_INACTIVE",
    ]);
    expect(loaded.configurationFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("loads configuration-only (no snapshots) when effectiveDate is omitted", () => {
    const loaded = buildLoadedDutyPlanVersion(makeRecord(), { effectiveDate: null });
    expect(loaded.membershipSnapshots).toBeNull();
  });

  it("emits deterministic diagnostics for inactive region, unserved-day slots, and empty pools", () => {
    const record = makeRecord((r) => {
      r.plan.region.isActive = false;
      r.dayTypeRules[5].isServed = false; // HOLIDAY_EVE keeps its slot.
      r.rotationPools[0].memberships = [];
      r.rotationPools[0].rotationStates = [];
    });
    const loaded = buildLoadedDutyPlanVersion(record, { effectiveDate: "2026-07-01" });
    const codes = loaded.diagnostics.map((d) => d.code);
    expect(codes).toContain("REGION_INACTIVE");
    expect(codes).toContain("SLOT_ON_UNSERVED_DAY_TYPE");
    expect(codes).toContain("POOL_EMPTY_AS_OF_EFFECTIVE_DATE");
    // 2026-07-01 precedes validFrom 2026-08-01.
    expect(codes).toContain("EFFECTIVE_DATE_OUTSIDE_VALIDITY");
    const sorted = [...loaded.diagnostics].sort((a, b) =>
      a.code < b.code ? -1 : a.code > b.code ? 1 : a.subjectId < b.subjectId ? -1 : 1
    );
    expect(loaded.diagnostics).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------
// 2–5, 27–28) Determinism and fingerprint.
// ---------------------------------------------------------------------------

describe("determinism and fingerprint", () => {
  it("produces byte-identical output regardless of relation/row ordering (three runs)", () => {
    const base = buildLoadedDutyPlanVersion(makeRecord(), { effectiveDate: "2026-08-15" });
    const outputs = [1, 2, 3].map(() => {
      const shuffled = makeRecord((r) => {
        r.dayTypeRules.reverse();
        r.dayTypeRules.forEach((rule) => rule.slotRequirements.reverse());
        r.shiftDefinitions.reverse();
        r.rotationPools.reverse();
        r.rotationPools.forEach((pool) => {
          pool.memberships.reverse();
          pool.rotationStates.reverse();
        });
      });
      return canonicalSerialize(buildLoadedDutyPlanVersion(shuffled, { effectiveDate: "2026-08-15" }));
    });
    for (const output of outputs) expect(output).toBe(canonicalSerialize(base));
  });

  it("keeps the fingerprint stable across runs and row orderings", () => {
    const fingerprints = [1, 2, 3].map(
      () =>
        buildLoadedDutyPlanVersion(
          makeRecord((r) => r.dayTypeRules.reverse()),
          { effectiveDate: null }
        ).configurationFingerprint
    );
    expect(new Set(fingerprints).size).toBe(1);
  });

  it("changes the fingerprint when scheduling-relevant configuration changes", () => {
    const base = buildLoadedDutyPlanVersion(makeRecord(), { effectiveDate: null });
    const changedCount = buildLoadedDutyPlanVersion(
      makeRecord((r) => {
        r.dayTypeRules[0].slotRequirements[0].requiredCount = 3;
      }),
      { effectiveDate: null }
    );
    const changedShift = buildLoadedDutyPlanVersion(
      makeRecord((r) => {
        r.shiftDefinitions[0].startMinute = 20 * 60;
      }),
      { effectiveDate: null }
    );
    const changedMembership = buildLoadedDutyPlanVersion(
      makeRecord((r) => {
        r.rotationPools[0].memberships[0].leftAt = new Date("2026-09-01T00:00:00.000Z");
      }),
      { effectiveDate: null }
    );
    expect(changedCount.configurationFingerprint).not.toBe(base.configurationFingerprint);
    expect(changedShift.configurationFingerprint).not.toBe(base.configurationFingerprint);
    expect(changedMembership.configurationFingerprint).not.toBe(base.configurationFingerprint);
  });

  it("ignores audit timestamps, status, version number, and rotation-state progression", () => {
    const base = buildLoadedDutyPlanVersion(makeRecord(), { effectiveDate: null });
    const noise = buildLoadedDutyPlanVersion(
      makeRecord((r) => {
        r.updatedAt = new Date("2027-01-01T12:34:56.000Z");
        r.status = "ACTIVE";
        r.versionNumber = 7;
        r.rotationPools[0].rotationStates[0].currentRound = 42;
        r.rotationPools[0].rotationStates[0].lockVersion = 9;
        r.rotationPools[0].rotationStates[0].lastServedMembershipId = "m-2";
      }),
      { effectiveDate: null }
    );
    expect(noise.configurationFingerprint).toBe(base.configurationFingerprint);
  });

  it("two organizations with identical plan/pool names produce different fingerprints", () => {
    const orgTwo = makeRecord((r) => {
      r.plan.organizationId = "org-2";
      r.plan.region.organizationId = "org-2";
      r.rotationPools[0].organizationId = "org-2";
      r.rotationPools[0].memberships.forEach((m) => {
        m.pharmacy.regionOrganizationId = "org-2";
      });
    });
    const a = buildLoadedDutyPlanVersion(makeRecord(), { effectiveDate: null });
    const b = buildLoadedDutyPlanVersion(orgTwo, { effectiveDate: null });
    expect(a.planName).toBe(b.planName);
    expect(a.configurationFingerprint).not.toBe(b.configurationFingerprint);
  });

  it("Turkish characters in names never affect ordering or identifiers (code-point sorting)", () => {
    const record = makeRecord((r) => {
      r.shiftDefinitions.push({
        id: "shift-2",
        name: "Şafak Nöbeti",
        startMinute: 8 * 60,
        endMinute: 19 * 60,
        spansMidnight: false,
        defaultWeight: 1,
        sortOrder: 0,
      });
    });
    const runs = [1, 2, 3].map(() =>
      canonicalSerialize(buildLoadedDutyPlanVersion(record, { effectiveDate: null }))
    );
    expect(new Set(runs).size).toBe(1);
    const loaded = buildLoadedDutyPlanVersion(record, { effectiveDate: null });
    // Equal sortOrder falls back to code-point name comparison: "G" < "Ş".
    expect(loaded.shiftDefinitions.map((s) => s.name)).toEqual(["Gece Nöbeti", "Şafak Nöbeti"]);
  });
});

// ---------------------------------------------------------------------------
// 6–7) Generic not-found through the scoped loader.
// ---------------------------------------------------------------------------

function stubDbReturning(row: unknown, capture?: { args?: unknown }): PrismaClient {
  return {
    dutyPlanVersion: {
      findFirst: async (args: unknown) => {
        if (capture) capture.args = args;
        return row;
      },
    },
  } as unknown as PrismaClient;
}

describe("loadDutyPlanVersion — tenant-scoped lookup", () => {
  it("returns the same generic not-found for unknown, foreign-organization, and foreign-region versions", async () => {
    // The repository query is scoped from the root, so all three cases
    // are literally the same null result — asserted here by capturing
    // the where clause and checking the scope is present.
    const capture: { args?: unknown } = {};
    const db = stubDbReturning(null, capture);
    const errors: DutyPlanLoaderError[] = [];
    for (const input of [
      { organizationId: "org-1", regionId: "region-1", planVersionId: "does-not-exist" },
      { organizationId: "org-OTHER", regionId: "region-1", planVersionId: "pv-1" },
      { organizationId: "org-1", regionId: "region-OTHER", planVersionId: "pv-1" },
    ]) {
      const error = await loadDutyPlanVersion(input, db).then(
        () => null,
        (e: unknown) => e as DutyPlanLoaderError
      );
      expect(error).toBeInstanceOf(DutyPlanLoaderError);
      if (error) errors.push(error);
    }
    expect(errors.map((e) => e.code)).toEqual([
      "PLAN_VERSION_NOT_FOUND",
      "PLAN_VERSION_NOT_FOUND",
      "PLAN_VERSION_NOT_FOUND",
    ]);
    // Identical messages: no tenant-existence disclosure.
    expect(new Set(errors.map((e) => e.message)).size).toBe(1);
    const where = (capture.args as { where: { id: string; plan: object } }).where;
    expect(where.plan).toEqual({ organizationId: "org-1", regionId: "region-OTHER" });
  });

  it("rejects malformed input (including a bad effectiveDate) without querying", async () => {
    let queried = false;
    const db = {
      dutyPlanVersion: {
        findFirst: async () => {
          queried = true;
          return null;
        },
      },
    } as unknown as PrismaClient;
    await expect(
      loadDutyPlanVersion(
        { organizationId: "", regionId: "region-1", planVersionId: "pv-1" },
        db
      )
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      loadDutyPlanVersion(
        {
          organizationId: "org-1",
          regionId: "region-1",
          planVersionId: "pv-1",
          effectiveDate: "15.08.2026",
        },
        db
      )
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(queried).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Repository mapping (stubbed Prisma row — still no database).
// ---------------------------------------------------------------------------

describe("fetchDutyPlanVersionRecord — mapping", () => {
  it("deduplicates pools referenced by several slots and flattens pharmacy ownership", async () => {
    const poolRow = {
      id: "pool-1",
      name: "Merkez Havuzu",
      strategy: "SEQUENTIAL",
      organizationId: "org-1",
      regionId: null,
      memberships: [
        {
          id: "m-1",
          pharmacyId: "ph-a",
          joinedAt: new Date("2026-01-01T00:00:00.000Z"),
          leftAt: null,
          sortIndex: 2,
          pharmacy: {
            id: "ph-a",
            name: "Çınar Eczanesi",
            isActive: true,
            regionId: "region-1",
            region: { organizationId: "org-1" },
          },
        },
      ],
      rotationStates: [],
    };
    const row = {
      id: "pv-1",
      versionNumber: 1,
      status: "DRAFT",
      validFrom: new Date("2026-08-01T00:00:00.000Z"),
      validTo: null,
      updatedAt: new Date("2026-07-14T00:00:00.000Z"),
      plan: {
        id: "plan-1",
        name: "Plan",
        organizationId: "org-1",
        regionId: "region-1",
        region: { id: "region-1", organizationId: "org-1", isActive: true },
      },
      dayTypeRules: [
        {
          id: "dtr-0",
          dayType: "WEEKDAY",
          isServed: true,
          customDayCategory: null,
          slotRequirements: [
            {
              id: "slot-0",
              name: null,
              requiredCount: 1,
              sortOrder: 0,
              dayTypeRuleId: "dtr-0",
              shiftDefinitionId: "shift-1",
              rotationPoolId: "pool-1",
              rotationPool: poolRow,
            },
            {
              id: "slot-1",
              name: null,
              requiredCount: 1,
              sortOrder: 1,
              dayTypeRuleId: "dtr-0",
              shiftDefinitionId: "shift-1",
              rotationPoolId: "pool-1",
              rotationPool: poolRow,
            },
          ],
        },
      ],
      shiftDefinitions: [],
    };
    const record = await fetchDutyPlanVersionRecord(
      { organizationId: "org-1", regionId: "region-1", planVersionId: "pv-1" },
      stubDbReturning(row)
    );
    expect(record?.rotationPools).toHaveLength(1);
    expect(record?.rotationPools[0].memberships[0].pharmacy.regionOrganizationId).toBe("org-1");
    expect(record?.dayTypeRules[0].slotRequirements).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 8–10) Tenant integrity.
// ---------------------------------------------------------------------------

describe("validateTenantIntegrity", () => {
  it("rejects a slot pool from another organization", () => {
    expectIssue(
      makeRecord((r) => {
        r.rotationPools[0].organizationId = "org-OTHER";
      }),
      "POOL_ORGANIZATION_MISMATCH",
      "pool-1"
    );
  });

  it("rejects a region-scoped pool bound to another region", () => {
    expectIssue(
      makeRecord((r) => {
        r.rotationPools[0].regionId = "region-OTHER";
      }),
      "POOL_REGION_MISMATCH",
      "pool-1"
    );
  });

  it("rejects a membership pharmacy owned by another organization", () => {
    expectIssue(
      makeRecord((r) => {
        r.rotationPools[0].memberships[0].pharmacy.regionOrganizationId = "org-OTHER";
      }),
      "MEMBERSHIP_PHARMACY_ORGANIZATION_MISMATCH",
      "m-1"
    );
  });

  it("rejects a membership pharmacy outside a region-scoped pool's region", () => {
    expectIssue(
      makeRecord((r) => {
        r.rotationPools[0].memberships[0].pharmacy.regionId = "region-OTHER";
      }),
      "MEMBERSHIP_PHARMACY_REGION_MISMATCH",
      "m-1"
    );
  });

  it("allows same-organization pharmacies from other regions in an ORG-WIDE pool", () => {
    const record = makeRecord((r) => {
      r.rotationPools[0].regionId = null;
      r.rotationPools[0].memberships[0].pharmacy.regionId = "region-OTHER";
    });
    expect(issuesOf(record)).toEqual([]);
  });

  it("rejects a plan whose region belongs to another organization", () => {
    expectIssue(
      makeRecord((r) => {
        r.plan.region.organizationId = "org-OTHER";
      }),
      "PLAN_REGION_ORGANIZATION_MISMATCH",
      "plan-1"
    );
  });

  it("tenant issues dominate structural issues in the thrown error", () => {
    const record = makeRecord((r) => {
      r.rotationPools[0].organizationId = "org-OTHER";
      r.dayTypeRules[0].slotRequirements[0].requiredCount = 0;
    });
    const error = (() => {
      try {
        throwForIssues(issuesOf(record));
      } catch (e) {
        return e as DutyPlanLoaderError;
      }
    })();
    expect(error?.code).toBe("TENANT_INTEGRITY_VIOLATION");
    expect(error?.issues[0].code).toBe("POOL_ORGANIZATION_MISMATCH");
    expect(error?.issues.map((i) => i.code)).toContain("INVALID_REQUIRED_COUNT");
    // Ids only — no names, no content.
    expect(error?.message).not.toMatch(/Eczanesi|Havuzu|Merkez/);
  });
});

// ---------------------------------------------------------------------------
// 11–18, 23–25) Structural validation.
// ---------------------------------------------------------------------------

describe("validateStructure", () => {
  it("rejects duplicate built-in day types", () => {
    expectIssue(
      makeRecord((r) => {
        r.dayTypeRules.push({ ...r.dayTypeRules[0], id: "dtr-dup", slotRequirements: [] });
      }),
      "DUPLICATE_DAY_TYPE",
      "dtr-dup"
    );
  });

  it("rejects a missing built-in day type", () => {
    expectIssue(
      makeRecord((r) => {
        r.dayTypeRules = r.dayTypeRules.filter((rule) => rule.dayType !== "SUNDAY");
      }),
      "MISSING_DAY_TYPE",
      "SUNDAY"
    );
  });

  it("rejects ambiguous custom day categories, allows distinct ones", () => {
    const ambiguous = makeRecord((r) => {
      r.dayTypeRules.push(
        {
          id: "dtr-c1",
          dayType: "WEEKDAY",
          isServed: true,
          customDayCategory: "Pazar Günü Pazarı",
          slotRequirements: [],
        },
        {
          id: "dtr-c2",
          dayType: "WEEKDAY",
          isServed: false,
          customDayCategory: "Pazar Günü Pazarı",
          slotRequirements: [],
        }
      );
    });
    expectIssue(ambiguous, "AMBIGUOUS_CUSTOM_DAY_CATEGORY", "dtr-c2");
    const distinct = makeRecord((r) => {
      r.dayTypeRules.push({
        id: "dtr-c1",
        dayType: "WEEKDAY",
        isServed: true,
        customDayCategory: "Pazar Günü Pazarı",
        slotRequirements: [],
      });
    });
    expect(issuesOf(distinct)).toEqual([]);
  });

  it("rejects duplicate shift names", () => {
    expectIssue(
      makeRecord((r) => {
        r.shiftDefinitions.push({ ...r.shiftDefinitions[0], id: "shift-dup" });
      }),
      "DUPLICATE_SHIFT_NAME",
      "shift-dup"
    );
  });

  it("rejects duplicate slots (same rule, shift, sortOrder)", () => {
    expectIssue(
      makeRecord((r) => {
        r.dayTypeRules[0].slotRequirements.push({
          ...r.dayTypeRules[0].slotRequirements[0],
          id: "slot-dup",
        });
      }),
      "DUPLICATE_SLOT",
      "slot-dup"
    );
  });

  it("rejects a slot referencing a shift outside this plan version", () => {
    expectIssue(
      makeRecord((r) => {
        r.dayTypeRules[0].slotRequirements[0].shiftDefinitionId = "shift-of-another-version";
      }),
      "UNKNOWN_SHIFT_REFERENCE",
      "slot-0"
    );
  });

  it("rejects a slot referencing a pool absent from the loaded graph", () => {
    expectIssue(
      makeRecord((r) => {
        r.dayTypeRules[0].slotRequirements[0].rotationPoolId = "pool-ghost";
      }),
      "UNKNOWN_POOL_REFERENCE",
      "slot-0"
    );
  });

  it("rejects requiredCount below 1", () => {
    expectIssue(
      makeRecord((r) => {
        r.dayTypeRules[0].slotRequirements[0].requiredCount = 0;
      }),
      "INVALID_REQUIRED_COUNT",
      "slot-0"
    );
  });

  it("rejects validFrom after validTo", () => {
    expectIssue(
      makeRecord((r) => {
        r.validTo = new Date("2026-07-01T00:00:00.000Z");
      }),
      "INVALID_VALIDITY_PERIOD",
      "pv-1"
    );
  });

  it("rejects overlapping membership periods for the same pharmacy and pool", () => {
    expectIssue(
      makeRecord((r) => {
        r.rotationPools[0].memberships.push({
          ...r.rotationPools[0].memberships[1], // ph-b, 2026-01-01 → 2026-06-01
          id: "m-overlap",
          joinedAt: new Date("2026-03-01T00:00:00.000Z"),
          leftAt: null,
        });
      }),
      "OVERLAPPING_MEMBERSHIP",
      "m-overlap"
    );
  });

  it("accepts back-to-back periods (leftOn exclusive boundary is not an overlap)", () => {
    const record = makeRecord((r) => {
      r.rotationPools[0].memberships.push({
        ...r.rotationPools[0].memberships[1],
        id: "m-next",
        joinedAt: new Date("2026-06-01T00:00:00.000Z"), // starts the day ph-b's row ends
        leftAt: null,
      });
    });
    expect(issuesOf(record)).toEqual([]);
  });

  it("rejects empty/negative membership periods", () => {
    expectIssue(
      makeRecord((r) => {
        r.rotationPools[0].memberships[0].leftAt = r.rotationPools[0].memberships[0].joinedAt;
      }),
      "INVALID_MEMBERSHIP_PERIOD",
      "m-1"
    );
  });

  it("rejects a rotation-state cursor pointing outside the pool", () => {
    expectIssue(
      makeRecord((r) => {
        r.rotationPools[0].rotationStates[0].lastServedMembershipId = "m-of-another-pool";
      }),
      "INVALID_ROTATION_STATE",
      "rs-1"
    );
  });

  it("rejects invalid lockVersion and duplicate day-type scopes", () => {
    expectIssue(
      makeRecord((r) => {
        r.rotationPools[0].rotationStates[0].lockVersion = -1;
      }),
      "INVALID_ROTATION_STATE",
      "rs-1"
    );
    expectIssue(
      makeRecord((r) => {
        r.rotationPools[0].rotationStates.push({
          ...r.rotationPools[0].rotationStates[0],
          id: "rs-dup",
        });
      }),
      "INVALID_ROTATION_STATE",
      "rs-dup"
    );
  });

  it("rejects malformed carriedForward and entries pointing outside the pool", () => {
    expectIssue(
      makeRecord((r) => {
        r.rotationPools[0].rotationStates[0].carriedForward = { not: "a list" };
      }),
      "INVALID_CARRIED_FORWARD",
      "rs-1"
    );
    expectIssue(
      makeRecord((r) => {
        r.rotationPools[0].rotationStates[0].carriedForward = [
          { membershipId: "m-foreign", reason: "SKIPPED", periodKey: "2026-07" },
        ];
      }),
      "INVALID_CARRIED_FORWARD",
      "rs-1"
    );
  });

  it("accepts a fully valid record with a valid carried-forward ledger", () => {
    const record = makeRecord((r) => {
      r.rotationPools[0].rotationStates[0].carriedForward = [
        { membershipId: "m-2", reason: "UNAVAILABLE", periodKey: "2026-05" },
      ];
      r.validTo = new Date("2026-12-31T00:00:00.000Z");
    });
    expect(issuesOf(record)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 19–22) Membership boundaries and ordering.
// ---------------------------------------------------------------------------

function makePool(
  memberships: LoadedRotationPool["memberships"]
): LoadedRotationPool {
  return {
    id: "pool-x",
    name: "Havuz",
    strategy: "MANUAL_ORDER",
    regionId: null,
    memberships,
    rotationStates: [],
  };
}

function membership(
  overrides: Partial<LoadedRotationPool["memberships"][number]> & { id: string; pharmacyId: string }
): LoadedRotationPool["memberships"][number] {
  return {
    pharmacyName: "Eczane",
    pharmacyIsActive: true,
    joinedOn: "2026-01-01",
    leftOn: null,
    sortIndex: null,
    ...overrides,
  };
}

describe("resolvePoolMembershipAsOf", () => {
  it("joinedOn is INCLUSIVE: a membership starting on the effective date is eligible", () => {
    const pool = makePool([membership({ id: "m-1", pharmacyId: "ph-a", joinedOn: "2026-08-15" })]);
    const snapshot = resolvePoolMembershipAsOf(pool, "2026-08-15");
    expect(snapshot.eligible.map((e) => e.membershipId)).toEqual(["m-1"]);
    expect(resolvePoolMembershipAsOf(pool, "2026-08-14").excluded[0].reason).toBe("NOT_YET_JOINED");
  });

  it("leftOn is EXCLUSIVE: a membership ending on the effective date is already gone", () => {
    const pool = makePool([
      membership({ id: "m-1", pharmacyId: "ph-a", leftOn: "2026-08-15" }),
    ]);
    expect(resolvePoolMembershipAsOf(pool, "2026-08-14").eligible).toHaveLength(1);
    const atBoundary = resolvePoolMembershipAsOf(pool, "2026-08-15");
    expect(atBoundary.eligible).toHaveLength(0);
    expect(atBoundary.excluded[0].reason).toBe("LEFT_BEFORE_EFFECTIVE_DATE");
  });

  it("excludes inactive pharmacies with a stable reason", () => {
    const pool = makePool([
      membership({ id: "m-1", pharmacyId: "ph-a", pharmacyIsActive: false }),
    ]);
    expect(resolvePoolMembershipAsOf(pool, "2026-08-15").excluded[0].reason).toBe(
      "PHARMACY_INACTIVE"
    );
  });

  it("orders eligibles by sortIndex (nulls last), then pharmacyId — deterministically", () => {
    const pool = makePool([
      membership({ id: "m-1", pharmacyId: "ph-z", sortIndex: null }),
      membership({ id: "m-2", pharmacyId: "ph-m", sortIndex: 2 }),
      membership({ id: "m-3", pharmacyId: "ph-a", sortIndex: null }),
      membership({ id: "m-4", pharmacyId: "ph-q", sortIndex: 1 }),
    ]);
    const first = resolvePoolMembershipAsOf(pool, "2026-08-15");
    expect(first.eligible.map((e) => e.pharmacyId)).toEqual(["ph-q", "ph-m", "ph-a", "ph-z"]);
    const reversed = makePool([...pool.memberships].reverse());
    expect(resolvePoolMembershipAsOf(reversed, "2026-08-15").eligible).toEqual(first.eligible);
  });

  it("rejects a malformed effective date", () => {
    expect(() => resolvePoolMembershipAsOf(makePool([]), "2026-2-30")).toThrow(RangeError);
    expect(() => resolvePoolMembershipAsOf(makePool([]), "2026-02-30")).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 26) Status policy matrix.
// ---------------------------------------------------------------------------

describe("plan-version status policies", () => {
  it("matches the documented matrix exactly", () => {
    const matrix = [
      { status: "DRAFT", preview: true, simulate: true, commit: false },
      { status: "UNDER_REVIEW", preview: true, simulate: true, commit: false },
      { status: "APPROVED", preview: true, simulate: true, commit: false },
      { status: "ACTIVE", preview: true, simulate: true, commit: true },
      { status: "RETIRED", preview: true, simulate: false, commit: false },
      { status: "ARCHIVED", preview: true, simulate: false, commit: false },
    ] as const;
    for (const row of matrix) {
      expect(canPreviewPlanVersion(row.status), row.status).toBe(row.preview);
      expect(canSimulatePlanVersion(row.status), row.status).toBe(row.simulate);
      expect(canCommitFromPlanVersion(row.status), row.status).toBe(row.commit);
    }
  });
});
