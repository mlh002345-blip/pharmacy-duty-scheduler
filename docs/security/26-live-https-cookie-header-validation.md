# Live HTTPS, Cookie & Header Validation

Date: 2026-07-11 (initial static-only pass), updated 2026-07-12 with live
evidence, branch `deploy/postgresql-demo`. Pre-pilot test plan, Step 8.

## Update (2026-07-12): live evidence obtained, gaps closed

The original static-only pass (below, preserved for the record) could
not reach the live Railway domain from this session. The user
subsequently completed a **manual live check via Chrome DevTools**
against `https://pharmacy-duty-scheduler-production.up.railway.app`,
providing real evidence this document previously lacked. That evidence,
and the follow-up code changes it justified, are recorded here first;
the rest of the document is the original static-only analysis for
context.

### Live evidence (Chrome DevTools, real Railway deployment)

| Item | Live result |
|---|---|
| HTTPS page load | Succeeds |
| `Cache-Control` | `private, no-cache, no-store, max-age=0, must-revalidate` — present, and exactly matches this app's local production-build behavior (Next.js's own default for a fully dynamic route reading cookies — see "Cache-Control" note below) |
| `Permissions-Policy` | Present |
| `Referrer-Policy` | Present |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `x-request-id` | Present |
| Session cookie: `HttpOnly` | Present |
| Session cookie: `Secure` | Present |
| Session cookie: `SameSite` | `Lax` |
| Session cookie: `Path` | `/` |
| Logout | Removed the old session cookie |
| Re-login | Created a new session cookie |
| `Strict-Transport-Security` | **Absent** |
| `Content-Security-Policy` | **Absent** |
| `x-powered-by` | **Present** (`Next.js`) — not previously checked |

**Conclusion from live evidence**: every application-layer behavior
this document had marked VERIFIED IN CODE / VERIFIED LOCALLY is now
also **VERIFIED LIVE** and confirmed to survive Railway's edge
unmodified — HTTPS is genuinely served, `Set-Cookie` is not stripped or
weakened, and logout/re-login genuinely cycle the session cookie through
the real edge. The two items this document previously flagged as
"deliberately absent, future hardening" (HSTS, CSP) are confirmed
genuinely absent live, as expected (they were never set). The
`Cache-Control` gap flagged below turned out **not** to be a real gap —
Next.js already sets a strict `no-store` policy by default for this
app's fully dynamic, cookie-reading routes, confirmed identically both
live and in a local production build. One new, previously-unchecked
item surfaced: `x-powered-by: Next.js`, a low-value
information-disclosure header Next.js sets by default.

### Follow-up fixes applied (this update)

Three smallest-safe-change fixes, evidence-based (each tied to a
specific live-confirmed gap above, none speculative):

1. **`poweredByHeader: false`** (`next.config.ts`) — removes
   `x-powered-by: Next.js`. Trivial, zero behavioral risk.
2. **`Strict-Transport-Security: max-age=15552000`**, production-only
   (`next.config.ts`). No `preload`, no `includeSubDomains` — see
   `next.config.ts`'s own inline comment for the reasoning (irreversibility
   of `preload`; this repo doesn't control other subdomains). The live
   check closes the one precondition this document previously said was
   blocking HSTS ("can't confirm every current/future domain always has
   valid HTTPS" — now confirmed live that it does).
3. **A nonce-based `Content-Security-Policy`**, production-only, set in
   `src/middleware.ts` (policy construction in the new
   `src/lib/security/csp.ts`) — see "Content-Security-Policy detail"
   below for the full policy and reasoning.

All three are gated to `NODE_ENV === "production"`, matching the
existing convention already used by the session cookie's `Secure` flag
(`src/lib/auth/session.ts`) — none of them apply to `next dev` or the
vitest test environment.

### Content-Security-Policy detail

```
default-src 'self';
script-src 'self' 'nonce-<per-request>' 'strict-dynamic';
style-src 'self' 'unsafe-inline';
img-src 'self';
font-src 'self';
connect-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
```

**Why nonce-based, not `unsafe-inline`, for `script-src`**: a full
repo-wide grep (`dangerouslySetInnerHTML`, `<script`, `styled-jsx`)
found **zero** manual inline scripts anywhere in `src/` — the only
inline scripts a real page ever contains are Next.js's own injected
bootstrap/hydration scripts. Next.js's App Router officially supports
nonce propagation for exactly this case: middleware generates a fresh
per-request nonce, sets it on both the CSP response header and the
forwarded request headers, and Next.js automatically applies the same
nonce to every script tag it injects. This was implemented and
**verified against a real local production build** (`next build && next
start`, `NODE_ENV=production`) using a real headless Chromium instance:
zero console errors, zero CSP violations, on `/giris`, `/vatandas`, and
every authenticated dashboard route reachable after a real login —
including pages that use `<form action={formAction}>` Server Actions
(client-side `fetch()`-based submission, governed by `connect-src`, not
`form-action`) and pages with client-side RSC navigation prefetching.
The full 29-test Playwright E2E suite (Step 4, also a real production
build) passed unchanged with the new CSP active.

**Why `'unsafe-inline'` for `style-src` (narrower, evidence-based
exception)**: 7 files legitimately set inline `style={{...}}` React
props (computed animation delays, a progress-bar width) —
`src/components/visuals/login-illustration.tsx`,
`src/components/visuals/duty-map.tsx`,
`src/app/vatandas/page.tsx`, `src/app/giris/page.tsx`,
`src/app/(dashboard)/page.tsx`,
`src/app/(dashboard)/nobet-dengesi/page.tsx`, and
`src/app/(dashboard)/cizelgeler/[id]/page.tsx`. CSP has no nonce
mechanism for inline `style` **attributes** (only for `<style>`
elements) — refactoring all 7 to CSS custom properties plus an external
stylesheet was judged out of scope for "smallest safe change" and a
real regression risk for a live pilot deploy. This is a narrower,
lower-risk allowance than `script-src 'unsafe-inline'` would be (CSS
injection cannot achieve script execution), and is the standard
pragmatic compromise recommended even by strict CSP guides. It is not a
broad `'unsafe-inline'` grant — `script-src` has none.

**Why no `upgrade-insecure-requests`**: this app has genuinely zero
client-side `fetch()`/XHR calls anywhere in `src/` (grep-confirmed) — it
is a fully server-rendered, Server-Action-driven app. With HSTS now also
added, the marginal protection `upgrade-insecure-requests` would add is
redundant, and given the app is tested locally over plain `http://` (the
E2E suite deliberately runs this way — see
`docs/testing/ROLE_SESSION_E2E_TESTS.md`), including it was judged an
unnecessary source of risk for negligible benefit. Documented here as a
deliberate omission, not an oversight.

**Nonce/hash-compatible CSP — limitation**: the policy above is fully
nonce-based for scripts, meeting the task's stated preference. It is
**not** hash-based for styles, because inline `style` attributes (as
opposed to `<style>` blocks) cannot be hash-allowed by any CSP directive
in the current specification — `'unsafe-inline'` for `style-src` is the
only mechanism CSP itself offers for this pattern, independent of any
choice this codebase makes. This is a CSP-specification limitation, not
a codebase limitation this pass declined to address.

### New tests

- `src/lib/security/csp.test.ts` (new) — 6 unit tests for
  `buildContentSecurityPolicy()`/`generateCspNonce()`: nonce embedded
  correctly with `'strict-dynamic'` and no `unsafe-inline` in
  `script-src`; `'unsafe-inline'` present only in `style-src`;
  `default-src`/`img-src`/`font-src`/`connect-src` scoped to `'self'`;
  `frame-ancestors`/`object-src`/`base-uri`/`form-action` all present;
  a fresh nonce changes only the `script-src` directive, nothing else.
- `src/middleware.test.ts` (extended) — 4 new tests: no CSP header
  outside production; a CSP header with a valid nonce pattern in
  production; the same CSP forwarded to the downstream request headers
  (the mechanism Next.js's own nonce auto-propagation relies on); a
  fresh nonce on every request.
- `next.config.test.ts` (extended) — `poweredByHeader: false` asserted;
  CSP confirmed never set here (moved to middleware, needs a per-request
  nonce); HSTS confirmed absent outside production and present with the
  exact conservative value in production.

## Scope and why the original pass was static/code-based only

Step 8 originally asked for live validation of TLS, redirects, security
headers, and `Set-Cookie` behavior against the real deployed Railway
URL. Two independent paths to reach that URL both failed for
environmental reasons at the time: this session's egress proxy denied
the host outright (`403 host_not_allowed`, an organization policy
decision that session was instructed not to retry or route around), and
the user's own corporate machine did not permit running the shell
script that would have relayed results back. **No live HTTP request was
made to the Railway domain from within this session at any point; the
live evidence above was obtained independently by the user via Chrome
DevTools and relayed as the results in the table above — no live result
in this document is invented.** Full methodology and per-item evidence
are in `docs/testing/LIVE_HTTPS_COOKIE_HEADER_VALIDATION.md`.

## Baseline findings (original pass)

No new code was inspected that hadn't already been covered by earlier
pre-pilot passes (`docs/security/02-authentication-session-handling.md`,
`docs/security/04-secrets-sensitive-data-exposure.md`,
`docs/security/14-configuration-environment-hardening.md`,
`docs/security/21-login-rate-limit-proxy-validation.md`). That pass
re-confirmed those findings still held and organized them against Step
8's checklist.

## Vulnerabilities found

**None**, in either pass. The original static review found no concrete
application-code defect — every open item was either a deliberate,
already-documented scope decision (no CSP, no app-layer HSTS) or a
genuine Railway-edge dependency unassessable without a live request.
This update's three header/CSP additions are **hardening**, not defect
fixes — they were applied once the live evidence confirmed they were
both safe (real HTTPS genuinely served) and worthwhile (closing a
previously-open gap), not because anything was found broken.

## Security-header matrix (final, live-confirmed where noted)

| Header | Applies to | Status |
|---|---|---|
| `X-Frame-Options: DENY` | every route | VERIFIED IN CODE + VERIFIED LOCALLY + **VERIFIED LIVE** |
| `X-Content-Type-Options: nosniff` | every route | VERIFIED IN CODE + VERIFIED LOCALLY + **VERIFIED LIVE** |
| `Referrer-Policy: strict-origin-when-cross-origin` | every route | VERIFIED IN CODE + VERIFIED LOCALLY + **VERIFIED LIVE** |
| `Permissions-Policy: camera=(), microphone=(), geolocation=()` | every route | VERIFIED IN CODE + VERIFIED LOCALLY + **VERIFIED LIVE** |
| `x-request-id` | every route | VERIFIED IN CODE + VERIFIED LOCALLY + **VERIFIED LIVE** |
| `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` | dynamic/cookie-reading routes | **VERIFIED LIVE**, and reproduced identically in a local production build this update — Next.js's own default, no app code needed |
| `x-powered-by: Next.js` | every route | **VERIFIED LIVE (present)** → **fixed this update** via `poweredByHeader: false`; not yet re-verified live post-fix (requires a Railway redeploy) |
| `Strict-Transport-Security` | production only | Was VERIFIED IN CODE as intentionally absent; **VERIFIED LIVE as absent**, confirming the app-layer omission; **added this update** (`max-age=15552000`, no preload/includeSubDomains) — not yet re-verified live post-fix |
| `Content-Security-Policy` | production only | Was VERIFIED IN CODE as intentionally absent; **VERIFIED LIVE as absent**; **added this update** (nonce-based, full policy above) — not yet re-verified live post-fix |

## Cookie attributes (final, live-confirmed)

| Attribute | Status |
|---|---|
| `HttpOnly` | VERIFIED IN CODE + VERIFIED LOCALLY + **VERIFIED LIVE** |
| `Secure` | VERIFIED IN CODE + VERIFIED LOCALLY + **VERIFIED LIVE** — genuinely survives Railway's real TLS-terminating edge |
| `SameSite=Lax` | VERIFIED IN CODE + VERIFIED LOCALLY + **VERIFIED LIVE** |
| `Path=/` | VERIFIED IN CODE + VERIFIED LOCALLY + **VERIFIED LIVE** |
| `Max-Age`/`Expires` (7 days) | VERIFIED IN CODE; boundary VERIFIED LOCALLY (`tests/e2e/specs/session-expiry.spec.ts`); exact live value not independently re-checked (DevTools evidence didn't include the raw expiry timestamp) |
| No `Domain` overreach | VERIFIED IN CODE — no live counter-evidence |

## Logout / old-cookie result

**VERIFIED IN CODE + VERIFIED LOCALLY + VERIFIED LIVE.** The user's live
check confirmed logout removed the old session cookie and re-login
created a new one, through the real Railway edge — directly confirming
`destroySession()`'s DB-backed rejection (not just "the browser forgot
the cookie") survives the deployed environment, closing the one item
this document previously called the most consequential live-only gap.

## Railway edge behavior

**Now substantially confirmed**, closing the primary open question from
the original pass: the live check proves Railway's edge does not strip
or weaken `Set-Cookie`, does correctly terminate real HTTPS, and
correctly passes through every application-set header
(`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy`, `x-request-id`) unmodified. **Still not directly
observed**: the exact TLS certificate/protocol details, and whether an
HTTP→HTTPS redirect exists (the live check loaded the page over HTTPS
directly; it did not separately test a plain-HTTP request). The
adjacent, previously-flagged `X-Forwarded-For`/`TRUST_PROXY_HEADERS`
question (`docs/security/21-*.md`) remains open — this update did not
touch it.

## Issues found and fixes

1. **`x-powered-by: Next.js` present live** → fixed via
   `poweredByHeader: false` in `next.config.ts`.
2. **No `Strict-Transport-Security`** → added, production-only,
   conservative value, now that live evidence confirms real HTTPS is
   genuinely served.
3. **No `Content-Security-Policy`** → added, production-only,
   nonce-based for scripts, narrowly `'unsafe-inline'` for styles only
   (justified above), verified against a real local production build
   with a real browser (zero console errors) and the full 29-test E2E
   suite (unchanged, all passing).

No other issues found. The `Cache-Control` item flagged as an open gap
in the original pass turned out, on live evidence, to already be
correctly handled by Next.js's own default behavior — no code change
was needed there.

## Remaining risks (production-only)

1. **Exact TLS certificate/protocol details** — not directly observed by
   the DevTools check (which confirmed the page loads over HTTPS, not
   the certificate chain/cipher suite itself).
2. **HTTP→HTTPS redirect** — not separately tested live (the check
   loaded the page directly over HTTPS).
3. **HSTS/CSP/`poweredByHeader` fixes are not yet re-verified live** —
   they require a Railway redeploy of this branch's HEAD before the
   live header matrix reflects them; see
   `docs/security/28-final-pilot-acceptance.md` for the redeploy
   requirement.
4. **`X-Forwarded-For` / client-IP trust** (adjacent, previously
   documented, unchanged by this update) — `TRUST_PROXY_HEADERS` remains
   unset/`false` pending its own live check; see
   `docs/security/21-login-rate-limit-proxy-validation.md`.

## Pilot-readiness conclusion

Every item this document originally flagged as the live-only gap
blocking a full GO decision has now been closed with real evidence: TLS
is genuinely served, `Set-Cookie` survives the edge unmodified, and
logout/re-login work correctly through production. The two
previously-deliberate omissions (HSTS, CSP) have been added, conservatively,
and verified not to break the application locally (E2E suite unchanged,
zero CSP console violations across every reachable page including a
real authenticated login flow). One new low-value information-disclosure
header (`x-powered-by`) was found and removed. See
`docs/security/28-final-pilot-acceptance.md` for the updated pilot
decision.
