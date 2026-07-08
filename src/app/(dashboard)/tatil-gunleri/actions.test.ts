import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

class RedirectSignal extends Error {
  constructor(
    public path: string,
    public kind: "success" | "error",
    public redirectMessage: string
  ) {
    super("REDIRECT");
  }
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["date", "type"] },
  });
}

const prismaMock = {
  holiday: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  $transaction: vi.fn((fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock)),
};

const requirePermissionOrState = vi.fn();
const writeAuditLog = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/guard", () => ({
  requirePermissionOrState: (...args: unknown[]) => requirePermissionOrState(...args),
  requirePermissionOrRedirect: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({
  writeAuditLog: (...args: unknown[]) => writeAuditLog(...args),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));
vi.mock("@/lib/flash-redirect", () => ({
  redirectWithMessage: (path: string, kind: "success" | "error", message: string) => {
    throw new RedirectSignal(path, kind, message);
  },
}));

const { createHolidayAction, updateHolidayAction } = await import("./actions");

function holidayFormData(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("date", "2026-01-01");
  fd.set("name", "Yılbaşı");
  fd.set("type", "OFFICIAL");
  for (const [key, value] of Object.entries(overrides)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionOrState.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
});

describe("createHolidayAction — duplicate date/type", () => {
  it("maps a P2002 unique-constraint violation to a friendly Turkish message", async () => {
    prismaMock.holiday.create.mockRejectedValueOnce(p2002());

    const result = await createHolidayAction({ success: false, message: "" }, holidayFormData());

    expect(result.success).toBe(false);
    expect(result.message).toBe("Bu tarih ve tür için tatil günü zaten kayıtlı.");
  });

  it("still throws unexpected (non-P2002) errors instead of hiding them", async () => {
    prismaMock.holiday.create.mockRejectedValueOnce(new Error("some other database error"));

    await expect(
      createHolidayAction({ success: false, message: "" }, holidayFormData())
    ).rejects.toThrow("some other database error");
  });

  it("valid holiday creation still works", async () => {
    prismaMock.holiday.create.mockResolvedValue({ id: "holiday-1", name: "Yılbaşı" });

    await expect(
      createHolidayAction({ success: false, message: "" }, holidayFormData())
    ).rejects.toBeInstanceOf(RedirectSignal);
    expect(prismaMock.holiday.create).toHaveBeenCalledOnce();
  });
});

describe("updateHolidayAction — duplicate date/type", () => {
  it("maps a P2002 unique-constraint violation to a friendly Turkish message", async () => {
    prismaMock.holiday.findUnique.mockResolvedValue({ id: "holiday-1", name: "Eski Ad" });
    prismaMock.holiday.update.mockRejectedValueOnce(p2002());

    const result = await updateHolidayAction(
      "holiday-1",
      { success: false, message: "" },
      holidayFormData()
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe("Bu tarih ve tür için tatil günü zaten kayıtlı.");
  });
});
