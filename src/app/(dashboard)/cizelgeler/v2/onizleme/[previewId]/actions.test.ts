import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrganizationRoleOrRedirect = vi.fn();
const loadDraftPreview = vi.fn();
const markDraftPreviewConsumed = vi.fn();
const commitCompleteDraft = vi.fn();

vi.mock("@/lib/auth/tenant", () => ({
  requireOrganizationRoleOrRedirect: (...args: unknown[]) =>
    requireOrganizationRoleOrRedirect(...args),
}));
vi.mock("@/lib/duty-rules-v2/ui/draft-preview-store", () => ({
  loadDraftPreview: (...args: unknown[]) => loadDraftPreview(...args),
  markDraftPreviewConsumed: (...args: unknown[]) => markDraftPreviewConsumed(...args),
}));
vi.mock("@/lib/duty-rules-v2/persistence/commit-complete-draft", () => ({
  commitCompleteDraft: (...args: unknown[]) => commitCompleteDraft(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

const { commitV2DraftAction } = await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
  requireOrganizationRoleOrRedirect.mockResolvedValue({
    id: "staff-1",
    role: "STAFF",
    organizationId: "org-1",
  });
});

describe("commitV2DraftAction", () => {
  it("redirects to the created schedule with a success flash on CREATED", async () => {
    loadDraftPreview.mockResolvedValue({
      ok: true,
      row: { regionId: "region-1" },
      draft: { fake: "draft" },
    });
    commitCompleteDraft.mockResolvedValue({
      ok: true,
      outcome: "CREATED",
      dutyScheduleId: "schedule-1",
    });

    await expect(commitV2DraftAction("preview-1")).rejects.toThrow(
      "REDIRECT:/cizelgeler/schedule-1?success="
    );
    expect(markDraftPreviewConsumed).toHaveBeenCalledWith("preview-1");
  });

  it("redirects with an error flash and never consumes the preview when commit fails", async () => {
    loadDraftPreview.mockResolvedValue({
      ok: true,
      row: { regionId: "region-1" },
      draft: { fake: "draft" },
    });
    commitCompleteDraft.mockResolvedValue({
      ok: false,
      code: "DRAFT_TARGET_CONFLICT",
      message: "conflict",
    });

    await expect(commitV2DraftAction("preview-1")).rejects.toThrow(
      /REDIRECT:\/cizelgeler\/v2\/onizleme\/preview-1\?error=/
    );
    expect(markDraftPreviewConsumed).not.toHaveBeenCalled();
  });

  it("redirects to the generation page when the preview cannot be loaded, without calling commitCompleteDraft", async () => {
    loadDraftPreview.mockResolvedValue({
      ok: false,
      code: "EXPIRED",
      message: "expired",
    });

    await expect(commitV2DraftAction("preview-1")).rejects.toThrow(
      /REDIRECT:\/cizelgeler\/v2\/yeni\?error=/
    );
    expect(commitCompleteDraft).not.toHaveBeenCalled();
  });
});
