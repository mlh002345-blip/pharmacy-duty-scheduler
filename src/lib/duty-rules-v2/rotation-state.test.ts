import { describe, expect, it } from "vitest";

import { parseCarriedForward } from "./rotation-state";

describe("RotationState.carriedForward validation", () => {
  it("accepts an empty list and treats null/undefined as empty", () => {
    expect(parseCarriedForward([])).toEqual([]);
    expect(parseCarriedForward(null)).toEqual([]);
    expect(parseCarriedForward(undefined)).toEqual([]);
  });

  it("accepts a minimal valid entry", () => {
    const parsed = parseCarriedForward([
      { membershipId: "m1", reason: "SKIPPED", periodKey: "2026-07" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].reason).toBe("SKIPPED");
  });

  it("rejects unknown reasons, missing fields, and non-array blobs", () => {
    expect(() =>
      parseCarriedForward([{ membershipId: "m1", reason: "OTHER", periodKey: "x" }])
    ).toThrow();
    expect(() => parseCarriedForward([{ reason: "SKIPPED", periodKey: "x" }])).toThrow();
    expect(() => parseCarriedForward({ arbitrary: "config" })).toThrow();
  });

  it("caps the list size (this is a small carry ledger, not a blob)", () => {
    const entries = Array.from({ length: 501 }, (_, i) => ({
      membershipId: `m${i}`,
      reason: "SKIPPED" as const,
      periodKey: "2026-07",
    }));
    expect(() => parseCarriedForward(entries)).toThrow();
  });
});
