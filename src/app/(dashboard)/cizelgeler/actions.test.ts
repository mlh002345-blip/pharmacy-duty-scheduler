import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const prismaMock = {
  region: { findUnique: vi.fn() },
  dutySchedule: { findUnique: vi.fn() },
};

const requirePermissionOrState = vi.fn();
const getSchedulePreCheck = vi.fn();
const generateAndSaveDutySchedule = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/guard", () => ({
  requirePermissionOrState: (...args: unknown[]) => requirePermissionOrState(...args),
  requirePermissionOrRedirect: vi.fn(),
}));
vi.mock("@/lib/scheduling/schedule-precheck", () => ({
  getSchedulePreCheck: (...args: unknown[]) => getSchedulePreCheck(...args),
}));
vi.mock("@/lib/scheduling/generate-and-save-duty-schedule", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/scheduling/generate-and-save-duty-schedule")>();
  return {
    ...actual,
    generateAndSaveDutySchedule: (...args: unknown[]) => generateAndSaveDutySchedule(...args),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

const { createDutyScheduleAction } = await import("./actions");

function region(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "region-1",
    dailyDutyCount: 1,
    dutyRule: { minDaysBetweenDuties: 3 },
    pharmacies: [{ id: "pharmacy-1" }],
    ...overrides,
  };
}

function makeFormData() {
  const fd = new FormData();
  fd.set("month", "7");
  fd.set("year", "2026");
  fd.set("regionId", "region-1");
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionOrState.mockResolvedValue({ user: { id: "staff-1", role: "STAFF" } });
  prismaMock.region.findUnique.mockResolvedValue(region());
  prismaMock.dutySchedule.findUnique.mockResolvedValue(null); // no pre-existing schedule
  getSchedulePreCheck.mockResolvedValue({
    canGenerate: true,
    warnings: [],
    info: [],
    criticalErrors: [],
  });
});

describe("createDutyScheduleAction — concurrent duplicate submissions", () => {
  it("maps a P2002 unique-constraint violation to the same friendly duplicate-schedule message used for the sequential case", async () => {
    // Simulates two concurrent submissions both passing the initial
    // `existing` check, then the second one's write hitting the DB's
    // year_month_regionId unique constraint.
    generateAndSaveDutySchedule.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["year", "month", "regionId"] },
      })
    );

    const result = await createDutyScheduleAction(
      { success: false, message: "" },
      makeFormData()
    );

    expect(result.success).toBe(false);
    expect(result.errors?.regionId).toEqual([
      "Bu bölge için seçilen ay ve yılda zaten bir nöbet çizelgesi mevcut.",
    ]);
  });

  it("still throws unexpected (non-P2002) Prisma errors instead of hiding them", async () => {
    generateAndSaveDutySchedule.mockRejectedValueOnce(new Error("some other database error"));

    await expect(
      createDutyScheduleAction({ success: false, message: "" }, makeFormData())
    ).rejects.toThrow("some other database error");
  });

  it("succeeds and redirects when there is no conflict", async () => {
    generateAndSaveDutySchedule.mockResolvedValueOnce({
      schedule: { id: "schedule-1" },
      info: [],
    });

    await expect(
      createDutyScheduleAction({ success: false, message: "" }, makeFormData())
    ).rejects.toThrow("REDIRECT:/cizelgeler/schedule-1");
  });
});
