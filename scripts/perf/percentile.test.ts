import { describe, expect, it } from "vitest";

import { compareDurations, computeDurationStats, percentile } from "./percentile";

describe("percentile", () => {
  it("returns the single value for a one-element array at any percentile", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it("computes p50 for a known small dataset", () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(values, 50)).toBe(50);
  });

  it("computes p95 for a known small dataset", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(values, 95)).toBe(95);
  });

  it("is order-independent (unsorted input)", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const shuffled = [7, 2, 9, 4, 1, 10, 5, 8, 3, 6];
    expect(percentile(shuffled, 50)).toBe(percentile(sorted, 50));
  });

  it("throws on an empty array", () => {
    expect(() => percentile([], 50)).toThrow();
  });
});

describe("computeDurationStats", () => {
  it("computes min/max/mean correctly", () => {
    const stats = computeDurationStats([10, 20, 30]);
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(30);
    expect(stats.mean).toBe(20);
    expect(stats.count).toBe(3);
  });

  it("returns null p99 below the minimum sample-size threshold", () => {
    const stats = computeDurationStats([1, 2, 3, 4, 5]);
    expect(stats.p99).toBeNull();
  });

  it("returns a real p99 at or above the minimum sample-size threshold", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    const stats = computeDurationStats(values);
    expect(stats.p99).not.toBeNull();
    expect(stats.p99).toBe(99);
  });

  it("throws on an empty array", () => {
    expect(() => computeDurationStats([])).toThrow();
  });
});

describe("compareDurations", () => {
  it("classifies a large increase as a regression", () => {
    const result = compareDurations("p95", 100, 150);
    expect(result.verdict).toBe("regression");
    expect(result.deltaPercent).toBeCloseTo(50, 5);
  });

  it("classifies a large decrease as an improvement", () => {
    const result = compareDurations("p95", 200, 100);
    expect(result.verdict).toBe("improvement");
    expect(result.deltaPercent).toBeCloseTo(-50, 5);
  });

  it("classifies a small change within the noise threshold as no-change", () => {
    const result = compareDurations("p95", 100, 105);
    expect(result.verdict).toBe("no-change");
  });

  it("handles a zero baseline without dividing by zero", () => {
    const result = compareDurations("p95", 0, 10);
    expect(result.deltaPercent).toBe(0);
    expect(Number.isFinite(result.deltaPercent)).toBe(true);
  });
});
