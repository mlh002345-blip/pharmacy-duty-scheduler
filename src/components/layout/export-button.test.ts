import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadBlobAsFile } from "./export-button";

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
