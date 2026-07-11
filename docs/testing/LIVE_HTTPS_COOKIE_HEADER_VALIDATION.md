# Live HTTPS, Session Cookie & Security Header Validation

Step 8 of the pre-pilot infrastructure and security test plan. Target:
`https://pharmacy-duty-scheduler-production.up.railway.app`.

## This pass could not complete live validation

Two independent attempts to reach the live Railway URL both failed for
environmental reasons, not application reasons:

1. This session's outbound network egress goes through a
   policy-enforcing proxy that returned `403 host_not_allowed` for
   `pharmacy-duty-scheduler-production.up.railway.app` — the proxy's own
   guidance is to never retry or route around an organization policy
   denial, only report it.
2. The user then offered to run curl commands themselves and relay the
   output, but their corporate computer does not permit running shell
   scripts, closing that path too.

Per explicit instruction for this pass: **no live results are invented.**
Every checklist item below is answered from one of three evidence
sources only, each labeled accordingly:

- **VERIFIED IN CODE** — the behavior is set unconditionally by
  application code (`next.config.ts`, `src/lib/auth/session.ts`,
  `src/middleware.ts`, etc.) and unit-tested against that code directly
  (not against a live HTTP response).
- **VERIFIED LOCALLY** — proven by a real HTTP round-trip against a real
  **production build** (`next build && next start`, `NODE_ENV=production`)
  running locally, via the existing Step 4 Playwright E2E suite
  (`tests/e2e/specs/*.spec.ts`, `npm run test:e2e`). This is strong
  evidence for anything the app itself controls, but cannot observe
  anything Railway's edge/reverse-proxy/TLS-termination layer does,
  since there is no real TLS or real Railway infrastructure in front of
  a local server.
- **NOT LIVE VERIFIED** — cannot be determined without a real request to
  the deployed Railway domain. Listed explicitly, not silently assumed.

## Why "VERIFIED LOCALLY" is meaningful evidence here

`playwright.config.ts` deliberately runs the E2E suite against a real
production build, not `next dev`, specifically so that
`NODE_ENV=production`-gated behavior (like the session cookie's `Secure`
flag) is genuinely exercised rather than merely read as a declared
config value. Chromium treats `http://localhost` as a secure context
even without real TLS, so a `Secure`-flagged cookie set over local plain
HTTP is still genuinely stored and round-tripped by the browser in these
tests — this is real cookie-jar behavior, not a mocked assertion. See
`docs/testing/ROLE_SESSION_E2E_TESTS.md` for the original design
rationale, which already documented (before this Step 8 attempt) that
this local evidence does not extend to Railway's real TLS termination or
edge proxy behavior.

## Checklist results

### 1. HTTP → HTTPS redirect

**NOT LIVE VERIFIED.** This is entirely a Railway edge/platform
behavior — the repository contains no code that would produce this
redirect itself (no `next.config.ts` redirect rule, no middleware
check for `x-forwarded-proto`). `next start` alone does not enforce
HTTPS. Whether Railway's edge redirects plain HTTP to HTTPS for this
service cannot be determined from the codebase.

### 2. TLS certificate and supported protocol behavior

**NOT LIVE VERIFIED.** Entirely infrastructure-managed (Railway's TLS
termination), not application code. No repository file configures a
certificate, cipher suite, or minimum TLS version.

### 3/4. Security headers on `/`, `/giris`, `/vatandas`, an authenticated
dashboard page, a 404 page, and a controlled error response

| Header | Status |
|---|---|
| `X-Frame-Options: DENY` | **VERIFIED IN CODE** — `next.config.ts`'s `headers()` applies this to `source: "/:path*"` (every route). Asserted in `next.config.test.ts`. |
| `X-Content-Type-Options: nosniff` | **VERIFIED IN CODE** — same `headers()` rule, same test. |
| `Referrer-Policy: strict-origin-when-cross-origin` | **VERIFIED IN CODE** — same rule/test. |
| `Permissions-Policy: camera=(), microphone=(), geolocation=()` | **VERIFIED IN CODE** — same rule/test. |
| `X-Frame-Options` / CSP `frame-ancestors` | **VERIFIED IN CODE** (as `X-Frame-Options: DENY` above) — no CSP is set at all, so `frame-ancestors` doesn't apply; framing protection currently rests entirely on `X-Frame-Options`, which is not honored by every browser context CSP's `frame-ancestors` would cover (documented gap, not new to this pass — see `docs/security/14-configuration-environment-hardening.md`). |
| `Content-Security-Policy` | **VERIFIED IN CODE as intentionally absent.** `next.config.ts`'s own header comment and `next.config.test.ts`'s second test explicitly assert this header is *not* set — a deliberate, previously-documented decision (Step "Configuration & Environment Hardening", `docs/security/14-configuration-environment-hardening.md`), not an oversight rediscovered here. |
| `Strict-Transport-Security` | **VERIFIED IN CODE as intentionally absent** at the application layer, for the same documented reason (irreversibility of HSTS once cached, can't confirm from the repo that every current/future custom domain always terminates HTTPS). **Whether Railway's edge adds it independently is NOT LIVE VERIFIED** — this is exactly the open question Step 8 was meant to close and could not. |
| `Cache-Control` | **NOT LIVE VERIFIED, and no prior local evidence either.** No repository code sets `Cache-Control` explicitly anywhere (`grep` confirms zero matches for `Cache-Control` in `src/` or `next.config.ts`); the actual value seen by a client depends on Next.js's own per-route-type defaults (which differ for static vs. dynamic vs. authenticated routes) plus whatever Railway's edge/CDN layer does on top — neither was exercised by the Step 4 E2E suite, which never asserted on this header. This is a genuine gap, not merely an infrastructure-only item. |
| `x-request-id` | **VERIFIED IN CODE and VERIFIED LOCALLY.** `src/middleware.ts` sets this header (`REQUEST_ID_HEADER = "x-request-id"`, `src/lib/observability/request-id-format.ts`) on every response, generating a fresh UUID via Web Crypto when the incoming request doesn't already carry a safely-formatted one. `tests/e2e/specs/export-routes.spec.ts` asserts `response.headers()["x-request-id"]` is truthy on real local production-build HTTP responses for both the Excel and PDF export routes. |

**Per-page coverage of the four `X-Frame-Options`/`X-Content-Type-Options`/
`Referrer-Policy`/`Permissions-Policy` headers**: the `next.config.ts`
rule's `source: "/:path*"` matches every route with no exclusion, so the
same VERIFIED IN CODE status applies uniformly to `/`, `/giris`,
`/vatandas`, every authenticated dashboard page, and Next.js's default
404 page (no custom `not-found.tsx` exists — confirmed by directory
listing — so the framework's own default 404 handling applies, which
still passes through the same global `headers()` rule since it isn't
route-specific). A genuinely live-only distinction would only appear if
Railway's edge strips or overrides these headers for certain response
types, which is exactly the part that is **NOT LIVE VERIFIED**.

### 5. Login and `Set-Cookie` inspection

| Attribute | Status |
|---|---|
| `HttpOnly` | **VERIFIED IN CODE** (`src/lib/auth/session.ts`: `httpOnly: true`, unconditional) **and VERIFIED LOCALLY** (`tests/e2e/specs/session-cookie-and-logout.spec.ts` asserts `sessionCookie.httpOnly === true` against a real cookie set by a real local production-build HTTP response). |
| `Secure` | **VERIFIED IN CODE** (`secure: process.env.NODE_ENV === "production"`) **and VERIFIED LOCALLY** — the same E2E test asserts `sessionCookie.secure === true`, genuinely exercised because Chromium treats `localhost` as a secure context (see rationale above). **Whether this flag survives Railway's real edge/TLS-termination layer unmodified is NOT LIVE VERIFIED.** |
| `SameSite=Lax` | **VERIFIED IN CODE** (`sameSite: "lax"`) **and VERIFIED LOCALLY** (same test: `sessionCookie.sameSite === "Lax"`). |
| `Path=/` | **VERIFIED IN CODE** (`path: "/"`) **and VERIFIED LOCALLY** (same test: `sessionCookie.path === "/"`). |
| `Max-Age`/`Expires` | **VERIFIED IN CODE** — `expires: expiresAt` where `expiresAt = now + 7 days` (`SESSION_DURATION_MS`), unconditional. Not separately re-asserted by the E2E cookie test (which checks the other four flags), but the same `createSession()` call path is exercised by every login in every E2E test, and `tests/e2e/specs/session-expiry.spec.ts` separately proves the 7-day boundary is enforced server-side (an expiring-just-before-now session is rejected; an unexpired 7-day session is accepted) against the real database, independent of the cookie's own declared expiry. |
| No `Domain` overreach | **VERIFIED IN CODE** — `cookieStore.set()`'s options object never sets a `domain` key, so the cookie defaults to host-only scope (no `Domain` attribute emitted at all, meaning the browser confines it to the exact host that set it, never subdomains). Not independently re-checked by a live wildcard-subdomain probe, but there is no code path capable of emitting a `Domain` value in the first place. |

### 6. Old cookie fails after logout

**VERIFIED IN CODE and VERIFIED LOCALLY.** `destroySession()`
(`src/lib/auth/session.ts`) deletes the matching `Session` row from the
database (`prisma.session.deleteMany({ where: { token } })`) *before*
clearing the browser cookie — so rejection is a real server-side state
change, not merely "the browser forgot the cookie." `getCurrentUser()`
looks the token up fresh on every request; a token with no matching
`Session` row returns `null`, and `requireUser()` redirects to
`/giris`.

`tests/e2e/specs/session-cookie-and-logout.spec.ts`'s second test proves
this end-to-end against a real local production build: logs in, records
the token, confirms the `Session` row exists, clicks the real "Çıkış
Yap" button, confirms the `Session` row is genuinely gone from the
database (not just that the browser cookie was cleared), then
**re-injects the exact old cookie value via `context.addCookies()`** and
navigates to a protected page — confirming the server rejects it and
redirects to `/giris`. It also proves the cycle is repeatable (login →
logout → login again produces a different token → logout again also
succeeds).

**Whether Railway's edge caches or otherwise re-serves a stale
authenticated response after logout (bypassing the app's own real-time
DB check) is NOT LIVE VERIFIED** — though the `Cache-Control` gap noted
above makes this a genuine open question rather than a purely
theoretical one, since there is no confirmed `no-store`/`private`
directive protecting authenticated responses from being cached anywhere
in the path.

### 7. Railway edge does not strip or weaken `Set-Cookie`

**NOT LIVE VERIFIED.** This can only be observed by inspecting the
actual `Set-Cookie` header a browser or `curl` receives after passing
through Railway's real edge — impossible without live access.

### 8. No stack trace, SQL, internal host, `DATABASE_URL`, session token,
or framework debug detail leaks

**VERIFIED IN CODE and VERIFIED LOCALLY**, for everything the
application itself controls:

- No `src/` code (outside the seed script, which never runs against
  Railway production) calls `console.*` with request data, errors, or
  PII (confirmed by repo-wide grep in the earlier
  `docs/security/04-secrets-sensitive-data-exposure.md` pass, re-checked
  for this step).
- Any exception not explicitly caught and translated to a Turkish
  message falls through to Next.js's own default production error
  boundary, which does not expose stack traces, SQL queries, or internal
  file paths — this is Next.js's documented framework behavior for
  `next build`/`next start` (`NODE_ENV=production`), not custom
  application code, but it is exactly what runs in production and is
  exactly what `next start` (Railway's own start command per
  `docs/DEPLOYMENT.md`) invokes.
- `tests/e2e/specs/mutation-and-hidden-controls.spec.ts` asserts a raw
  anonymous `POST /bolgeler` response body contains none of
  `"at Object."`, `"node_modules"`, or `"PrismaClient"`.
- `tests/e2e/specs/public-private-separation.spec.ts` asserts an invalid
  public duty-request token renders a real, controlled "Bağlantı
  Geçersiz" page (HTTP 200, by design — not Next.js's raw 404) whose
  HTML contains neither `"PrismaClient"` nor `"at Object."`.
- `tests/e2e/specs/session-cookie-and-logout.spec.ts` asserts the
  rendered dashboard's body text never contains the raw session token,
  the plaintext password, or the string `"passwordHash"`.
- The three `error.message` pass-throughs found in the codebase
  (`gecmis-nobetler/actions.ts` ×2, `cizelgeler/actions.ts` ×1) are all
  from the app's own controlled error classes
  (`HistoricalExcelParseError`, etc.) with pre-written, non-sensitive
  Turkish messages — not raw exception/stack messages.
- **What Railway's edge itself might inject into an error response
  (e.g. its own platform-level error page for an upstream crash, or
  request metadata in its own logs) is NOT LIVE VERIFIED** and is
  outside this repository's control either way.

## Environment setup (for a future live attempt)

1. Confirm network access to
   `https://pharmacy-duty-scheduler-production.up.railway.app` from the
   testing machine (this pass failed at exactly this step, twice, for
   two different unrelated reasons — verify this first).
2. Use only the seeded demo account documented in `README.md` /
   `docs/DEMO_SCRIPT.md` (`admin@example.com` / `Admin123!`) for any
   login/logout check — never a real pilot credential.
3. Do not create, edit, publish, delete, import, or export any business
   record — only navigate/read pages and perform login/logout.
4. Suggested commands once network access exists: `curl -D -` for
   header/redirect inspection, `openssl s_client -connect
   <host>:443 -servername <host> | openssl x509 -noout -dates -subject
   -issuer` for the certificate, and a real login performed through a
   browser (Next.js Server Actions require the page's own hidden
   action-id field, which changes per build, making a hand-crafted
   `curl` login request impractical — a real browser or a scripted
   browser automation tool is the practical path).

## Local vs. Railway limitations (summary)

Everything this app's own code controls — cookie flags, security
headers set via `next.config.ts`, request-id propagation, error-message
redaction, session invalidation on logout — has real evidence behind it
(either VERIFIED IN CODE, VERIFIED LOCALLY, or both). Everything that
depends on Railway's edge/TLS/reverse-proxy layer — the HTTP→HTTPS
redirect, the TLS certificate/protocol itself, whether `Set-Cookie` or
any header survives the edge unmodified, and `Cache-Control` behavior —
remains genuinely unknown until a real request reaches the real
deployed domain. This is not a new gap introduced by this pass; it was
already called out as "Production-only checks still required" in
`docs/testing/ROLE_SESSION_E2E_TESTS.md` (Step 4) and
`docs/testing/LOGIN_RATE_LIMIT_PROXY_TEST.md` (Step "Login rate-limit &
proxy validation"), and remains open after this attempt too.

## Administrator/user guidance

No user-facing guidance changes result from this pass — no code was
changed (see "Findings" in
`docs/security/26-live-https-cookie-header-validation.md`: the static
review found no concrete defect, only confirmed pre-existing, already-
documented gaps that require a live check to resolve either way).
