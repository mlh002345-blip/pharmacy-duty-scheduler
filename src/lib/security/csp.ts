// Content-Security-Policy construction, isolated from middleware.ts so it
// can be unit-tested directly (Edge-runtime middleware itself is only
// exercised via NextRequest/NextResponse in middleware.test.ts).
//
// Scope of this policy, evidence-based (see docs/security/26-*.md and
// docs/security/28-*.md for the live-verified header matrix this closes):
// - No <script>/dangerouslySetInnerHTML/styled-jsx anywhere in src/ (grep-
//   confirmed) — Next.js's own injected bootstrap/hydration scripts are
//   the only inline scripts ever rendered, so a per-request nonce plus
//   'strict-dynamic' is sufficient for script-src without 'unsafe-inline'.
// - Several components legitimately set inline `style={{...}}` (computed
//   animation delays, progress-bar widths) — CSP has no nonce mechanism
//   for inline style *attributes* (only for <style> elements), so
//   style-src needs 'unsafe-inline'. This is a deliberate, narrower
//   allowance than script-src, not a broad opt-out.
// - No next/image, no external image/font domains, no client-side
//   fetch()/XHR anywhere in src/ (grep-confirmed) — img-src/font-src/
//   connect-src stay scoped to 'self'.
export function buildContentSecurityPolicy(nonce: string): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}

// Web Crypto (globalThis.crypto), available on both the Edge runtime and
// Node — no Buffer (Node-only, unavailable on the Edge runtime).
export function generateCspNonce(): string {
  return btoa(crypto.randomUUID());
}
