# Configuration & Environment Hardening

Date: 2026-07-09 (audit + fixes), same branch (`deploy/postgresql-demo`).

## Scope

Audited configuration across environments for dangerous defaults, prod/
dev divergence that changes security behavior, config trusted without
validation at startup, feature flags disabling security controls,
secret reuse across environments, and missing fail-fast when required
config is absent. Config sources audited: `.env`/`.env.example`/
`.env.production.example`, `.gitignore`, `next.config.ts`,
`src/lib/auth/session.ts`, `src/lib/auth/password.ts`,
`src/lib/auth/actions.ts`, `prisma/schema.prisma`, `src/lib/prisma.ts`,
`scripts/create-admin.ts`, `prisma/seed.ts`, every `route.ts` handler,
git history (for ever-committed secrets), and `package.json` scripts.
This document covers the audit and the two actionable fixes from it.

## Finding table

| # | Finding | Status |
|---|---|---|
| 1 | `.env`/`.env.example`/`.env.production.example` contain only placeholders, no real secrets | Clean |
| 2 | No secret ever committed to git history | Clean |
| 3 | No CORS configuration anywhere; no permissive/`*` origin; no public API surface | Clean |
| 4 | No JWT/signing secret exists; no `process.env.X \|\| "default"` fallback-secret pattern | Clean |
| 5 | `prisma/seed.ts` refuses to run destructive demo seeding in production unless `DEMO_SEED=true` is explicit | Clean |
| 6 | No startup-time env validation — `DATABASE_URL` missing/malformed only surfaced lazily on first DB query | **Fixed** |
| 7 | No app-layer security headers (`X-Frame-Options`, etc.) configured in `next.config.ts` | **Fixed** |
| 8 | Railway dashboard-configured env values (real `DATABASE_URL`, actual runtime `NODE_ENV`) | Not inspectable from repo |
| 9 | Reverse-proxy/CDN/TLS-level headers Railway may or may not add in front of the app | Not inspectable from repo |
| 10 | No central `middleware.ts` — auth enforced per-`(dashboard)` layout + per-`route.ts` handler individually | Documented (structural risk, not a live gap) |
| 11 | No Content-Security-Policy | Documented as future hardening (not added this pass) |

---

## Fixed findings

### 6. Missing startup-time environment validation — **Fixed**

**Before:** nothing validated that `DATABASE_URL` was present or
well-formed before the app started serving traffic. A missing or
malformed value would let the Next.js server boot successfully and only
fail — lazily, per-request — the first time a page actually touched
Prisma.

**Fix:** added `src/lib/env.ts`, a small dependency-free validation
module (`validateEnv()`, taking an optional `source` object so it's
unit-testable without mutating real `process.env`) that runs at module
load and exports a validated `env` object:

```ts
export const env = validateEnv(); // runs immediately on import
```

Rules enforced:
- `NODE_ENV` must be one of `development` / `test` / `production`
  (defaults to `development` if unset, matching how local scripts and
  ad-hoc tool runs behave when nothing sets it).
- `DATABASE_URL` is required in `development` and `production`. It is
  **not** required in `test` — vitest doesn't load `.env` files, every
  test file that touches the database mocks `@/lib/prisma` entirely
  (confirmed: the one test file that doesn't, `data-health.test.ts`,
  only imports the pure `runDataHealthCheck` function and never
  triggers a real query), so requiring it in test mode would have
  broken CI/local test runs for no safety benefit.
- In `production` specifically, `DATABASE_URL` must match
  `/^postgres(ql)?:\/\//` — a SQLite/`file:`-style URL (the shape of a
  stale local `.env`, see the prod-dev divergence noted in the sweep) is
  rejected outright, since it would mean a local development
  configuration was accidentally carried into a real deployment.
- Error messages are static, non-parameterized strings — the actual
  `DATABASE_URL` value (which may embed credentials) is never
  interpolated into any thrown error, confirmed by a dedicated test.

**Wired into Prisma:** `src/lib/prisma.ts` now imports `{ env }` from
`@/lib/env` before constructing the client — this import runs
validation as a side effect at module load, so the very first time
anything in the app touches `@/lib/prisma` (which is effectively "at
process/request startup" for every page and action), a bad
configuration throws immediately instead of waiting for a query. The
validated `env.databaseUrl` is passed to `PrismaClient` via
`datasourceUrl` when present (falls back to Prisma's own `env("DATABASE_URL")`
resolution via the schema if not, so nothing changes when the value is
merely absent in a context that doesn't require it, like tests), and
`env.nodeEnv` replaces the previous direct `process.env.NODE_ENV` check
for the dev-singleton caching decision — same behavior, now going
through the validated value.

**Tests** (`src/lib/env.test.ts`, new, 10 tests): rejects a missing
`DATABASE_URL` in both development and production; does not require
`DATABASE_URL` in test mode; rejects a `file:`-style `DATABASE_URL` in
production with the exact documented message; accepts both
`postgresql://` and `postgres://` prefixes in production; allows a
SQLite-style URL in development (local flexibility preserved);
defaults `NODE_ENV` to `development` when unset; rejects an invalid
`NODE_ENV` value; and confirms no thrown error message ever contains
the `DATABASE_URL` value or an embedded credential, even when one is
deliberately included in the test input.

**Manually verified fail-fast behavior** (outside the test suite, to
prove this isn't just a mocked assertion): ran `src/lib/env.ts` directly
via `tsx` with `NODE_ENV=production` and `DATABASE_URL` unset — threw
`"Missing required environment variable: DATABASE_URL"`; ran it again
with `DATABASE_URL=file:./dev.db` — threw `"Invalid DATABASE_URL for
production: expected a PostgreSQL connection string."` Neither error
printed any secret value.

### 7. Missing app-layer security headers — **Fixed**

**Before:** `next.config.ts` set only `devIndicators: false` (a cosmetic
dev-mode setting) — no `X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy`, or `Permissions-Policy` anywhere at the app layer.
Whatever protection existed depended entirely on Railway's reverse
proxy, which this repo cannot inspect or verify.

**Fix:** added a `headers()` function to `next.config.ts` applying four
conservative headers to every route (`source: "/:path*"`):

| Header | Value |
|---|---|
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |

None of these change any observable app behavior (no iframe embedding is
used anywhere in this app, no MIME-sniffing-dependent asset loading, no
camera/microphone/geolocation API usage anywhere in the codebase) — they
are pure hardening with no functional risk, confirmed by the full
build/test suite passing unchanged.

**`Strict-Transport-Security` deliberately NOT added**, per the task's
explicit escape hatch: HSTS (especially with `preload`) is effectively
irreversible once a browser has cached it for a domain, and this repo
cannot confirm from the codebase alone that every current and future
custom domain in front of this app on Railway always terminates HTTPS
correctly — misconfiguring this could lock real users out over a
transient HTTP misconfiguration with no way to quickly undo it client-side.
Documented as a future-hardening candidate below, to be added once the
production domain/TLS setup is confirmed stable outside this repo.

**Content-Security-Policy deliberately NOT added**, per the task's
explicit instruction — a CSP needs to be tuned to exactly what `next
build` emits (inline bootstrap scripts, hashed chunk URLs, etc.) and
getting it wrong breaks the app outright. This wasn't attempted or
guessed at in this pass; documented as future hardening below.

**Tests** (`next.config.test.ts`, new, 2 tests): the four headers above
are present with their exact expected values, applied to every route;
`Strict-Transport-Security` and `Content-Security-Policy` are confirmed
absent (matching the deliberate scope of this pass, not an oversight).

---

## Clean findings (no code change)

Restated from the sweep for completeness — see the sweep report for
full detail on each:

- `.env`/`.env.example`/`.env.production.example` — placeholders only;
  `.gitignore` correctly tracks only the two `*.example` files.
- No secret was ever committed to git history (checked across all
  commits, not just the current tree).
- No CORS configuration exists anywhere, and there's no public API
  surface to misconfigure — this is server-rendered pages + Server
  Actions plus 3 same-origin, auth-gated download routes.
- No JWT/session-signing secret exists (sessions are opaque, DB-backed
  tokens by design) and no `process.env.X || "fallback"` anti-pattern
  appears anywhere in the codebase.
- `prisma/seed.ts`'s `assertSeedIsSafeToRun()` refuses to run
  destructive demo seeding in production unless `DEMO_SEED=true` is
  explicitly set, `process.exit(1)`-ing otherwise.

## Not inspectable from this repo

- **Railway's actual dashboard-configured environment variables** for
  the live deployment — the real `DATABASE_URL`, whatever `ADMIN_*`
  values were used at bootstrap, and whether `NODE_ENV=production` is
  actually set at runtime as Next.js's own tooling promises. The new
  `src/lib/env.ts` validation is the app-side mitigation for exactly
  this blind spot — if Railway's `DATABASE_URL` is ever wrong, the app
  will now refuse to boot cleanly rather than silently misbehave.
- **Reverse-proxy/CDN/TLS-level configuration** Railway applies in
  front of the app (whether HSTS, additional headers, or TLS
  enforcement already happens there) — `docs/SECURITY_CHECKLIST.md`
  references this as the intended layer for HSTS but it isn't verifiable
  from the repository.

## Documented-only items

### No central `middleware.ts` — structural risk, not a live gap

Auth is enforced per-`(dashboard)` layout (via `requireUser()`) plus
individually in each of the 3 `route.ts` download handlers, since Next's
App Router does not apply a parent layout's gate to Route Handlers.
Every current route is correctly gated (verified in a prior sweep). This
remains a **process risk**, not a currently-exploited gap: any future
`route.ts` added under `(dashboard)/` must remember to add its own
`getCurrentUser()`/`requireUser()` check, since there is no single
enforcement point that would catch a forgotten one. Left unfixed — a
centralized `middleware.ts` auth gate is a larger structural change than
this pass's two scoped findings warranted, and would need careful
testing against every existing route (including the intentionally
public `/vatandas` and `/eczane-talep/[token]`) to avoid accidentally
locking those out. Flagged as a good candidate for a dedicated future
pass.

## Remaining recommendations (future hardening, not done this pass)

1. **Strict-Transport-Security** — add once the production
   domain/TLS setup is confirmed stable via Railway's dashboard
   (start without `preload`, add it later once HSTS itself has been
   observed working correctly for a while).
2. **Content-Security-Policy** — needs a pass specifically tuned to
   `next build`'s actual output (inline scripts, asset hashes) with
   real testing against a production build, not guessed at here.
3. **Centralized `middleware.ts` auth gate** — would remove the
   per-route-handler self-gating requirement noted above; a dedicated,
   carefully-tested pass given the two intentionally-public routes.

## Verification performed

- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm test` — 217/217 passing (12 new tests: 10 in `src/lib/env.test.ts`,
  2 in `next.config.test.ts`)
- `npm run build` — production build succeeds against a real local
  PostgreSQL instance with a valid `postgresql://` `DATABASE_URL`, all
  routes registered, confirming the new env validation doesn't break a
  normal production build
- Manually confirmed (outside the automated suite, via `tsx`) that the
  validation actually throws — not just in mocked tests — when
  `DATABASE_URL` is missing in production, and when it's a `file:`-style
  URL in production; confirmed neither thrown message contains the
  attempted value
- No schema or migration changes were made or required — this pass is
  entirely application/config-layer (`src/lib/env.ts`,
  `src/lib/prisma.ts`, `next.config.ts`); confirmed via `git status`
  showing no changes under `prisma/`
- No production seed was run and no production data was touched — all
  DB-touching verification used a disposable local PostgreSQL instance
