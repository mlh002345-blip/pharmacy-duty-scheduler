import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  dutyDraftPreview: { updateMany: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { markDraftPreviewConsumed } = await import("./draft-preview-store");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("markDraftPreviewConsumed", () => {
  it("scopes the update by the caller's own organizationId in the same where clause (tenant isolation, defense-in-depth)", async () => {
    prismaMock.dutyDraftPreview.updateMany.mockResolvedValue({ count: 1 });

    await markDraftPreviewConsumed({ previewId: "preview-1", organizationId: "org-1" });

    expect(prismaMock.dutyDraftPreview.updateMany).toHaveBeenCalledWith({
      where: { id: "preview-1", organizationId: "org-1" },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it("never matches a preview belonging to a different organization (updateMany affects zero rows, no error thrown)", async () => {
    prismaMock.dutyDraftPreview.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      markDraftPreviewConsumed({ previewId: "preview-1", organizationId: "wrong-org" })
    ).resolves.toBeUndefined();

    expect(prismaMock.dutyDraftPreview.updateMany).toHaveBeenCalledWith({
      where: { id: "preview-1", organizationId: "wrong-org" },
      data: { consumedAt: expect.any(Date) },
    });
  });
});
