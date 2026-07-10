# Role & Session E2E Validation

Date: 2026-07-10, same branch (`deploy/postgresql-demo`). Pre-pilot test
plan, Step 4.

## Scope

Every prior protocol in this repository that touched authorization
(`docs/security/03-authorization-idor-sweep.md`) or session/auth
(`docs/security/02-authentication-session-handling.md`,
`docs/security/06-concurrency-race-conditions.md`,
`docs/security/21-login-rate-limit-proxy-validation.md`) proved its
findings via **mocked-Prisma unit tests** — direct function calls with
`vi.mock("@/lib/prisma")`, never a real HTTP request through a real
browser against a real database. This pass adds that missing layer: 29
real Playwright tests, driving a real production build of the app
against a real, disposable PostgreSQL database, asserting both
browser-visible behavior (URLs, visible Turkish text, HTTP status/
content-type) and persisted database state (row counts, session/user
status, audit-log rows) for every scenario. See
`docs/testing/ROLE_SESSION_E2E_TESTS.md` for the full architecture and
exact matrices.

## Threats covered

- **Direct URL access bypassing UI-level hiding** — a user with a valid
  session but insufficient role navigating straight to an admin-only or
  setup-mutation URL.
- **Stale-session reuse after logout, password change, or
  deactivation** — an attacker (or a leftover browser tab) attempting to
  use a session token that should no longer be valid.
- **Session fixation** — an attacker planting a known cookie value in a
  victim's browser before the victim logs in, hoping the server adopts
  it as the post-login session.
- **Session-expiry boundary manipulation** — whether a session exactly
  at its expiry instant is treated as valid or invalid, and whether that
  matches the code's actual comparison operator.
- **Anonymous access to protected export/download routes and to
  dashboard-shaped URLs via a raw (non-Server-Action) HTTP request.**
- **Public/private boundary leakage** — whether the public,
  unauthenticated `/vatandas` and `/eczane-talep/[token]` surfaces could
  be used to reach dashboard content, submit a request for a pharmacy
  other than the one derived from the token, or leak admin-only fields.
- **Account-existence/status enumeration via the login form** — already
  fixed in protocol 02; re-verified end-to-end here through a real
  browser submission against a real inactive account, not just a mocked
  `loginAction` call.

## Tests implemented

29 tests across 9 spec files (`tests/e2e/specs/`):

| File | Tests | Covers |
|---|---|---|
| `route-access-matrix.spec.ts` | 5 | ADMIN/STAFF/VIEWER/ANONYMOUS/INACTIVE_USER direct-URL access across every listed route |
| `mutation-and-hidden-controls.spec.ts` | 7 | Page-gated mutation attempts (user/pharmacy create-edit), hidden-control proof for publish/review/delete, anonymous export GET, anonymous raw POST |
| `session-cookie-and-logout.spec.ts` | 2 | Cookie attributes, logout + old-cookie rejection + repeatable logout |
| `password-change-invalidation.spec.ts` | 1 | Two-context password-change invalidation, audit log, no secret in logs |
| `user-deactivation.spec.ts` | 1 | Real-time deactivation rejection, generic re-login failure message |
| `session-expiry.spec.ts` | 4 | Just-before/exactly-at/just-after expiry boundary, unexpired-accepted + no-cleanup-on-read |
| `session-fixation.spec.ts` | 1 | Attacker-planted cookie never adopted; fresh token per login; unissued token rejected |
| `export-routes.spec.ts` | 4 | All three download routes × ADMIN/STAFF/VIEWER/anonymous, `x-request-id` presence |
| `public-private-separation.spec.ts` | 4 | `/vatandas`, valid/invalid token, no pharmacyId field, no dashboard leakage |

## Controls proven

- `src/lib/auth/permissions.ts`'s role matrix is enforced server-side
  for every route in the matrix — not merely reflected in hidden UI
  controls — for real navigations through a real browser.
- `destroySession()` genuinely deletes the `Session` row on logout;
  re-presenting the exact old cookie value afterward is rejected because
  the row is gone, not because the browser forgot it.
- `invalidateUserSessions()` (called on password change) genuinely
  invalidates **every** session for that user, including ones opened
  from a different browser context that never initiated the change —
  confirmed via two independent, real, DB-backed session tokens.
- The self-password-change flow's exact documented behavior
  (`clearSessionCookie()` + redirect to `/giris?success=...`) fires
  precisely as designed.
- `getCurrentUser()`'s `!session.user.isActive` check genuinely rejects
  a deactivated user's still-present session row in real time, on the
  very next request — confirmed this is real-time rejection, not
  eventually-consistent.
- `createSession()` always mints a fresh, unpredictable
  `randomBytes(32)` token — never adopts a client-supplied value,
  confirmed by planting a fixed cookie before login and proving the
  post-login token differs and the planted value was never persisted.
- The session-expiry check's actual operator (`expiresAt.getTime() <
  Date.now()`, strict less-than) behaves as a real, observed boundary:
  a session set to expire at the exact write-time instant is rejected
  by the time any real request reaches it — this was confirmed by
  running the scenario, not assumed.
- All three download routes (`export/excel`, `export/pdf`,
  `gecmis-nobetler/sablon`) enforce their real permission checks
  (`exportSchedule` — held by all three authenticated roles;
  `manageSetupData` — VIEWER lacks it) and every response carries a
  real `x-request-id` header, confirming the correlation-ID middleware
  covers these routes too.
- The public `/eczane-talep/[token]` form has no `pharmacyId` field
  anywhere in its DOM — the pharmacy is provably derivable only from the
  URL token, confirmed by locator count, not just by reading the source.
- No password, password hash, full session token, or forwarding-header
  chain value appears in any page's rendered HTML or in any captured
  server log line across all 29 tests (asserted explicitly, not just
  assumed).

## Any real bug found

**None.** Every scenario matched the application's existing, already-
documented behavior on the first correctly-written assertion. Three test
authoring mistakes were caught and fixed during this pass (not
application bugs):

1. A row-count assertion in the STAFF mutation test counted a fixture
   helper's own `createE2EUser` call as part of the "before" baseline
   incorrectly — fixed by reordering the fixture call before the
   baseline count, not by changing any application code.
2. The "exact session-expiry boundary" test's initial expectation
   (accepted) was backwards relative to both the task's own stated
   expectation and the code's actual, correct behavior (rejected, since
   real wall-clock time always advances past a fixed instant before the
   comparison runs) — fixed by correcting the test's assertion, not the
   application.
3. An assumption about Next.js's behavior for a raw anonymous POST to a
   page URL (expected a non-200 status) didn't match observed reality
   (Next serves the page's normal unauthenticated redirect-shaped
   response) — fixed by asserting the safety properties that actually
   matter (no session cookie minted, no stack trace/internal path
   leaked) instead of a specific status code this repo doesn't control.

No source file under `src/` was changed as a result of this pass. No
migration was required.

## Remaining limitations

- **Raw Server Action wire-protocol forgery is not exercised** — for
  publish/unpublish, duty-request review, and region/pharmacy delete,
  where no dedicated page URL exists to navigate to directly, this pass
  proves the mutating UI is genuinely absent for an under-privileged
  role, and relies on this repository's existing direct-function unit
  tests for the deeper "what if the exact action were invoked anyway"
  proof — see the "Scoping note" in
  `docs/testing/ROLE_SESSION_E2E_TESTS.md` for the full reasoning.
- **`Secure` cookie behavior is verified via `localhost`'s
  browser-level secure-context exception, not real TLS** — see
  "Production-only checks still required" in the same document. A live,
  deployed-domain HTTPS check is still needed before treating this as
  fully proven for the actual Railway deployment.
- **Only Chromium is exercised** — no Firefox/WebKit cross-browser
  session/cookie-handling verification was done (not required by this
  pass's scope, and this app targets a small internal chamber-staff user
  base, not broad public browser diversity).
- **Single-worker, sequential execution only** — `playwright.config.ts`
  sets `workers: 1`/`fullyParallel: false` for deterministic database
  state; no concurrent-browser-session race scenario is exercised here
  (real-Postgres concurrency races are already covered separately by
  `tests/integration/*.integration.test.ts`, e.g. the last-active-admin
  and duty-assignment-uniqueness scenarios).
- **No login-rate-limit interaction was deliberately tested here** —
  the deactivation and password-change scenarios each perform only one
  or two login attempts per user, well under the 5-attempt threshold
  from `docs/security/21-login-rate-limit-proxy-validation.md`; a
  dedicated rate-limit E2E scenario was judged out of scope for this
  pass (already covered by that protocol's own real-Postgres integration
  tests).

## Verification performed

- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm test` — 473/473 passing (12 new: `resolveE2EDatabaseUrl` guard
  tests), unaffected by the new E2E suite (excluded via
  `vitest.config.ts`)
- `npm run test:preflight` — passes against a dedicated
  `TEST_DATABASE_URL`
- `npm run test:integration` — 13/13 passing, unaffected
- `npm run test:e2e` — 29/29 passing, run **twice consecutively** with
  identical results; direct `psql` row-count inspection confirmed zero
  leaked rows in `User`, `Session`, `Region`, `Pharmacy`, `DutySchedule`,
  `DutyRequest`, `LoginAttempt`, and `AuditLog` after both runs
- `npm run build` — production build succeeds (the same build the E2E
  suite itself exercises via its `webServer`)
- No production database was touched — `E2E_DATABASE_URL` pointed at a
  dedicated local `pharmacy_duty_scheduler_e2e` database throughout; no
  script or spec file reads `DATABASE_URL` for anything other than the
  guard's own "is this the same as the target" comparison
- No production user was created or modified — every user in this pass
  is a synthetic `e2e-<id>@e2e.invalid` account, deleted by
  `test.afterAll`
- No full session token, password, or password hash was found in any
  captured server log line or rendered page across all 29 tests
  (asserted directly, not just by inspection)
- No schema/migration change in this pass
- No runtime dependency added — `@playwright/test` is a devDependency
  only, exact-pinned to `1.61.1`
