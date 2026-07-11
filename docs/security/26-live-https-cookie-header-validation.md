# Live HTTPS, Cookie & Header Validation

Date: 2026-07-11, branch `deploy/postgresql-demo`. Pre-pilot test plan,
Step 8.

## Scope and why this is a static/code-based review

Step 8 asked for live validation of TLS, redirects, security headers,
and `Set-Cookie` behavior against the real deployed Railway URL
(`https://pharmacy-duty-scheduler-production.up.railway.app`). Two
independent paths to reach that URL both failed for environmental
reasons: this session's egress proxy denies the host outright
(`403 host_not_allowed`, an organization policy decision this session
must not retry or route around), and the user's own corporate machine
does not permit running the shell script that would have relayed
results back. **No live HTTP request was made to the Railway domain at
any point in this pass, and no live result is invented anywhere in this
document.** Full methodology and per-item evidence are in
`docs/testing/LIVE_HTTPS_COOKIE_HEADER_VALIDATION.md`; this document
summarizes findings using the same three-tier evidence labels:
**VERIFIED IN CODE**, **VERIFIED LOCALLY** (real HTTP against a real
local production build, via Step 4's Playwright E2E suite), and
**NOT LIVE VERIFIED**.

## Baseline findings

No new code was inspected that hadn't already been covered by earlier
pre-pilot passes (`docs/security/02-authentication-session-handling.md`,
`docs/security/04-secrets-sensitive-data-exposure.md`,
`docs/security/14-configuration-environment-hardening.md`,
`docs/security/21-login-rate-limit-proxy-validation.md`). This pass
re-confirmed those findings still hold and organized them specifically
against Step 8's checklist, rather than discovering new application
behavior.

## Vulnerabilities found

**None.** The static review found no concrete defect in application
code. Every item that came back "not fully resolved" is either (a) a
pre-existing, already-documented, deliberate scope decision (no CSP, no
app-layer HSTS — see `docs/security/14-configuration-environment-hardening.md`)
or (b) a genuine dependency on Railway's edge/TLS layer that simply
cannot be assessed without a live request, not a code defect. Per this
pass's instruction, **no code was changed**, since changing code without
concrete evidence of a defect would risk exactly the kind of unverified,
speculative "fix" the task explicitly warned against.

## TLS result

**NOT LIVE VERIFIED.** No certificate, cipher, or protocol-version
configuration exists anywhere in this repository — TLS termination is
entirely Railway's responsibility. Cannot be assessed statically.

## HTTP→HTTPS redirect result

**NOT LIVE VERIFIED.** No redirect rule exists in `next.config.ts`, no
middleware checks `x-forwarded-proto`, and `next start` does not itself
enforce HTTPS. This is entirely a Railway edge behavior.

## Security-header matrix

| Header | Applies to | Status |
|---|---|---|
| `X-Frame-Options: DENY` | every route (`source: "/:path*"`) | VERIFIED IN CODE |
| `X-Content-Type-Options: nosniff` | every route | VERIFIED IN CODE |
| `Referrer-Policy: strict-origin-when-cross-origin` | every route | VERIFIED IN CODE |
| `Permissions-Policy: camera=(), microphone=(), geolocation=()` | every route | VERIFIED IN CODE |
| `Content-Security-Policy` | — | VERIFIED IN CODE as intentionally absent (documented, pre-existing decision, not rediscovered here) |
| `Strict-Transport-Security` (app layer) | — | VERIFIED IN CODE as intentionally absent (same documented decision) |
| `Strict-Transport-Security` (Railway edge) | — | NOT LIVE VERIFIED — the actual open question |
| `Cache-Control` | — | **NOT LIVE VERIFIED, and no prior local evidence** — no app code sets it, and Step 4's E2E suite never asserted on it; genuinely unknown, not merely infrastructure-gated |
| `x-request-id` | every route (`src/middleware.ts`) | VERIFIED IN CODE and VERIFIED LOCALLY (`tests/e2e/specs/export-routes.spec.ts`) |

## Cookie attributes

| Attribute | Status |
|---|---|
| `HttpOnly` | VERIFIED IN CODE + VERIFIED LOCALLY |
| `Secure` | VERIFIED IN CODE (NODE_ENV-gated) + VERIFIED LOCALLY (genuinely round-tripped via Chromium's localhost-secure-context exception, not just declared); survival through Railway's real edge is NOT LIVE VERIFIED |
| `SameSite=Lax` | VERIFIED IN CODE + VERIFIED LOCALLY |
| `Path=/` | VERIFIED IN CODE + VERIFIED LOCALLY |
| `Max-Age`/`Expires` (7 days) | VERIFIED IN CODE; boundary enforcement VERIFIED LOCALLY via `tests/e2e/specs/session-expiry.spec.ts` (server-side DB check, independent of the cookie's own declared expiry) |
| No `Domain` overreach | VERIFIED IN CODE — `cookieStore.set()` never sets a `domain` option, so no `Domain` attribute is ever emitted |

## Logout / old-cookie result

**VERIFIED IN CODE + VERIFIED LOCALLY.** `destroySession()` deletes the
`Session` row from the database before clearing the cookie; every
subsequent request re-validates the token against the database (not a
signed/stateless token), so a stale cookie fails server-side, not just
client-side. `tests/e2e/specs/session-cookie-and-logout.spec.ts`
re-injects the exact old cookie value after a real logout and confirms
the server redirects to `/giris` — proving DB-backed rejection, not
merely "the browser forgot the cookie." Whether Railway's edge could
serve a cached authenticated response after logout, bypassing this
real-time check, is **NOT LIVE VERIFIED** (and is a somewhat open
question given the `Cache-Control` gap above).

## Railway edge behavior

**NOT LIVE VERIFIED**, across every item that depends on it: whether it
redirects HTTP→HTTPS, whether it strips/rewrites `Set-Cookie`, what TLS
certificate/protocols it presents, and whether it adds
`Strict-Transport-Security` or any other header on top of what the app
sets. This mirrors an already-documented, still-open item from an
earlier pass: `docs/security/21-login-rate-limit-proxy-validation.md`
similarly could not verify Railway's edge behavior for
`X-Forwarded-For` header trust, and explicitly gates enabling
`TRUST_PROXY_HEADERS=true` on that live check happening first. Step 8
adds no new resolution to either open question.

## Issues found and fixes

**None.** No concrete defect was found by this static review, so per
the task's explicit instruction, no code was changed. The genuine gaps
identified (`Cache-Control` never explicitly set; CSP/HSTS deliberately
absent at the app layer; Railway edge behavior entirely unverified) are
pre-existing and already tracked as future-hardening items in
`docs/security/14-configuration-environment-hardening.md`, not new
findings from this pass — this pass's contribution is organizing them
explicitly against Step 8's specific checklist and confirming (via
code + Step 4's local evidence) that nothing *new* is wrong.

## Remaining risks (production-only)

1. **TLS termination and certificate validity** — entirely unverified
   against the real domain.
2. **HTTP→HTTPS redirect** — entirely unverified; if absent, a client
   connecting over plain HTTP would either fail closed (if the `Secure`
   cookie is simply never stored, a broken-login failure mode) or,
   worse, transmit credentials/cookies in the clear if Railway's edge
   somehow accepts and proxies plain HTTP through to the app.
3. **`Set-Cookie` integrity through Railway's edge** — unverified;
   header-stripping edge proxies are a known class of misconfiguration
   this repo cannot detect from the inside.
4. **`Strict-Transport-Security` at the edge** — unverified whether
   Railway adds this independently of the app's own deliberate
   omission.
5. **`Cache-Control` on authenticated responses** — no explicit
   directive exists anywhere in this codebase; unverified whether
   Next.js's own defaults plus Railway's edge/CDN layer ever cache an
   authenticated page in a way a shared/public cache could later replay
   to a different user. This is the one item from this pass that is not
   purely an "infrastructure I can't see" gap — it's an actual code gap
   (no explicit `Cache-Control` header set) compounded by an
   infrastructure unknown, and is worth prioritizing in a future pass.
6. **`X-Forwarded-For` / client-IP trust** (adjacent, previously
   documented) — `TRUST_PROXY_HEADERS` remains unset/`false` pending the
   same kind of live Railway check this pass also couldn't complete; see
   `docs/security/21-login-rate-limit-proxy-validation.md`.

## Pilot-readiness conclusion

Every cookie/header/error-handling behavior the **application itself**
controls is correct by code inspection and confirmed by real local HTTP
evidence against a genuine production build (Step 4's E2E suite) — no
regression or new defect was found. What remains open is exclusively
the Railway edge/TLS layer, which this pass could not reach twice, for
two unrelated environmental reasons, and which no prior pass has been
able to verify either (the same gap was already flagged after Step 4
and after the login rate-limit pass). This is a **verification gap, not
a known vulnerability** — but it should be closed with an actual live
check (from a network location that can reach the Railway domain)
before treating HTTPS/cookie/header behavior as pilot-ready, since the
one thing a live check would add — proof that Railway's edge doesn't
undo any of the correct application-layer behavior documented here — is
exactly the kind of silent, infrastructure-level regression that code
review cannot catch.
