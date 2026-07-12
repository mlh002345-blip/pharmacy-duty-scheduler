import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { middleware } from "./middleware";
import { REQUEST_ID_HEADER } from "@/lib/observability/request-id-format";

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://example.com/eczaneler", { headers });
}

describe("middleware — request correlation ID only", () => {
  it("generates a fresh request ID when none is supplied", () => {
    const response = middleware(makeRequest());

    const responseId = response.headers.get(REQUEST_ID_HEADER);
    expect(responseId).toBeTruthy();
    expect(responseId).toMatch(/^[0-9a-f-]{36}$/i); // crypto.randomUUID() shape
  });

  it("preserves a valid, safely-formatted incoming request ID", () => {
    const incoming = "client-supplied-id-12345";
    const response = middleware(makeRequest({ [REQUEST_ID_HEADER]: incoming }));

    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(incoming);
  });

  it("replaces an oversized incoming request ID with a fresh one", () => {
    const tooLong = "a".repeat(200);
    const response = middleware(makeRequest({ [REQUEST_ID_HEADER]: tooLong }));

    const responseId = response.headers.get(REQUEST_ID_HEADER);
    expect(responseId).not.toBe(tooLong);
    expect(responseId!.length).toBeLessThan(200);
  });

  it("replaces an invalid-character incoming request ID with a fresh one", () => {
    const unsafe = "not safe; DROP TABLE users;--";
    const response = middleware(makeRequest({ [REQUEST_ID_HEADER]: unsafe }));

    const responseId = response.headers.get(REQUEST_ID_HEADER);
    expect(responseId).not.toBe(unsafe);
    expect(responseId).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("replaces a too-short incoming request ID with a fresh one", () => {
    const response = middleware(makeRequest({ [REQUEST_ID_HEADER]: "abc" }));

    expect(response.headers.get(REQUEST_ID_HEADER)).not.toBe("abc");
  });

  it("forwards the request ID to the downstream request headers, not just the response", () => {
    const response = middleware(makeRequest());
    const forwardedRequestHeaders = response.headers.get("x-middleware-request-x-request-id");

    // Next.js stashes rewritten request headers under this internal header
    // name when NextResponse.next({ request: { headers } }) is used.
    expect(forwardedRequestHeaders).toBe(response.headers.get(REQUEST_ID_HEADER));
  });
});

describe("middleware — Content-Security-Policy (production only)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not set a CSP header outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = middleware(makeRequest());
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("sets a CSP header with a nonce in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = middleware(makeRequest());
    const csp = response.headers.get("Content-Security-Policy");
    expect(csp).toBeTruthy();
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  });

  it("forwards the same CSP (and nonce) to the downstream request headers, not just the response", () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = middleware(makeRequest());
    const forwarded = response.headers.get("x-middleware-request-content-security-policy");
    expect(forwarded).toBe(response.headers.get("Content-Security-Policy"));
  });

  it("generates a different nonce on every request", () => {
    vi.stubEnv("NODE_ENV", "production");
    const cspA = middleware(makeRequest()).headers.get("Content-Security-Policy");
    const cspB = middleware(makeRequest()).headers.get("Content-Security-Policy");
    expect(cspA).not.toBe(cspB);
  });
});
