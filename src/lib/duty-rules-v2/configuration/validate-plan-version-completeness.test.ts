import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  dutyPlanVersion: { findFirst: vi.fn() },
  dayTypeRule: { count: vi.fn() },
};

const loadDutyPlanVersion = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../load-duty-plan-version", () => ({
  loadDutyPlanVersion: (...args: unknown[]) => loadDutyPlanVersion(...args),
}));

const { checkPlanVersionActivationReadiness } = await import(
  "./validate-plan-version-completeness"
);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.dutyPlanVersion.findFirst.mockResolvedValue({ validFrom: new Date("2026-01-01") });
  prismaMock.dayTypeRule.count.mockResolvedValue(1);
});

describe("checkPlanVersionActivationReadiness", () => {
  it("reports ok with no issues when the loader returns no diagnostics and a served day type exists", async () => {
    loadDutyPlanVersion.mockResolvedValue({ diagnostics: [] });

    const result = await checkPlanVersionActivationReadiness({
      organizationId: "org-1",
      regionId: "region-1",
      versionId: "version-1",
    });

    expect(result).toEqual({ ok: true, advisoryIssues: [] });
  });

  it("classifies SERVED_DAY_TYPE_WITHOUT_SLOTS as blocking", async () => {
    loadDutyPlanVersion.mockResolvedValue({
      diagnostics: [{ code: "SERVED_DAY_TYPE_WITHOUT_SLOTS", subjectId: "rule-1" }],
    });

    const result = await checkPlanVersionActivationReadiness({
      organizationId: "org-1",
      regionId: "region-1",
      versionId: "version-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockingIssues).toEqual([
        { code: "SERVED_DAY_TYPE_WITHOUT_SLOTS", subjectId: "rule-1" },
      ]);
    }
  });

  it("classifies POOL_EMPTY_AS_OF_EFFECTIVE_DATE as advisory, not blocking", async () => {
    loadDutyPlanVersion.mockResolvedValue({
      diagnostics: [{ code: "POOL_EMPTY_AS_OF_EFFECTIVE_DATE", subjectId: "pool-1" }],
    });

    const result = await checkPlanVersionActivationReadiness({
      organizationId: "org-1",
      regionId: "region-1",
      versionId: "version-1",
    });

    expect(result).toEqual({
      ok: true,
      advisoryIssues: [{ code: "POOL_EMPTY_AS_OF_EFFECTIVE_DATE", subjectId: "pool-1" }],
    });
  });

  it("blocks a version with zero served day types even when the loader reports no diagnostics", async () => {
    loadDutyPlanVersion.mockResolvedValue({ diagnostics: [] });
    prismaMock.dayTypeRule.count.mockResolvedValue(0);

    const result = await checkPlanVersionActivationReadiness({
      organizationId: "org-1",
      regionId: "region-1",
      versionId: "version-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blockingIssues).toEqual([{ code: "NO_SERVED_DAY_TYPES", subjectId: "version-1" }]);
    }
  });
});
