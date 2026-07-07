import { describe, expect, it } from "vitest";

import { classifyBalance, meanOf, formatPoints } from "./balance-status";

describe("balance status helpers", () => {
  it("classifies against the mean with a ±15% tolerance", () => {
    expect(classifyBalance(10, 10)).toBe("BALANCED");
    expect(classifyBalance(8, 10)).toBe("LOW");
    expect(classifyBalance(12, 10)).toBe("HIGH");
    expect(classifyBalance(8.6, 10)).toBe("BALANCED");
    expect(classifyBalance(11.4, 10)).toBe("BALANCED");
    expect(classifyBalance(5, 0)).toBe("BALANCED");
  });

  it("computes the mean and formats points for display", () => {
    expect(meanOf([1, 2, 3])).toBe(2);
    expect(meanOf([])).toBe(0);
    expect(formatPoints(1.256)).toBe("1,26");
    expect(formatPoints(5)).toBe("5");
  });
});
