import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy, generateCspNonce } from "./csp";

describe("generateCspNonce", () => {
  it("generates a non-empty base64 string", () => {
    const nonce = generateCspNonce();
    expect(nonce.length).toBeGreaterThan(0);
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("generates a fresh value on every call", () => {
    const a = generateCspNonce();
    const b = generateCspNonce();
    expect(a).not.toBe(b);
  });
});

describe("buildContentSecurityPolicy", () => {
  it("embeds the given nonce in script-src alongside 'strict-dynamic', with no 'unsafe-inline' for scripts", () => {
    const csp = buildContentSecurityPolicy("test-nonce-123");
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src"));
    expect(scriptSrc).toBe("script-src 'self' 'nonce-test-nonce-123' 'strict-dynamic'");
    expect(scriptSrc).not.toContain("unsafe-inline");
  });

  it("allows 'unsafe-inline' only for style-src (inline style={{}} attributes have no nonce mechanism)", () => {
    const csp = buildContentSecurityPolicy("n");
    const styleSrc = csp.split("; ").find((d) => d.startsWith("style-src"));
    expect(styleSrc).toBe("style-src 'self' 'unsafe-inline'");
  });

  it("restricts default-src, img-src, font-src, and connect-src to 'self' (no external domains used anywhere in the app)", () => {
    const csp = buildContentSecurityPolicy("n");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("img-src 'self'");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("connect-src 'self'");
  });

  it("blocks framing, plugins, and base-tag/form-action redirection", () => {
    const csp = buildContentSecurityPolicy("n");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it("produces a different script-src for a different nonce, and nothing else changes", () => {
    const cspA = buildContentSecurityPolicy("aaa");
    const cspB = buildContentSecurityPolicy("bbb");
    expect(cspA).not.toBe(cspB);
    const withoutNonceA = cspA.replace("aaa", "NONCE");
    const withoutNonceB = cspB.replace("bbb", "NONCE");
    expect(withoutNonceA).toBe(withoutNonceB);
  });
});
