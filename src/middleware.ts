import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { REQUEST_ID_HEADER, isSafeRequestId } from "@/lib/observability/request-id-format";

// Request-correlation ID only — deliberately NOT an auth/authorization
// gate (that stays in src/lib/auth/guard.ts, per-layout and per-route-
// handler, unchanged by this file) and deliberately does not log every
// request (that would be noisy access logging this app doesn't want;
// individual failure/denial paths log themselves, with this ID attached,
// where they already handle an error).
//
// Runs on the Edge runtime, so crypto.randomUUID() comes from the Web
// Crypto API (globalThis.crypto), not Node's `node:crypto` module.
export function middleware(request: NextRequest) {
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  const requestId = isSafeRequestId(incoming) ? incoming : crypto.randomUUID();

  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({
    request: { headers: forwardedHeaders },
  });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
