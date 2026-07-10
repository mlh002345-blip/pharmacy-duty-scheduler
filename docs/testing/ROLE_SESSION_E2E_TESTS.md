# Role-Based Access & Session Security E2E Tests

Step 4 of the pre-pilot infrastructure and security test plan. Real
browser-level E2E tests proving that authorization and session controls
work through the deployed-style UI and HTTP surface — not only through
mocked unit tests.

## Environment safety model

- Dedicated database via `E2E_DATABASE_URL`, validated by
  `resolveE2EDatabaseUrl()` (`tests/integration/helpers/test-db-guard.ts`)
  — the same shared guard core used by `TEST_DATABASE_URL` and
  `RESTORE_DATABASE_URL`. Fails fast, before any migration, before the
  app server even starts, before any row is created, unless **all**
  hold:
  1. `E2E_DATABASE_URL` is set explicitly — never falls back to
     `DATABASE_URL`.
  2. It's a valid `postgresql://`/`postgres://` URL.
  3. It doesn't resolve to the same host+port+database as `DATABASE_URL`
     (checked both as a byte-identical string and as a parsed
     protocol/host/port/path comparison).
  4. Its database name contains `test`, `testing`, `integration`, `e2e`,
     or `staging` (case-insensitive).
  5. Neither its hostname nor database name contains `prod`,
     `production`, or `live` — this check always wins even if a
     recognized marker is also present.
- `playwright.config.ts` calls `resolveE2EDatabaseUrl()` at config-load
  time (before `globalSetup`, before the `webServer` starts) — a bad
  `E2E_DATABASE_URL` stops the entire run before anything happens.
- `tests/e2e/helpers/global-setup.ts` re-validates the same guard, then
  runs `prisma migrate deploy` against `E2E_DATABASE_URL` only — never a
  seed.
- Every user/session/region/pharmacy/schedule/duty-request row created
  by a spec file is synthetic, tagged with a short random suffix
  (`testRunId()`), tracked in a per-describe-block `TrackedIds` object,
  and deleted in `test.afterAll` regardless of pass/fail — never a
  table-wide wipe. See `tests/e2e/helpers/fixtures.ts`.
- This suite **never** runs against Railway production. There is no code
  path anywhere in `tests/e2e/` that reads or writes `DATABASE_URL`
  directly — every database interaction goes through
  `tests/e2e/helpers/db.ts`'s `e2ePrisma`, which is constructed with
  `datasourceUrl: resolveE2EDatabaseUrl()` and nothing else.

## E2E framework

**Playwright** (`@playwright/test`), added as a **devDependency only**
(exact-pinned, `1.61.1`, matching this repo's convention for
security-adjacent tooling). No runtime dependency was added. Only the
pre-installed Chromium binary is used (`executablePath` in
`playwright.config.ts` — no `playwright install` was run, matching this
session's environment constraints).

- `npm run test:e2e` runs the suite — a completely separate command from
  `npm test`.
- `npm test` (vitest) is unaffected: `vitest.config.ts` excludes
  `tests/e2e/**` explicitly, so vitest never attempts to load a `.spec.ts`
  file written against `@playwright/test`'s incompatible `test`/`expect`
  globals, and never launches a browser.
- The app under test runs as a **real production build**
  (`next build && next start`, not `next dev`) bound to `localhost` on a
  dedicated port (`3210`), with `DATABASE_URL` overridden to
  `E2E_DATABASE_URL` and `NODE_ENV=production` for that process only.
  Playwright's `webServer.reuseExistingServer: false` makes the run fail
  fast if port 3210 is already occupied by something else, rather than
  silently attaching to an unrelated process.
- **Why a production build, not `next dev`**: the session cookie's
  `Secure` attribute is only set when `NODE_ENV === "production"`
  (`src/lib/auth/session.ts`). Chromium treats `http://localhost` as a
  secure context even without real TLS, so running the app in production
  mode against `localhost` lets the `Secure` flag genuinely round-trip
  through a real cookie jar in these tests — not just be read as a
  declared flag on a `Set-Cookie` header. This does **not** prove real
  HTTPS termination behavior on a deployed Railway domain — see
  "Production-only checks still required" below.

## Test users/roles

`tests/e2e/helpers/fixtures.ts`'s `createE2EUser()` creates every
synthetic user via `hashPassword()` (`src/lib/auth/password.ts`) — the
real, unmodified production hashing implementation — with a fixed test
password (`E2E_TEST_PASSWORD`, never printed or asserted in full output)
and a unique, deterministic email (`e2e-<8charid>@e2e.invalid`).

Roles created across the suite: **ADMIN**, **STAFF**, **VIEWER**, and
**INACTIVE_USER** (an active user deactivated mid-test, and a separately
created never-active-from-the-start account in the route matrix). None
of `admin@example.com`/`staff@example.com`/`viewer@example.com` (the
seed script's demo accounts) or any production credential is ever
referenced.

## Route/role matrix covered

| Route | ADMIN | STAFF | VIEWER | ANONYMOUS |
|---|---|---|---|---|
| `/kullanicilar` | ✅ | ❌ → `/?error=` | ❌ → `/?error=` | → `/giris` |
| `/denetim-kayitlari` | ✅ | ❌ → `/?error=` | ❌ → `/?error=` | → `/giris` |
| `/eczaneler` | ✅ | ✅ | ✅ | → `/giris` |
| `/bolgeler` | ✅ | ✅ | ✅ | → `/giris` |
| `/nobet-talepleri` | ✅ | ✅ | ✅ | → `/giris` |
| `/gecmis-nobetler` | ✅ | ✅ | ✅ | → `/giris` |
| `/cizelgeler` | ✅ | ✅ | ✅ | → `/giris` |
| `/veri-kontrol` | ✅ | ✅ | ✅ | → `/giris` |
| `/eczaneler/yeni` (manageSetupData) | — | — | ❌ → `/eczaneler` | → `/giris` |
| `/kullanicilar/yeni`, `/kullanicilar/[id]/duzenle` (manageUsers) | ✅ | ❌ → `/?error=` | — | → `/giris` |
| `/vatandas` | ✅ (also anon) | | | ✅ |
| `/eczane-talep/[token]` (valid) | | | | ✅ |
| `/eczane-talep/[token]` (invalid) | | | | ✅ (friendly "Bağlantı Geçersiz" screen, `200`) |

All assertions are on the resulting URL after a **real navigation** — a
denied page never even renders; the server-side guard fires before any
mutation-capable content is sent. Directly asserted against
`src/lib/auth/permissions.ts`'s real matrix; no new policy invented.

## Mutation matrix covered

| Attempted mutation | Actor | Proof mechanism |
|---|---|---|
| Create/edit a user | STAFF | Direct navigation to `/kullanicilar/yeni` and `/kullanicilar/[id]/duzenle` — real server-side redirect before the form renders; `User` row count unchanged |
| Create a pharmacy | VIEWER | Direct navigation to `/eczaneler/yeni` — real redirect; `Pharmacy` row count unchanged |
| Publish/unpublish a schedule | VIEWER | Real schedule detail page rendered; publish button genuinely absent from the DOM; `DutySchedule.status` unchanged |
| Review a duty request | VIEWER | Real request detail page rendered; review buttons genuinely absent from the DOM; `DutyRequest.status` unchanged |
| Delete a region/pharmacy | STAFF (lacks `deleteSetupData`) | Delete button genuinely absent from `/bolgeler` and `/eczaneler`; region row confirmed still present |
| Anonymous export route access | anonymous | Real `GET` → redirect to `/giris`, no file body |
| Anonymous raw POST to a dashboard URL | anonymous | Real `POST` with no session and no Server-Action protocol header — no session cookie minted, no stack trace/internal path in the response |

**Scoping note — what is and isn't forged as raw HTTP**: for
publish/unpublish and duty-request review, the mutating control is a
Server Action bound directly to a button (no dedicated page URL to
navigate to), and the containing React tree is never rendered at all for
an under-privileged role — there is no HTML form in the page for the
role to submit, by design (defense in depth: hidden here, re-checked
inside the action itself). Reproducing an anonymous/wrong-role
invocation of that exact action would require reverse-engineering
Next.js's internal Server Action wire protocol (the `Next-Action` header
value, generated only for a form the authorized UI actually rendered) —
judged out of scope for this pass as a fragile, Next-version-sensitive
technique with limited additional value: the corresponding server-side
`requirePermissionOrRedirect`/`requirePermissionOrState` checks inside
`publishDutyScheduleAction`, `reviewDutyRequestAction`,
`deleteRegionAction`, and `deletePharmacyAction` are already directly
unit-tested by calling the real functions (see
`docs/security/03-authorization-idor-sweep.md`,
`docs/security/06-concurrency-race-conditions.md`, and the existing
`*.test.ts` files next to each action file) — this E2E pass adds the
complementary "the UI never even offers the capability" proof on top of
that existing direct-invocation proof, rather than duplicating it via a
fragile wire-protocol forgery.

## Session scenarios covered

- **Cookie attributes**: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure`
  (see "Cookie checks" below) — all asserted via
  `context.cookies()` after a real login through the rendered form.
- **Logout**: real login → real `Session` row exists → click "Çıkış
  Yap" → redirected to `/giris` → `Session` row is actually deleted
  (not just the client-side cookie) → re-injecting the exact old token
  value does not restore access → a second full login/logout cycle
  behaves identically (repeatable, idempotent).
- **Password-change invalidation**: one ADMIN user, two independent
  browser contexts both logged in with distinct real session tokens →
  self-password-change through the real `/kullanicilar/[id]/duzenle`
  form and `updateUserAction` → both old sessions are deleted from the
  database (not just the acting browser's) → both old cookies redirect
  to `/giris` → old password no longer authenticates → new password
  does → exactly one `AuditLog` `UPDATE` row exists for that user → the
  audit row's JSON contains neither the old nor new password.
- **User deactivation**: STAFF user logs in (real session) → ADMIN
  deactivates them through the real `/kullanicilar` "Pasif Yap" button
  (`setUserStatusAction`) → the STAFF user's next navigation is rejected
  in real time → **documented exactly as implemented**: the `Session`
  row itself is *not* deleted by a plain deactivation (only a password
  change calls `invalidateUserSessions` — see
  `src/app/(dashboard)/kullanicilar/actions.ts`), rejection instead
  happens via `getCurrentUser()`'s `!session.user.isActive` check at
  read time → re-login with the correct password returns the identical
  generic failure message as any other credential failure.
- **Session-expiry boundary**: four real database rows with
  `expiresAt` set to just-before/exactly-at/just-after "now", and a
  normal unexpired session — manipulated directly via Prisma, **no
  sleeps anywhere**. `getCurrentUser()`'s check is a strict
  `expiresAt.getTime() < Date.now()`; because real wall-clock time has
  always advanced by the time the check actually runs, the
  exactly-at-write-time case behaves identically to an already-expired
  one in practice — asserted as such (confirmed by actually running the
  scenario, not assumed from reading the source). An expired row is
  rejected but not proactively deleted by the read (matches the
  documented, accepted "no Session cleanup job" contract in
  `docs/security/10-memory-unbounded-growth.md`).
- **Session fixation resistance**: visit `/giris` with no cookie at
  all → plant an attacker-chosen fixed cookie value → log in → the
  server-issued token is provably different from the planted one, is a
  genuine 64-hex-char `randomBytes(32)` value, and the planted value was
  never written to the `Session` table → log out, log in again → the
  second real token differs from the first → a fresh random 64-hex value
  that was never issued by the server also grants nothing. Full tokens
  are never printed in test output — only lengths and equality checks.

## Cookie checks

Verified via `context.cookies()` after a real login:

| Attribute | Verified locally? | How |
|---|---|---|
| `HttpOnly` | ✅ | Read directly from the cookie jar object |
| `SameSite=Lax` | ✅ | Read directly; matches `sameSite: "lax"` in `src/lib/auth/session.ts` |
| `Path=/` | ✅ | Read directly |
| `Secure` | ✅ (via the `localhost`-is-a-secure-context exception — see "E2E framework" above) | The app runs in real production mode; Chromium accepts and returns the `Secure` cookie over plain HTTP specifically because the origin is `localhost` |

**Cannot be verified under local HTTP, requires a deployed HTTPS
check**: whether Railway's actual edge/reverse-proxy correctly
terminates TLS for the real production domain, whether it redirects
plain HTTP to HTTPS, and whether the `Secure` cookie is therefore
genuinely protected end-to-end on a real, non-`localhost` origin (where
the browser's `localhost`-exception does not apply and a `Secure` cookie
set over accidental plain HTTP would simply never be stored at all —
which would be a *worse*, silently-broken-login failure mode, not a
security gap, but one this repo cannot detect without hitting the real
domain). See `docs/security/14-configuration-environment-hardening.md`
for the same, already-documented "Reverse-proxy/CDN/TLS-level
configuration — Not inspectable from this repo" limitation.

## Production-only checks still required

1. Load the real production `/giris` URL over HTTPS in a real browser
   and confirm the session cookie is actually set (proves real TLS
   termination + `Secure` cookie interaction, which `localhost`'s
   special-cased trust cannot substitute for).
2. Confirm Railway's edge doesn't strip or rewrite `Set-Cookie` headers.
3. Everything else in this document's route/mutation/session matrices
   applies identically to the real deployment, since it exercises the
   same application code — no additional *application-logic* check is
   needed live, only the TLS/cookie-delivery check above.

## Cleanup procedure

`test.afterAll` in every spec file's `describe` block calls
`cleanupTrackedIds(tracked)` (`tests/e2e/helpers/fixtures.ts`), which:

- deletes exactly the `Session`/`DutyRequest`/`DutySchedule`(+its
  `DutyAssignment`/`DutyScheduleWarning`/related `AuditLog`
  rows)/`Pharmacy`/`Region`/`User` rows this test run created, in
  FK-safe order;
- recomputes the `LoginAttempt` `ACCOUNT`-dimension hash for each
  tracked synthetic email and deletes exactly those rows;
- also deletes the single shared `NETWORK`-dimension "untrusted bucket"
  row (`UNTRUSTED_NETWORK_BUCKET_KEY` — see
  `src/lib/security/client-identity.ts`), since every spec file's
  login-failure scenarios accumulate against that one shared,
  non-identifying key when `TRUST_PROXY_HEADERS` is off (the default);
- never issues a table-wide `deleteMany({})`.

Verified after every run in this pass via direct `psql` row counts on
every affected table (`User`, `Session`, `Region`, `Pharmacy`,
`DutySchedule`, `DutyRequest`, `LoginAttempt`, `AuditLog`) — all zero
after both consecutive `test:e2e` runs.

## How to run locally

```bash
export E2E_DATABASE_URL="postgresql://user:pass@localhost:5432/pharmacy_duty_scheduler_e2e"
export DATABASE_URL="postgresql://user:pass@localhost:5432/pharmacy_duty_scheduler"  # for the safety-guard comparison only
npm run test:e2e
```

Runs once by default. To run twice consecutively (as done for this
pass's own verification):

```bash
npm run test:e2e && npm run test:e2e
```

## How to interpret failures

- A failure in the **route/mutation matrix** tests means either a real
  authorization regression, or that `src/lib/auth/permissions.ts`'s
  matrix changed and this test file needs updating to match the new,
  intentional policy — check `git diff` on `permissions.ts` first.
- A failure in **session scenario** tests (cookie/logout/password-change/
  deactivation/expiry/fixation) should be treated as a real regression
  candidate first — these assert exact current, already-audited
  behavior (see `docs/security/02-authentication-session-handling.md`,
  `docs/security/06-concurrency-race-conditions.md`) and are not
  expected to need updating unless that behavior is deliberately
  changed.
- Playwright writes a trace (`trace: "retain-on-failure"`) and a
  screenshot for every failed test under `test-results/` — run
  `npx playwright show-trace test-results/.../trace.zip` to step through
  exactly what the browser did.
- If the `webServer` step itself fails to start (e.g. "port already in
  use"), check for a stray `next start -p 3210` process left over from
  an interrupted previous run before re-running.
