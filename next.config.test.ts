import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

describe("next.config headers()", () => {
  it("applies the expected conservative security headers to every route", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");

    const headerMap = Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]));
    expect(headerMap["X-Frame-Options"]).toBe("DENY");
    expect(headerMap["X-Content-Type-Options"]).toBe("nosniff");
    expect(headerMap["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headerMap["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=()");
  });

  it("does not set Strict-Transport-Security or Content-Security-Policy (documented as future hardening)", async () => {
    const rules = await nextConfig.headers!();
    const keys = rules[0].headers.map((h) => h.key);
    expect(keys).not.toContain("Strict-Transport-Security");
    expect(keys).not.toContain("Content-Security-Policy");
  });
});
