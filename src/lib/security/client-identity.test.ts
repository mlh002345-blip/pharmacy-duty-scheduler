import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const headerStore = new Map<string, string>();
const headers = vi.fn(async () => ({
  get: (name: string) => headerStore.get(name.toLowerCase()) ?? null,
}));

vi.mock("next/headers", () => ({
  headers: () => headers(),
}));

const { getClientIdentity, isTrustProxyHeadersEnabled, normalizeClientIp } = await import(
  "./client-identity"
);

const ORIGINAL_TRUST_PROXY_HEADERS = process.env.TRUST_PROXY_HEADERS;

function setHeader(name: string, value: string) {
  headerStore.set(name.toLowerCase(), value);
}

beforeEach(() => {
  headerStore.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  if (ORIGINAL_TRUST_PROXY_HEADERS === undefined) delete process.env.TRUST_PROXY_HEADERS;
  else process.env.TRUST_PROXY_HEADERS = ORIGINAL_TRUST_PROXY_HEADERS;
});

describe("normalizeClientIp", () => {
  it("accepts a plain IPv4 address", () => {
    expect(normalizeClientIp("203.0.113.5")).toBe("203.0.113.5");
  });

  it("accepts an IPv4:port pair and strips the port", () => {
    expect(normalizeClientIp("203.0.113.5:54321")).toBe("203.0.113.5");
  });

  it("accepts a bare IPv6 address and lowercases it", () => {
    expect(normalizeClientIp("2001:DB8::1")).toBe("2001:db8::1");
  });

  it("accepts a bracketed IPv6:port pair", () => {
    expect(normalizeClientIp("[2001:db8::1]:443")).toBe("2001:db8::1");
  });

  it("rejects a malformed value", () => {
    expect(normalizeClientIp("not-an-ip-address")).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(normalizeClientIp("   ")).toBeNull();
  });

  it("rejects an oversized value", () => {
    expect(normalizeClientIp("1".repeat(200))).toBeNull();
  });
});

describe("isTrustProxyHeadersEnabled", () => {
  it("is false by default", () => {
    delete process.env.TRUST_PROXY_HEADERS;
    expect(isTrustProxyHeadersEnabled()).toBe(false);
  });

  it("is false for any value other than the literal string \"true\"", () => {
    process.env.TRUST_PROXY_HEADERS = "1";
    expect(isTrustProxyHeadersEnabled()).toBe(false);
  });

  it("is true only for the literal string \"true\"", () => {
    process.env.TRUST_PROXY_HEADERS = "true";
    expect(isTrustProxyHeadersEnabled()).toBe(true);
  });
});

describe("getClientIdentity — trusted proxy mode disabled (default)", () => {
  beforeEach(() => {
    delete process.env.TRUST_PROXY_HEADERS;
  });

  it("never reads x-forwarded-for and returns the fixed untrusted bucket", async () => {
    setHeader("x-forwarded-for", "1.2.3.4");

    const identity = await getClientIdentity();

    expect(identity.trusted).toBe(false);
    expect(headers).not.toHaveBeenCalled();
  });

  it("returns the same bucket key across different (spoofed) forwarded values", async () => {
    setHeader("x-forwarded-for", "1.2.3.4");
    const first = await getClientIdentity();
    setHeader("x-forwarded-for", "9.9.9.9");
    const second = await getClientIdentity();

    expect(first.networkBucketKey).toBe(second.networkBucketKey);
    expect(first.trusted).toBe(false);
    expect(second.trusted).toBe(false);
  });

  it("the untrusted bucket key is a SHA-256 hex digest, never a raw IP", async () => {
    const identity = await getClientIdentity();
    expect(identity.networkBucketKey).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.networkBucketKey).not.toContain("1.2.3.4");
  });
});

describe("getClientIdentity — trusted proxy mode enabled", () => {
  beforeEach(() => {
    process.env.TRUST_PROXY_HEADERS = "true";
  });

  it("trusts the LAST entry of a valid x-forwarded-for chain", async () => {
    setHeader("x-forwarded-for", "203.0.113.9, 10.0.0.1");

    const identity = await getClientIdentity();

    expect(identity.trusted).toBe(true);
    expect(identity.networkBucketKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces a stable bucket key for the same trusted IP across calls", async () => {
    setHeader("x-forwarded-for", "203.0.113.9");
    const first = await getClientIdentity();
    setHeader("x-forwarded-for", "203.0.113.9");
    const second = await getClientIdentity();

    expect(first.networkBucketKey).toBe(second.networkBucketKey);
  });

  it("produces different bucket keys for different trusted IPs", async () => {
    setHeader("x-forwarded-for", "203.0.113.9");
    const first = await getClientIdentity();
    setHeader("x-forwarded-for", "203.0.113.10");
    const second = await getClientIdentity();

    expect(first.networkBucketKey).not.toBe(second.networkBucketKey);
  });

  it("falls back to untrusted when the header is missing", async () => {
    const identity = await getClientIdentity();
    expect(identity.trusted).toBe(false);
  });

  it("falls back to untrusted when the header value is malformed", async () => {
    setHeader("x-forwarded-for", "not-an-ip-at-all");
    const identity = await getClientIdentity();
    expect(identity.trusted).toBe(false);
  });

  it("falls back to untrusted when the header value is oversized", async () => {
    setHeader("x-forwarded-for", `${"1.2.3.4, ".repeat(200)}9.9.9.9`);
    const identity = await getClientIdentity();
    expect(identity.trusted).toBe(false);
  });

  it("falls back to untrusted when headers() throws (no request context)", async () => {
    headers.mockRejectedValueOnce(new Error("no request context"));
    const identity = await getClientIdentity();
    expect(identity.trusted).toBe(false);
  });

  it("normalizes a trusted IPv6 address", async () => {
    setHeader("x-forwarded-for", "2001:DB8::1");
    const identity = await getClientIdentity();
    expect(identity.trusted).toBe(true);
  });
});
