import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadBlobAsFile, ExportTimeoutError, fetchExportBlob } from "./export-button";

function stubDom(options: { clickThrows?: boolean } = {}) {
  const revokeObjectURL = vi.fn();
  const createObjectURL = vi.fn(() => "blob:fake-url");
  const link = {
    href: "",
    download: "",
    click: vi.fn(() => {
      if (options.clickThrows) throw new Error("click failed");
    }),
    remove: vi.fn(),
  };
  const appendChild = vi.fn();

  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  vi.stubGlobal("document", {
    createElement: vi.fn(() => link),
    body: { appendChild },
  });

  return { revokeObjectURL, createObjectURL, link, appendChild };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("downloadBlobAsFile", () => {
  it("revokes the object URL after a successful download", () => {
    const { revokeObjectURL, createObjectURL, link, appendChild } = stubDom();
    const blob = {} as Blob;

    downloadBlobAsFile(blob, "nobet-cizelgesi.xlsx");

    expect(createObjectURL).toHaveBeenCalledExactlyOnceWith(blob);
    expect(link.href).toBe("blob:fake-url");
    expect(link.download).toBe("nobet-cizelgesi.xlsx");
    expect(appendChild).toHaveBeenCalledOnce();
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:fake-url");
  });

  it("still revokes the object URL if a DOM step (click) throws after createObjectURL succeeded", () => {
    const { revokeObjectURL } = stubDom({ clickThrows: true });
    const blob = {} as Blob;

    expect(() => downloadBlobAsFile(blob, "nobet-cizelgesi.xlsx")).toThrow("click failed");

    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:fake-url");
  });

  it("does not attempt to revoke anything if createObjectURL itself throws", () => {
    const revokeObjectURL = vi.fn();
    const createObjectURL = vi.fn(() => {
      throw new Error("createObjectURL failed");
    });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.stubGlobal("document", {
      createElement: vi.fn(),
      body: { appendChild: vi.fn() },
    });
    const blob = {} as Blob;

    expect(() => downloadBlobAsFile(blob, "nobet-cizelgesi.xlsx")).toThrow(
      "createObjectURL failed"
    );

    expect(revokeObjectURL).not.toHaveBeenCalled();
  });
});

function fakeResponse(overrides: Partial<Response> = {}): Response {
  return {
    ok: true,
    headers: new Headers({ "Content-Disposition": 'attachment; filename="nobet.xlsx"' }),
    blob: vi.fn().mockResolvedValue({} as Blob),
    ...overrides,
  } as Response;
}

describe("fetchExportBlob", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes an AbortController signal to the fetch call", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse());

    await fetchExportBlob("/cizelgeler/1/export/excel", { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
      "/cizelgeler/1/export/excel",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("returns the blob and parsed filename on a successful response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse());

    const result = await fetchExportBlob("/cizelgeler/1/export/excel", { fetchImpl });

    expect(result.filename).toBe("nobet.xlsx");
  });

  it("throws a plain error (not ExportTimeoutError) on a non-OK response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ ok: false }));

    await expect(fetchExportBlob("/x", { fetchImpl })).rejects.not.toBeInstanceOf(
      ExportTimeoutError
    );
  });

  it("throws a plain error (not ExportTimeoutError) on an unrelated network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    await expect(fetchExportBlob("/x", { fetchImpl })).rejects.toThrow("network down");
    await expect(fetchExportBlob("/x", { fetchImpl })).rejects.not.toBeInstanceOf(
      ExportTimeoutError
    );
  });

  it("aborts the request and throws ExportTimeoutError once the timeout elapses", async () => {
    vi.useFakeTimers();
    const fetchImpl: typeof fetch = vi.fn((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });

    const pending = fetchExportBlob("/x", { fetchImpl, timeoutMs: 30_000 });
    const assertion = expect(pending).rejects.toBeInstanceOf(ExportTimeoutError);

    await vi.advanceTimersByTimeAsync(30_000);

    await assertion;
  });
});
