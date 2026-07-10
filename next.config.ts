import type { NextConfig } from "next";

// Conservative, app-layer security headers (Configuration & Environment
// Hardening sweep). These do not depend on Railway/reverse-proxy
// configuration, which this repo cannot inspect or guarantee.
//
// Strict-Transport-Security is deliberately NOT set here: HSTS —
// especially with `preload` — is effectively irreversible once a
// browser has cached it, and this repo cannot confirm from the codebase
// alone that every current/future custom domain in front of this app
// always has valid HTTPS (see docs/security/14-configuration-environment-hardening.md).
// Left as a documented future-hardening item instead of risking a
// misconfigured deployment locking users out over HTTP.
//
// A Content-Security-Policy is also deliberately NOT set here — Next.js's
// build output (inline bootstrap scripts, hashed asset URLs) needs a
// CSP tuned specifically to what `next build` actually emits, and
// getting that wrong breaks the app outright. Documented as future
// hardening rather than guessed at in this pass.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // The dev-mode indicator badge sits bottom-left and overlaps the
  // sidebar's "Çıkış Yap" button — disable it so the demo UI is clean
  // even when running `next dev`.
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
