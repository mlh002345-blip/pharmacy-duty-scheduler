import { describe, expect, it } from "vitest";

import { escapeExcelCell } from "./excel-safety";

describe("escapeExcelCell", () => {
  it('prefixes "=HYPERLINK(...)" with a single quote', () => {
    expect(escapeExcelCell('=HYPERLINK("http://evil","x")')).toBe(
      "'=HYPERLINK(\"http://evil\",\"x\")"
    );
  });

  it('prefixes "+SUM(...)" with a single quote', () => {
    expect(escapeExcelCell("+SUM(1,2)")).toBe("'+SUM(1,2)");
  });

  it('prefixes "-1+2" with a single quote', () => {
    expect(escapeExcelCell("-1+2")).toBe("'-1+2");
  });

  it('prefixes "@cmd" with a single quote', () => {
    expect(escapeExcelCell("@cmd")).toBe("'@cmd");
  });

  it("leaves normal text unchanged", () => {
    expect(escapeExcelCell("Deva Eczanesi")).toBe("Deva Eczanesi");
  });

  it("leaves numbers unchanged", () => {
    expect(escapeExcelCell(42)).toBe(42);
  });

  it("leaves null/undefined unchanged", () => {
    expect(escapeExcelCell(null)).toBe(null);
    expect(escapeExcelCell(undefined)).toBe(undefined);
  });

  it("leaves Date values unchanged", () => {
    const date = new Date();
    expect(escapeExcelCell(date)).toBe(date);
  });

  it("leaves an empty string unchanged", () => {
    expect(escapeExcelCell("")).toBe("");
  });

  it("escapes based on the trimmed leading character (leading whitespace)", () => {
    expect(escapeExcelCell("  =1+1")).toBe("'  =1+1");
  });
});
