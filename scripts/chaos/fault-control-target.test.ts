import { describe, expect, it } from "vitest";

import { validateFaultTarget } from "./fault-target";

describe("validateFaultTarget", () => {
  it("accepts an exact match with a recognized chaos marker", () => {
    expect(validateFaultTarget("pharmacy_duty_scheduler_chaos", "pharmacy_duty_scheduler_chaos")).toEqual({
      ok: true,
    });
  });

  it("rejects a database name that doesn't match the expected guarded target", () => {
    const result = validateFaultTarget("some_other_db", "pharmacy_duty_scheduler_chaos");
    expect(result.ok).toBe(false);
  });

  it("rejects even an exact match if it somehow lacks a chaos marker", () => {
    const result = validateFaultTarget("pharmacy_duty_scheduler", "pharmacy_duty_scheduler");
    expect(result.ok).toBe(false);
  });

  it("accepts any of the recognized marker words", () => {
    for (const marker of ["chaos", "resilience", "failure", "fault", "test", "testing", "staging"]) {
      const name = `pharmacy_${marker}`;
      expect(validateFaultTarget(name, name).ok).toBe(true);
    }
  });
});
