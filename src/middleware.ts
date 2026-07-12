import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { REQUEST_ID_HEADER, isSafeRequestId } from "@/lib/observability/request-id-format";
import { buildContentSecurityPolicy, generateCspNonce } from "@/lib/security/csp";

const CSP_HEADER = "Content-Security-Policy";

// Request-correlation ID, plus (production only) a per-request CSP
// nonce — deliberately NOT an auth/authorization gate (that stays in
// src/lib/auth/guard.ts, per-layout and per-route-handler, unchanged by
// this file) and deliberately does not log every request (that would be
// noisy access logging this app doesn't want; individual failure/denial
// paths log themselves, with this ID attached, where they already
// handle an error).
//
// Runs on the Edge runtime, so crypto.randomUUID() comes from the Web
// Crypto API (globalThis.crypto), not Node's `node:crypto` module.
//
// CSP is generated here (not next.config.ts's static headers()) because
// the nonce must be fresh per request — forwarded on the request headers
// too (not just the response) so Next.js's own script-tag renderer picks
// up the same nonce value for the bootstrap/hydration scripts it injects
// (documented Next.js App Router behavior: it reads the nonce back off
// its own request-scoped CSP header). Gated to NODE_ENV=production, the
// same convention already used for the session cookie's `Secure` flag
// (src/lib/auth/session.ts) — avoids interfering with `next dev`'s HMR
// websocket or requiring every local/test run to reason about a nonce.
export function middleware(request: NextRequest) {
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  const requestId = isSafeRequestId(incoming) ? incoming : crypto.randomUUID();

  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set(REQUEST_ID_HEADER, requestId);

  const isProduction = process.env.NODE_ENV === "production";
  let csp: string | undefined;
  if (isProduction) {
    csp = buildContentSecurityPolicy(generateCspNonce());
    forwardedHeaders.set(CSP_HEADER, csp);
  }

  const response = NextResponse.next({
    request: { headers: forwardedHeaders },
  });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  if (csp) {
    response.headers.set(CSP_HEADER, csp);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
