import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = {
  pharmacy: { findMany: vi.fn() },
};
const getCurrentUser = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUser(...args),
}));
vi.mock("next/navigation", () => ({
  redirect: (...args: [string]) => redirect(...args),
}));

const { GET } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.pharmacy.findMany.mockResolvedValue([]);
});

describe("GET /gecmis-nobetler/sablon — manageSetupData required", () => {
  it("VIEWER cannot download the template (403)", async () => {
    getCurrentUser.mockResolvedValue({ id: "viewer-1", role: "VIEWER" });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(prismaMock.pharmacy.findMany).not.toHaveBeenCalled();
  });

  it("STAFF can download the template", async () => {
    getCurrentUser.mockResolvedValue({ id: "staff-1", role: "STAFF" });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("spreadsheetml");
  });

  it("ADMIN can download the template", async () => {
    getCurrentUser.mockResolvedValue({ id: "admin-1", role: "ADMIN" });

    const response = await GET();

    expect(response.status).toBe(200);
  });

  it("unauthenticated request redirects to /giris", async () => {
    getCurrentUser.mockResolvedValue(null);

    await expect(GET()).rejects.toThrow("REDIRECT:/giris");
  });
});

describe("GET /gecmis-nobetler/sablon — controlled error contract (same shape as the export routes)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getCurrentUser.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("returns a controlled JSON 500 and logs historical_template_export_failed when the query fails", async () => {
    prismaMock.pharmacy.findMany.mockRejectedValue(
      new Error("db connection dropped: internal pool state")
    );

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ message: "Excel şablonu oluşturulurken bir hata oluştu." });
    // The internal exception detail must not leak into the response body.
    expect(JSON.stringify(body)).not.toContain("internal pool state");

    expect(errorSpy).toHaveBeenCalledOnce();
    const record = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(record.event).toBe("historical_template_export_failed");
    expect(record.level).toBe("error");
    expect(record.userId).toBe("admin-1");
    expect(record.error.message).toContain("internal pool state");
  });

  it("successful response headers (content type, filename) are unchanged", async () => {
    prismaMock.pharmacy.findMany.mockResolvedValue([
      {
        name: "Deva Eczanesi",
        phone: "0212 000 00 00",
        address: "Örnek Mah.",
        region: { name: "Kadıköy" },
      },
    ]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="gecmis-nobet-sablonu.xlsx"'
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("does not log on a 403 (permission check happens before the try/catch)", async () => {
    getCurrentUser.mockResolvedValue({ id: "staff-1", role: "VIEWER" });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
