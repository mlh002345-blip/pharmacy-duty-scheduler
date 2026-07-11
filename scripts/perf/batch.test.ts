import { describe, expect, it } from "vitest";

import { chunk } from "./batch";

describe("chunk", () => {
  it("splits evenly divisible arrays", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it("puts the remainder in a final smaller chunk", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single chunk when size exceeds array length", () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });

  it("returns an empty array for an empty input", () => {
    expect(chunk([], 5)).toEqual([]);
  });

  it("never returns a chunk larger than size", () => {
    const chunks = chunk(Array.from({ length: 10_007 }, (_, i) => i), 2_000);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(2_000);
    expect(chunks.flat()).toHaveLength(10_007);
  });

  it("throws for a non-positive size", () => {
    expect(() => chunk([1, 2], 0)).toThrow();
    expect(() => chunk([1, 2], -1)).toThrow();
  });
});
