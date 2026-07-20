import { describe, expect, it } from "vitest";

import { dateAtUtcMidnight } from "./date-tr";
import {
  MAX_GENERATION_MONTHS_AHEAD,
  isWithinGenerationHorizon,
  maxAllowedGenerationPeriodStart,
} from "./generation-horizon";

describe("maxAllowedGenerationPeriodStart", () => {
  it("defaults to MAX_GENERATION_MONTHS_AHEAD months past the reference month, at day 1", () => {
    const reference = dateAtUtcMidnight(2026, 3, 15);
    const max = maxAllowedGenerationPeriodStart(reference);
    expect(max).toEqual(dateAtUtcMidnight(2026, 3 + MAX_GENERATION_MONTHS_AHEAD, 1));
  });

  it("rolls over into the next year correctly", () => {
    const reference = dateAtUtcMidnight(2026, 11, 20);
    const max = maxAllowedGenerationPeriodStart(reference, 2);
    expect(max).toEqual(dateAtUtcMidnight(2027, 1, 1));
  });

  it("rolls over multiple years for a larger monthsAhead", () => {
    const reference = dateAtUtcMidnight(2026, 6, 1);
    const max = maxAllowedGenerationPeriodStart(reference, 20);
    expect(max).toEqual(dateAtUtcMidnight(2028, 2, 1));
  });

  it("with monthsAhead=0, only the reference month itself is the ceiling", () => {
    const reference = dateAtUtcMidnight(2026, 7, 20);
    const max = maxAllowedGenerationPeriodStart(reference, 0);
    expect(max).toEqual(dateAtUtcMidnight(2026, 7, 1));
  });
});

describe("isWithinGenerationHorizon", () => {
  const reference = dateAtUtcMidnight(2026, 7, 20);

  it("allows the current month", () => {
    expect(isWithinGenerationHorizon(dateAtUtcMidnight(2026, 7, 1), reference)).toBe(true);
  });

  it("allows exactly MAX_GENERATION_MONTHS_AHEAD months ahead", () => {
    expect(
      isWithinGenerationHorizon(
        dateAtUtcMidnight(2026, 7 + MAX_GENERATION_MONTHS_AHEAD, 1),
        reference
      )
    ).toBe(true);
  });

  it("rejects one month beyond the horizon", () => {
    expect(
      isWithinGenerationHorizon(
        dateAtUtcMidnight(2026, 7 + MAX_GENERATION_MONTHS_AHEAD + 1, 1),
        reference
      )
    ).toBe(false);
  });

  it("rejects a period far in the future (e.g. a whole year ahead, the churn scenario)", () => {
    expect(isWithinGenerationHorizon(dateAtUtcMidnight(2027, 6, 1), reference)).toBe(false);
  });

  it("allows a past period (this function only enforces an upper bound)", () => {
    expect(isWithinGenerationHorizon(dateAtUtcMidnight(2025, 1, 1), reference)).toBe(true);
  });

  it("respects a custom monthsAhead override", () => {
    expect(isWithinGenerationHorizon(dateAtUtcMidnight(2026, 12, 1), reference, 5)).toBe(true);
    expect(isWithinGenerationHorizon(dateAtUtcMidnight(2027, 1, 1), reference, 5)).toBe(false);
  });
});
