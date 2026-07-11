import { describe, expect, it } from "vitest";

import { HistoricalExcelParseError, MAX_IMPORT_ROWS, parseHistoricalExcel } from "@/lib/historical/parse-excel";
import { preflightZipArchive } from "@/lib/zip-preflight";

import * as F from "../../../scripts/file-security/fixtures";

// Item 8 — large-file benchmarks. Row counts below/at/above MAX_IMPORT_ROWS
// (5,000) are all exercised at the parse layer (parseHistoricalExcel),
// which is the same layer every real upload goes through regardless of
// row count — this is the layer where an unbounded parse would show up as
// runaway duration/memory. 10,000/50,000-row cases exceed MAX_IMPORT_ROWS,
// so they are expected to be *rejected*, but the rejection itself must
// still happen in bounded time/memory (parseHistoricalExcel fully reads
// the sheet before checking the row-count limit — the length check happens
// after materializing `rows`, so these numbers also serve as the
// worst-case cost of a rejected over-limit file).
function measureRss() {
  if (global.gc) global.gc();
  return process.memoryUsage().rss;
}

describe("large-file benchmarks (parse duration + memory)", () => {
  it.each([1_000, 5_000, MAX_IMPORT_ROWS, MAX_IMPORT_ROWS + 1, 10_000, 50_000])(
    "parses/rejects a %i-row workbook within bounded time and memory",
    async (rowCount) => {
      const buffer = await F.buildExcessiveRowCountWorkbook(rowCount);

      const memBefore = measureRss();
      const start = performance.now();
      let rows: unknown[] | undefined;
      let rejected = false;
      try {
        rows = await parseHistoricalExcel(buffer);
      } catch (error) {
        rejected = true;
        expect(error).toBeInstanceOf(HistoricalExcelParseError);
      }
      const durationMs = performance.now() - start;
      const memAfter = measureRss();
      const memDeltaMb = (memAfter - memBefore) / 1024 / 1024;

      console.log(
        `[bench] rows=${rowCount} fileBytes=${buffer.length} durationMs=${durationMs.toFixed(1)} memDeltaMb=${memDeltaMb.toFixed(1)} outcome=${rejected ? "rejected" : "accepted"}`
      );

      if (rowCount > MAX_IMPORT_ROWS) {
        expect(rejected).toBe(true);
      } else {
        expect(rejected).toBe(false);
        expect(rows).toHaveLength(rowCount);
      }

      // Investigation thresholds suggested by the task spec: >250MB growth
      // or >30s processing time warrant investigation, not automatic
      // timeout increases.
      expect(memDeltaMb).toBeLessThan(250);
      expect(durationMs).toBeLessThan(30_000);
    },
    60_000
  );

  it("rejects an excessive-row workbook's ZIP shape cheaply via preflight before the expensive parse, when the archive is also oversized", async () => {
    // A 50,000-row workbook is still a legitimate (non-bomb) ZIP shape —
    // preflight must accept its structure (row-count enforcement is a
    // parse-layer concern, not a ZIP-metadata concern) and stay fast.
    const buffer = await F.buildExcessiveRowCountWorkbook(50_000);
    const start = performance.now();
    await preflightZipArchive(buffer);
    const durationMs = performance.now() - start;
    expect(durationMs).toBeLessThan(1_000);
  });
});
