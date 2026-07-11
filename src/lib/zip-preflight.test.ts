import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { DEFAULT_ZIP_PREFLIGHT_LIMITS, preflightZipArchive, ZipPreflightError } from "./zip-preflight";

async function buildValidLikeZip(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types/>');
  zip.file("xl/workbook.xml", '<?xml version="1.0"?><workbook/>');
  return zip.generateAsync({ type: "nodebuffer" });
}

// Pure, fast, DB-free unit tests for the ZIP-metadata preflight layer —
// runs under the normal `npm test` suite (unlike the fixture-driven
// integration-style coverage in tests/file-security, which needs the
// full guarded FILE_TEST_DATABASE_URL harness).
describe("preflightZipArchive", () => {
  it("rejects a non-ZIP buffer regardless of filename/claimed content-type", async () => {
    const notAZip = Buffer.from("plain text pretending to be an .xlsx file");
    await expect(preflightZipArchive(notAZip)).rejects.toMatchObject({ reasonCode: "not_a_zip" });
  });

  it("rejects an empty buffer", async () => {
    await expect(preflightZipArchive(Buffer.alloc(0))).rejects.toBeInstanceOf(ZipPreflightError);
  });

  it("accepts a structurally valid ZIP containing xl/workbook.xml", async () => {
    await expect(preflightZipArchive(await buildValidLikeZip())).resolves.toBeUndefined();
  });

  it("rejects an archive with no xl/workbook.xml entry", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types/>');
    zip.file("readme.txt", "not a workbook");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await expect(preflightZipArchive(buffer)).rejects.toMatchObject({ reasonCode: "missing_workbook_entry" });
  });

  it("rejects an archive exceeding the max entry count", async () => {
    const zip = new JSZip();
    zip.file("xl/workbook.xml", '<?xml version="1.0"?><workbook/>');
    for (let i = 0; i < DEFAULT_ZIP_PREFLIGHT_LIMITS.maxEntryCount + 5; i++) {
      zip.file(`xl/extra-${i}.xml`, "x");
    }
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await expect(preflightZipArchive(buffer)).rejects.toMatchObject({ reasonCode: "too_many_entries" });
  });

  it("rejects a single entry whose uncompressed size exceeds the per-entry limit", async () => {
    const zip = new JSZip();
    zip.file("xl/workbook.xml", '<?xml version="1.0"?><workbook/>');
    zip.file(
      "xl/big.xml",
      Buffer.alloc(DEFAULT_ZIP_PREFLIGHT_LIMITS.maxSingleEntryUncompressedBytes + 1024, 0x41),
      { compression: "DEFLATE" }
    );
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await expect(preflightZipArchive(buffer)).rejects.toMatchObject({ reasonCode: "entry_too_large" });
  });

  it("rejects an archive whose total uncompressed size exceeds the aggregate limit, via several entries each under the per-entry cap", async () => {
    const zip = new JSZip();
    zip.file("xl/workbook.xml", '<?xml version="1.0"?><workbook/>');
    const perEntry = Math.floor(DEFAULT_ZIP_PREFLIGHT_LIMITS.maxSingleEntryUncompressedBytes / 2);
    const entriesNeeded = Math.ceil(DEFAULT_ZIP_PREFLIGHT_LIMITS.maxTotalUncompressedBytes / perEntry) + 1;
    for (let i = 0; i < entriesNeeded && i < DEFAULT_ZIP_PREFLIGHT_LIMITS.maxEntryCount - 1; i++) {
      // STORE (no compression) keeps the ratio at ~1:1 so this test
      // exercises the total-size limit specifically, not the
      // compression-ratio limit (covered separately below).
      zip.file(`xl/part-${i}.xml`, Buffer.alloc(perEntry, 0x41), { compression: "STORE" });
    }
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await expect(preflightZipArchive(buffer)).rejects.toMatchObject({ reasonCode: "total_too_large" });
  });

  it("rejects a single entry whose compression ratio exceeds the configured maximum (zip-bomb shape) without decompressing it", async () => {
    const zip = new JSZip();
    zip.file("xl/workbook.xml", '<?xml version="1.0"?><workbook/>');
    zip.file("xl/bomb.xml", Buffer.alloc(50 * 1024 * 1024, 0), {
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const memBefore = process.memoryUsage().rss;
    await expect(preflightZipArchive(buffer)).rejects.toMatchObject({ reasonCode: "compression_ratio_too_high" });
    const memDeltaMb = (process.memoryUsage().rss - memBefore) / 1024 / 1024;
    expect(memDeltaMb).toBeLessThan(20);
  });

  it("accepts a tighter custom limit configuration when the archive fits within it", async () => {
    const buffer = await buildValidLikeZip();
    await expect(
      preflightZipArchive(buffer, {
        maxEntryCount: 5,
        maxSingleEntryUncompressedBytes: 1024,
        maxTotalUncompressedBytes: 2048,
        maxCompressionRatio: 1000,
      })
    ).resolves.toBeUndefined();
  });

  it("respects custom limits stricter than the default (rejects when the custom entry-count cap is exceeded)", async () => {
    const zip = new JSZip();
    zip.file("xl/workbook.xml", '<?xml version="1.0"?><workbook/>');
    zip.file("xl/one-more.xml", "x");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    await expect(
      preflightZipArchive(buffer, { ...DEFAULT_ZIP_PREFLIGHT_LIMITS, maxEntryCount: 1 })
    ).rejects.toMatchObject({ reasonCode: "too_many_entries" });
  });
});
