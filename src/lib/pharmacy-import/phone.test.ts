import { describe, expect, it } from "vitest";

import { normalizePhoneNumber, isValidDefaultAreaCode } from "./phone";

describe("normalizePhoneNumber", () => {
  it("normalizes a bare 7-digit number combined with a valid default area code", () => {
    const result = normalizePhoneNumber("212 19 18", "228");
    expect(result).toEqual({ ok: true, value: "+90 228 212 19 18" });
  });

  it("rejects a bare 7-digit number when no default area code is given", () => {
    const result = normalizePhoneNumber("2121918", null);
    expect(result).toEqual({ ok: false, errorCode: "missing_default_area_code" });
  });

  it("rejects a bare 7-digit number when the default area code is malformed", () => {
    const result = normalizePhoneNumber("2121918", "22");
    expect(result).toEqual({ ok: false, errorCode: "invalid_default_area_code" });
  });

  it("normalizes a 10-digit national number (area code + subscriber, no prefix)", () => {
    const result = normalizePhoneNumber("2122121918", "999");
    expect(result).toEqual({ ok: true, value: "+90 212 212 19 18" });
  });

  it("normalizes a 0-prefixed national number", () => {
    const result = normalizePhoneNumber("0212 212 19 18", null);
    expect(result).toEqual({ ok: true, value: "+90 212 212 19 18" });
  });

  it("normalizes a +90-prefixed number", () => {
    const result = normalizePhoneNumber("+90 212 212 19 18", null);
    expect(result).toEqual({ ok: true, value: "+90 212 212 19 18" });
  });

  it("normalizes a 90-prefixed number without the plus sign", () => {
    const result = normalizePhoneNumber("902122121918", null);
    expect(result).toEqual({ ok: true, value: "+90 212 212 19 18" });
  });

  it("never uses the default area code when the number already has one", () => {
    const result = normalizePhoneNumber("0212 212 19 18", "228");
    expect(result).toEqual({ ok: true, value: "+90 212 212 19 18" });
  });

  it("rejects a 10-digit number starting with 0 as ambiguous", () => {
    const result = normalizePhoneNumber("0212121918", null);
    // 10 raw digits starting with 0 is exactly the 11-digit
    // "0 + national" shape short by one digit — never guessed.
    expect(result).toEqual({ ok: false, errorCode: "unrecognized_phone_format" });
  });

  it("rejects an 8-digit number", () => {
    const result = normalizePhoneNumber("21212345", "228");
    expect(result).toEqual({ ok: false, errorCode: "unrecognized_phone_format" });
  });

  it("rejects a 6-digit number", () => {
    const result = normalizePhoneNumber("212345", "228");
    expect(result).toEqual({ ok: false, errorCode: "unrecognized_phone_format" });
  });

  it("rejects garbage input", () => {
    const result = normalizePhoneNumber("abc-def", "228");
    expect(result).toEqual({ ok: false, errorCode: "unrecognized_phone_format" });
  });

  it("rejects an empty string", () => {
    const result = normalizePhoneNumber("", "228");
    expect(result).toEqual({ ok: false, errorCode: "unrecognized_phone_format" });
  });
});

describe("isValidDefaultAreaCode", () => {
  it("accepts exactly 3 digits", () => {
    expect(isValidDefaultAreaCode("228")).toBe(true);
  });

  it("rejects fewer than 3 digits", () => {
    expect(isValidDefaultAreaCode("22")).toBe(false);
  });

  it("rejects more than 3 digits", () => {
    expect(isValidDefaultAreaCode("2281")).toBe(false);
  });

  it("rejects non-digit characters", () => {
    expect(isValidDefaultAreaCode("22a")).toBe(false);
  });
});
