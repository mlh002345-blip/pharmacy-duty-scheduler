import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrganizationMember = vi.fn();
const approveGeneratedDraft = vi.fn();
const publishApprovedSchedule = vi.fn();

vi.mock("@/lib/auth/tenant", () => ({
  requireOrganizationMember: (...args: unknown[]) => requireOrganizationMember(...args),
}));
vi.mock("@/lib/duty-rules-v2/persistence/approve-generated-draft", () => ({
  approveGeneratedDraft: (...args: unknown[]) => approveGeneratedDraft(...args),
}));
vi.mock("@/lib/duty-rules-v2/persistence/publish-approved-schedule", () => ({
  publishApprovedSchedule: (...args: unknown[]) => publishApprovedSchedule(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

const { approveV2DraftAction, publishV2ScheduleAction } = await import(
  "./v2-lifecycle-actions"
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("approveV2DraftAction", () => {
  it("rejects a non-ADMIN user before calling the approval service", async () => {
    requireOrganizationMember.mockResolvedValue({
      id: "staff-1",
      role: "STAFF",
      organizationId: "org-1",
    });

    await expect(approveV2DraftAction("schedule-1")).rejects.toThrow(
      /REDIRECT:\/cizelgeler\/schedule-1\?error=/
    );
    expect(approveGeneratedDraft).not.toHaveBeenCalled();
  });

  it("redirects with success on APPROVED for an ADMIN", async () => {
    requireOrganizationMember.mockResolvedValue({
      id: "admin-1",
      role: "ADMIN",
      organizationId: "org-1",
    });
    approveGeneratedDraft.mockResolvedValue({ ok: true, outcome: "APPROVED" });

    await expect(approveV2DraftAction("schedule-1")).rejects.toThrow(
      "REDIRECT:/cizelgeler/schedule-1?success=" + encodeURIComponent("Taslak onaylandı.")
    );
  });

  it("maps each ApproveGeneratedDraftErrorCode to a Turkish error flash", async () => {
    requireOrganizationMember.mockResolvedValue({
      id: "admin-1",
      role: "ADMIN",
      organizationId: "org-1",
    });
    approveGeneratedDraft.mockResolvedValue({
      ok: false,
      code: "SCHEDULE_NOT_DRAFT",
      message: "not draft",
    });

    await expect(approveV2DraftAction("schedule-1")).rejects.toThrow(
      /REDIRECT:\/cizelgeler\/schedule-1\?error=/
    );
  });
});

describe("publishV2ScheduleAction", () => {
  it("rejects a non-ADMIN user before calling the publication service", async () => {
    requireOrganizationMember.mockResolvedValue({
      id: "staff-1",
      role: "STAFF",
      organizationId: "org-1",
    });

    await expect(publishV2ScheduleAction("schedule-1")).rejects.toThrow(
      /REDIRECT:\/cizelgeler\/schedule-1\?error=/
    );
    expect(publishApprovedSchedule).not.toHaveBeenCalled();
  });

  it("redirects with success on PUBLISHED for an ADMIN", async () => {
    requireOrganizationMember.mockResolvedValue({
      id: "admin-1",
      role: "ADMIN",
      organizationId: "org-1",
    });
    publishApprovedSchedule.mockResolvedValue({ ok: true, outcome: "PUBLISHED" });

    await expect(publishV2ScheduleAction("schedule-1")).rejects.toThrow(
      "REDIRECT:/cizelgeler/schedule-1?success=" + encodeURIComponent("Çizelge yayınlandı.")
    );
  });

  it("maps ROTATION_STATE_CONFLICT to a Turkish error flash", async () => {
    requireOrganizationMember.mockResolvedValue({
      id: "admin-1",
      role: "ADMIN",
      organizationId: "org-1",
    });
    publishApprovedSchedule.mockResolvedValue({
      ok: false,
      code: "ROTATION_STATE_CONFLICT",
      message: "conflict",
    });

    await expect(publishV2ScheduleAction("schedule-1")).rejects.toThrow(
      /REDIRECT:\/cizelgeler\/schedule-1\?error=/
    );
  });
});
