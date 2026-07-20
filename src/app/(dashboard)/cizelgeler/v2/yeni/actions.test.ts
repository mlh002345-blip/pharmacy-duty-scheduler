import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrganizationRole = vi.fn();
const assembleV1CompatibilityEngineInput = vi.fn();
const saveDraftPreview = vi.fn();
const buildDutyEngineContext = vi.fn();

vi.mock("@/lib/auth/tenant", () => ({
  requireOrganizationRole: (...args: unknown[]) => requireOrganizationRole(...args),
}));
vi.mock("@/lib/duty-rules-v2/ui/assemble-v1-compatibility-engine-input", () => ({
  assembleV1CompatibilityEngineInput: (...args: unknown[]) =>
    assembleV1CompatibilityEngineInput(...args),
}));
vi.mock("@/lib/duty-rules-v2/ui/draft-preview-store", () => ({
  saveDraftPreview: (...args: unknown[]) => saveDraftPreview(...args),
}));
vi.mock("@/lib/duty-rules-v2/engine/build-engine-context", () => ({
  buildDutyEngineContext: (...args: unknown[]) => buildDutyEngineContext(...args),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

const { generateV2DraftPreviewAction } = await import("./actions");

function makeFormData(overrides: Partial<Record<string, string>> = {}) {
  const fd = new FormData();
  fd.set("regionId", overrides.regionId ?? "region-1");
  fd.set("periodStart", overrides.periodStart ?? "2026-09-01");
  fd.set("periodEnd", overrides.periodEnd ?? "2026-09-30");
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOrganizationRole.mockResolvedValue({
    user: { id: "staff-1", role: "STAFF", organizationId: "org-1" },
  });
});

describe("generateV2DraftPreviewAction", () => {
  it("redirects to the preview page on success", async () => {
    assembleV1CompatibilityEngineInput.mockResolvedValue({
      ok: true,
      input: { periodStart: "2026-09-01", periodEnd: "2026-09-30" },
      planVersionId: "plan-version-1",
    });
    buildDutyEngineContext.mockReturnValue({
      completeDraftSchedule: { status: "COMPLETE" },
    });
    saveDraftPreview.mockResolvedValue({ previewId: "preview-1" });

    await expect(
      generateV2DraftPreviewAction({ success: false, message: "" }, makeFormData())
    ).rejects.toThrow("REDIRECT:/cizelgeler/v2/onizleme/preview-1");

    expect(saveDraftPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        regionId: "region-1",
        planVersionId: "plan-version-1",
        createdById: "staff-1",
      })
    );
  });

  it("rejects a user without the generateSchedule permission before touching any service", async () => {
    requireOrganizationRole.mockResolvedValue({
      user: null,
      state: { success: false, message: "Bu işlem için yetkiniz bulunmuyor." },
    });

    const result = await generateV2DraftPreviewAction(
      { success: false, message: "" },
      makeFormData()
    );

    expect(result.success).toBe(false);
    expect(assembleV1CompatibilityEngineInput).not.toHaveBeenCalled();
  });

  it("maps each AssembleEngineInputErrorCode to a Turkish ActionState instead of throwing", async () => {
    assembleV1CompatibilityEngineInput.mockResolvedValue({
      ok: false,
      code: "NO_ACTIVE_PLAN_VERSION",
      message: "Bu bölge için etkin bir V2 nöbet planı bulunamadı.",
    });

    const result = await generateV2DraftPreviewAction(
      { success: false, message: "" },
      makeFormData()
    );

    expect(result.success).toBe(false);
    expect(result.errors?.regionId?.[0]).toContain("etkin bir V2 nöbet planı");
    expect(saveDraftPreview).not.toHaveBeenCalled();
  });

  it("rejects a region belonging to a different tenant via REGION_NOT_FOUND", async () => {
    assembleV1CompatibilityEngineInput.mockResolvedValue({
      ok: false,
      code: "REGION_NOT_FOUND",
      message: "Bölge bulunamadı.",
    });

    const result = await generateV2DraftPreviewAction(
      { success: false, message: "" },
      makeFormData()
    );

    expect(result.success).toBe(false);
    expect(result.errors?.regionId?.[0]).toBe("Bölge bulunamadı.");
  });

  it("returns a validation error for a malformed period without calling the assembler", async () => {
    const result = await generateV2DraftPreviewAction(
      { success: false, message: "" },
      makeFormData({ periodStart: "not-a-date" })
    );

    expect(result.success).toBe(false);
    expect(assembleV1CompatibilityEngineInput).not.toHaveBeenCalled();
  });

  it("refuses a periodStart far beyond the generation horizon (the bulk-generate-then-churn scenario)", async () => {
    const result = await generateV2DraftPreviewAction(
      { success: false, message: "" },
      makeFormData({ periodStart: "2028-01-01", periodEnd: "2028-01-31" })
    );

    expect(result.success).toBe(false);
    expect(result.errors?.periodStart?.[0]).toContain("bir seferde en fazla");
    expect(assembleV1CompatibilityEngineInput).not.toHaveBeenCalled();
  });
});
