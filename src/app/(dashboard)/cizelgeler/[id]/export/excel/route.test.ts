import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
const loadDutyScheduleForExport = vi.fn();
const buildDutyScheduleExcel = vi.fn();
const buildDutyScheduleExportFilename: (...args: unknown[]) => string = vi.fn(
  () => "nobet-cizelgesi.xlsx"
);
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUser(...args),
}));
vi.mock("next/navigation", () => ({
  redirect: (...args: [string]) => redirect(...args),
}));
vi.mock("@/lib/scheduling/build-schedule-excel", () => ({
  buildDutyScheduleExcel: (...args: unknown[]) => buildDutyScheduleExcel(...args),
}));
vi.mock("@/lib/scheduling/export-duty-schedule", () => ({
  loadDutyScheduleForExport: (...args: unknown[]) => loadDutyScheduleForExport(...args),
  buildDutyScheduleExportFilename: (...args: unknown[]) =>
    buildDutyScheduleExportFilename(...args),
}));

const { GET } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
  loadDutyScheduleForExport.mockResolvedValue({ id: "schedule-1", assignments: [] });
});

describe("GET /cizelgeler/[id]/export/excel — schedule_excel_export_failed logging", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("returns a controlled 500 and logs schedule_excel_export_failed when generation throws", async () => {
    buildDutyScheduleExcel.mockRejectedValue(new Error("exceljs blew up: internal buffer state"));

    const response = await GET(new Request("https://example.com"), {
      params: Promise.resolve({ id: "schedule-1" }),
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.message).toBe("Excel dışa aktarma sırasında bir hata oluştu.");
    // The internal exception detail must not leak into the response body.
    expect(JSON.stringify(body)).not.toContain("internal buffer state");

    expect(errorSpy).toHaveBeenCalledOnce();
    const record = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(record.event).toBe("schedule_excel_export_failed");
    expect(record.level).toBe("error");
    expect(record.userId).toBe("admin-1");
    expect(record.scheduleId).toBe("schedule-1");
    expect(record.error.message).toContain("internal buffer state");
  });

  it("does not log anything on a successful export", async () => {
    buildDutyScheduleExcel.mockResolvedValue(Buffer.from("fake-xlsx-bytes"));

    const response = await GET(new Request("https://example.com"), {
      params: Promise.resolve({ id: "schedule-1" }),
    });

    expect(response.status).toBe(200);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
