import { describe, expect, it } from "vitest";

import { isSafeHttpUrl, safeHttpUrlSchema } from "./safe-url";

describe("isSafeHttpUrl", () => {
  it("accepts an https URL", () => {
    expect(isSafeHttpUrl("https://maps.google.com/?q=eczane")).toBe(true);
  });

  it("accepts an http URL", () => {
    expect(isSafeHttpUrl("http://example.com")).toBe(true);
  });

  it("rejects javascript: URLs", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
  });

  it("rejects data: URLs", () => {
    expect(isSafeHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects vbscript: URLs", () => {
    expect(isSafeHttpUrl("vbscript:msgbox(1)")).toBe(false);
  });

  it("rejects malformed strings", () => {
    expect(isSafeHttpUrl("not a url")).toBe(false);
  });
});

describe("safeHttpUrlSchema", () => {
  const schema = safeHttpUrlSchema();

  it("accepts https://maps.google.com/...", () => {
    expect(schema.safeParse("https://maps.google.com/?q=eczane").success).toBe(true);
  });

  it("accepts http://...", () => {
    expect(schema.safeParse("http://example.com").success).toBe(true);
  });

  it("rejects javascript:alert(1)", () => {
    expect(schema.safeParse("javascript:alert(1)").success).toBe(false);
  });

  it("rejects data:text/html,...", () => {
    expect(schema.safeParse("data:text/html,<script>alert(1)</script>").success).toBe(false);
  });

  it("rejects vbscript:...", () => {
    expect(schema.safeParse("vbscript:msgbox(1)").success).toBe(false);
  });
});

describe("pharmacySchema.mapUrl (empty string allowed via union)", () => {
  it("empty string is a valid literal alongside the http/https schema", async () => {
    const { pharmacySchema } = await import("./pharmacy");
    const base = {
      name: "Test Eczanesi",
      pharmacistName: "Test Eczacı",
      phone: "0212 000 00 00",
      address: "Test Mah.",
      city: "İstanbul",
      district: "Kadıköy",
      regionId: "region-1",
      isActive: true,
    };
    expect(pharmacySchema.safeParse({ ...base, mapUrl: "" }).success).toBe(true);
    expect(
      pharmacySchema.safeParse({ ...base, mapUrl: "https://maps.google.com" }).success
    ).toBe(true);
    expect(
      pharmacySchema.safeParse({ ...base, mapUrl: "javascript:alert(1)" }).success
    ).toBe(false);
  });
});
