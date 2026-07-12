import { afterEach, describe, expect, it, vi } from "vitest";

import nextConfig from "./next.config";

describe("next.config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("disables the X-Powered-By header", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  describe("headers()", () => {
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

    it("never sets Content-Security-Policy here (it needs a per-request nonce, generated in middleware instead)", async () => {
      const rules = await nextConfig.headers!();
      const keys = rules[0].headers.map((h) => h.key);
      expect(keys).not.toContain("Content-Security-Policy");
    });

    it("does not set Strict-Transport-Security outside production", async () => {
      vi.stubEnv("NODE_ENV", "development");
      const rules = await nextConfig.headers!();
      const keys = rules[0].headers.map((h) => h.key);
      expect(keys).not.toContain("Strict-Transport-Security");
    });

    it("sets a conservative Strict-Transport-Security header in production (no preload, no includeSubDomains)", async () => {
      vi.stubEnv("NODE_ENV", "production");
      const rules = await nextConfig.headers!();
      const headerMap = Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]));
      expect(headerMap["Strict-Transport-Security"]).toBe("max-age=15552000");
      expect(headerMap["Strict-Transport-Security"]).not.toContain("preload");
      expect(headerMap["Strict-Transport-Security"]).not.toContain("includeSubDomains");
    });
  });
});
