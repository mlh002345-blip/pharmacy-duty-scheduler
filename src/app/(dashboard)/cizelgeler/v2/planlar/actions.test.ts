import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrganizationRoleOrRedirect = vi.fn();
const deletePlanVersion = vi.fn();

vi.mock("@/lib/auth/tenant", () => ({
  requireOrganizationRoleOrRedirect: (...args: unknown[]) => requireOrganizationRoleOrRedirect(...args),
}));
vi.mock("@/lib/duty-rules-v2/configuration/delete-plan-version", () => ({
  deletePlanVersion: (...args: unknown[]) => deletePlanVersion(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

const { deletePlanVersionAction } = await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
  requireOrganizationRoleOrRedirect.mockResolvedValue({
    id: "staff-1",
    role: "STAFF",
    organizationId: "org-1",
  });
});

describe("deletePlanVersionAction", () => {
  it("passes the session-derived organizationId/userId, never a client-supplied one", async () => {
    deletePlanVersion.mockResolvedValue({ ok: true, planDeleted: false });

    await expect(deletePlanVersionAction("version-1")).rejects.toThrow(
      "REDIRECT:/cizelgeler/v2/planlar?success="
    );
    expect(deletePlanVersion).toHaveBeenCalledWith({
      organizationId: "org-1",
      versionId: "version-1",
      userId: "staff-1",
    });
  });

  it("uses a different success message when the now-empty plan was also deleted", async () => {
    deletePlanVersion.mockResolvedValue({ ok: true, planDeleted: true });

    let thrown: unknown;
    try {
      await deletePlanVersionAction("version-1");
    } catch (e) {
      thrown = e;
    }
    expect(String(thrown)).toContain("plan%20silindi");
  });

  it("redirects with a typed error message and never calls the service's success path when the service fails", async () => {
    deletePlanVersion.mockResolvedValue({
      ok: false,
      code: "VERSION_NOT_DRAFT",
      message: "Yalnızca taslak durumundaki bir sürüm silinebilir.",
    });

    await expect(deletePlanVersionAction("version-1")).rejects.toThrow(
      /REDIRECT:\/cizelgeler\/v2\/planlar\?error=/
    );
  });
});
