import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrganizationMember = vi.fn();
const migrateV1RegionToV2 = vi.fn();

vi.mock("@/lib/auth/tenant", () => ({
  requireOrganizationMember: (...args: unknown[]) => requireOrganizationMember(...args),
}));
vi.mock("@/lib/duty-rules-v2/migration/migrate-v1-region-to-v2", () => ({
  migrateV1RegionToV2: (...args: unknown[]) => migrateV1RegionToV2(...args),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

const { migrateV1RegionToV2Action } = await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("migrateV1RegionToV2Action", () => {
  it("blocks non-ADMIN users before calling the service", async () => {
    requireOrganizationMember.mockResolvedValue({ id: "staff-1", role: "STAFF", organizationId: "org-1" });

    await expect(migrateV1RegionToV2Action("region-1")).rejects.toThrow(
      /REDIRECT:\/cizelgeler\/v2\/planlar\/v1-tasi\?error=/
    );
    expect(migrateV1RegionToV2).not.toHaveBeenCalled();
  });

  it("passes the session-derived organizationId/userId, never a client-supplied one", async () => {
    requireOrganizationMember.mockResolvedValue({ id: "admin-1", role: "ADMIN", organizationId: "org-1" });
    migrateV1RegionToV2.mockResolvedValue({
      ok: true,
      planId: "plan-1",
      versionId: "version-1",
      poolId: "pool-1",
      memberCount: 3,
      activated: true,
      activationBlockingIssues: [],
    });

    await expect(migrateV1RegionToV2Action("region-1")).rejects.toThrow(
      "REDIRECT:/cizelgeler/v2/planlar/plan-1/versions/version-1?success="
    );
    expect(migrateV1RegionToV2).toHaveBeenCalledWith({
      organizationId: "org-1",
      regionId: "region-1",
      userId: "admin-1",
    });
  });

  it("redirects to the version page with a different message when activation didn't happen", async () => {
    requireOrganizationMember.mockResolvedValue({ id: "admin-1", role: "ADMIN", organizationId: "org-1" });
    migrateV1RegionToV2.mockResolvedValue({
      ok: true,
      planId: "plan-1",
      versionId: "version-1",
      poolId: "pool-1",
      memberCount: 0,
      activated: false,
      activationBlockingIssues: [{ code: "REGION_INACTIVE", subjectId: "region-1" }],
    });

    let thrown: unknown;
    try {
      await migrateV1RegionToV2Action("region-1");
    } catch (e) {
      thrown = e;
    }
    expect(String(thrown)).toContain("/cizelgeler/v2/planlar/plan-1/versions/version-1?success=");
    expect(String(thrown)).toContain("etkinle%C5%9Ftirilemedi");
  });

  it("redirects back to the migration list with a service error, without ever calling redirect to a plan page", async () => {
    requireOrganizationMember.mockResolvedValue({ id: "admin-1", role: "ADMIN", organizationId: "org-1" });
    migrateV1RegionToV2.mockResolvedValue({
      ok: false,
      code: "ALREADY_HAS_PLAN",
      message: "Bu bölge için zaten bir V2 planı var.",
    });

    await expect(migrateV1RegionToV2Action("region-1")).rejects.toThrow(
      /REDIRECT:\/cizelgeler\/v2\/planlar\/v1-tasi\?error=/
    );
  });
});
