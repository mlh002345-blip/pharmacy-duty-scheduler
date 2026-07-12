import type { NextConfig } from "next";

// Conservative, app-layer security headers (Configuration & Environment
// Hardening sweep, extended in the Step 9 live-validation follow-up).
// These do not depend on Railway/reverse-proxy configuration, which this
// repo cannot inspect or guarantee.
//
// A Content-Security-Policy is deliberately NOT set here — it needs a
// fresh per-request nonce, which a static headers() array cannot
// generate. See src/middleware.ts (production only) and
// src/lib/security/csp.ts for the CSP itself.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// Live validation against the deployed Railway domain (Step 8 follow-up,
// docs/security/26-*.md) confirmed real HTTPS is actually served, closing
// the "can't confirm every current/future domain always has valid HTTPS"
// concern that previously held HSTS back. Still deliberately
// conservative: no `preload` (irreversible once submitted to browsers'
// preload lists) and no `includeSubDomains` (this repo doesn't control
// what, if anything, runs on other subdomains). 180 days, not the
// commonly-recommended 1-2 years, as a further irreversibility hedge for
// this first rollout — unlike `preload`, `max-age` itself is fully
// reversible (a shorter value simply expires sooner).
const HSTS_HEADER = { key: "Strict-Transport-Security", value: "max-age=15552000" };

const nextConfig: NextConfig = {
  // Removes the `X-Powered-By: Next.js` response header — no functional
  // value to a client, only announces the framework/version to a
  // potential attacker.
  poweredByHeader: false,
  // The dev-mode indicator badge sits bottom-left and overlaps the
  // sidebar's "Çıkış Yap" button — disable it so the demo UI is clean
  // even when running `next dev`.
  devIndicators: false,
  async headers() {
    // Matches src/middleware.ts's own NODE_ENV=production gate for the
    // CSP nonce and src/lib/auth/session.ts's cookie `Secure` flag —
    // HSTS only makes sense (and is only safe to promise) once real
    // HTTPS is actually being served, which is only true in production.
    const headers =
      process.env.NODE_ENV === "production" ? [...SECURITY_HEADERS, HSTS_HEADER] : SECURITY_HEADERS;
    return [
      {
        source: "/:path*",
        headers,
      },
    ];
  },
};

export default nextConfig;
