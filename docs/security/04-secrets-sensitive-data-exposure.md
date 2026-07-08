# Secrets & Sensitive Data Exposure Sweep

Date: 2026-07-08 (audit), fixes applied same day, same branch
(`deploy/postgresql-demo`).

## Scope

Hunted for hardcoded credentials/API keys/tokens in code, config, tests,
and fixtures; secrets or PII in log statements/error messages; verbose
error responses leaking stack traces, queries, or internal paths;
sensitive fields returned in server responses that callers don't need;
and debug endpoints/flags. Covers application source (`src/`), the seed
script (`prisma/seed.ts`), configuration (`next.config.ts`,
`package.json`), and both env example files.

## Checked files/configs/env examples

- All `src/**/*.ts(x)` for `console.*` calls, error-message pass-through,
  hardcoded secrets, and `NODE_ENV`/debug-flag branches.
- `src/app/(dashboard)/kullanicilar/**` — every place a `User` record is
  read and how it flows into a page or a `"use client"` component.
- `src/app/(dashboard)/denetim-kayitlari/page.tsx` — audit log page and
  its access control.
- `src/lib/auth/session.ts`, `src/lib/audit.ts` — what a session/audit
  write actually stores.
- `src/app/eczane-talep/[token]/**`, `src/app/vatandas/**` — the two
  public, unauthenticated routes, for over-fetching.
- `prisma/seed.ts` — demo credential generation and console output.
- `.env`, `.env.example`, `.env.production.example`, `next.config.ts`,
  `package.json`, `docs/DEPLOYMENT.md`.

## Finding table

| # | Finding | Status |
|---|---|---|
| 1 | `passwordHash` serialized into the browser RSC payload on the user-edit page | **Fixed** |
| 2 | `/denetim-kayitlari` (audit log) readable by any authenticated role, including VIEWER | **Fixed** |
| 3 | `prisma/seed.ts` logged plaintext demo passwords to stdout | **Fixed** |
| 4 | No hardcoded real API keys/tokens anywhere in source or tests | Clean |
| 5 | `.env.example` / `.env.production.example` contain placeholders only | Clean |
| 6 | No `console.*` logging anywhere in `src/` | Clean |
| 7 | Public routes (`/vatandas`, `/eczane-talep/[token]`) use explicit `select` and don't over-fetch sensitive fields | Clean |
| 8 | No debug endpoints or debug flags | Clean |

---

### 1. `passwordHash` shipped to the browser on the user-edit page — **Fixed**

**Before:** `src/app/(dashboard)/kullanicilar/[id]/duzenle/page.tsx` ran
`prisma.user.findUnique({ where: { id } })` with no `select`, fetching
every column including `passwordHash` (the scrypt hash + per-user salt),
then passed that full object as the `user` prop into `<UserForm>` — a
`"use client"` component. Next.js serializes every prop crossing the
Server→Client boundary into the page's RSC payload, so the password hash
was present in the HTML/JS response for anyone with `manageUsers`
(ADMIN) who opened that page, even though the form never read the field.

**Fix:**
- The query now uses an explicit `select`: `id`, `name`, `email`, `role`,
  `isActive` only. `createdAt`/`updatedAt` were left out since the form
  doesn't display them.
- `UserForm`'s prop type no longer accepts the Prisma `User` type.
  It now takes a narrow `EditableUser` DTO (`src/app/(dashboard)/kullanicilar/user-form.tsx`)
  containing exactly those five fields, so a future accidental
  `prisma.user.findUnique(...)` without `select` passed into this
  component would either fail to typecheck (extra required fields don't
  matter, but a differently-shaped caller would) or, more importantly,
  can no longer be justified as "the form's own type requires the whole
  User row."
- The user-list page (`kullanicilar/page.tsx`) already used `select`
  correctly and needed no change.

**Tests** (`src/app/(dashboard)/kullanicilar/[id]/duzenle/page.test.ts`,
new): asserts `prisma.user.findUnique` is called with exactly the
five-field `select` (catches any future regression back to a bare
`findUnique`); asserts the `UserForm` element's `user` prop matches the
select-scoped object and has no `passwordHash` property; asserts STAFF
is redirected before any DB query runs.

### 2. Audit log page open to any authenticated role — **Fixed**

**Before:** `/denetim-kayitlari` had no `hasPermission` check of its own
— only the shared `(dashboard)/layout.tsx`'s `requireUser()`, which
accepts any authenticated role. A `VIEWER` account could read the full
audit trail: every user's name/email, every role/status change
(`describeUserChange`), and every manual duty-assignment override reason
— none of which a VIEWER's `exportSchedule`-only permission set implies
they should see.

**Fix:**
- Added `requirePermissionOrRedirectWithMessage("manageUsers", "/", ...)`
  at the top of the page, matching the existing `/kullanicilar` pattern.
  `manageUsers` is ADMIN-only in the current permission model
  (`src/lib/auth/permissions.ts`), so STAFF and VIEWER are both blocked;
  nothing in the audit-log content is STAFF-specific work, so ADMIN-only
  was used rather than inventing a new permission.
- The "Denetim Kayıtları" sidebar entry (`src/lib/nav-items.ts`) now
  carries `permission: "manageUsers"`, so the link itself is hidden from
  STAFF/VIEWER (the `Sidebar` component already filters `navItems` by
  permission — this only needed the missing `permission` field added).
- Live browser verification caught a second, easy-to-miss entry point:
  the dashboard's "Son Manuel Değişiklik" widget
  (`src/app/(dashboard)/page.tsx`) rendered a "Denetim kayıtlarını aç"
  link unconditionally, independent of the sidebar. Added a
  `canViewAuditLog = hasPermission(user.role, "manageUsers")` flag and
  wrapped that link so it's only rendered for ADMIN, matching the page
  guard.

**Tests** (`src/app/(dashboard)/denetim-kayitlari/page.test.ts`, new):
VIEWER and STAFF are both redirected before any `auditLog.findMany` call;
ADMIN can render the page; an unauthenticated request redirects to
`/giris`.

### 3. Seed script logged plaintext demo passwords — **Fixed**

**Before:** `prisma/seed.ts` printed
`` `- ${user.role}: ${user.email} / ${user.password}` `` to stdout for
every seeded demo account, i.e. the literal `Admin123!` / `Staff123!` /
`Viewer123!` strings landed in console/CI output whenever seeding ran.

**Fix:** the line now prints
`` `- ${user.role}: ${user.email} / [redacted demo password]` `` — the
role/email summary (useful for knowing which demo accounts exist) is
kept, the password value is not. The actual seed credentials in the
`USERS` array are unchanged, since `docs/DEPLOYMENT.md` already
documents and repeatedly warns (lines 8, 23, 126, 163, 207, 219) that
`DEMO_SEED=true` demo seeding must never be run against real/production
data — that guardrail was left as-is per scope.

---

## Clean areas (no change needed)

### 4. No hardcoded real API keys/tokens

No third-party API key, secret, or token literal exists anywhere in
`src/`, config files, or tests. The only password-shaped strings in test
files are fixture literals (`"hash"`, `"NewPass123"`, `"old-hash"`) used
against mocked Prisma calls, never real credentials.

### 5. Env example files contain placeholders only

`.env.example` and `.env.production.example` use clearly-placeholder
values (`KULLANICI:SIFRE@HOST`, `GUCLU-BIR-SIFRE-BURAYA`, etc.), not real
connection strings or secrets. The tracked `.env` used for local
`sqlite` dev only contains `DATABASE_URL="file:./dev.db"`. Session
tokens are opaque, randomly generated, DB-backed values — there is no
signing secret (`SESSION_SECRET` or similar) to leak in the first place.

### 6. No `console.*` logging in `src/`

No application code (outside the seed script) logs request data, errors,
user input, or PII. Any exception not explicitly caught and translated
into a user-facing Turkish message falls through to Next.js's default
production error boundary, which does not expose stack traces, SQL
queries, or internal file paths to the client.

### 7. Public routes don't over-fetch sensitive fields

Both unauthenticated routes — `/vatandas` and `/eczane-talep/[token]`
(and its `createPublicDutyRequestAction`) — use explicit Prisma `select`
clauses that return only the minimal public-safe fields (pharmacy name,
active status, region name; never `passwordHash`, internal IDs beyond
what's needed, or other users' data).

### 8. No debug endpoints or flags

No `/api/debug`-style route, no `DEBUG` environment variable branch, and
no feature-flag bypass exists anywhere in the app. The two legitimate
`NODE_ENV` checks (cookie `secure` flag in `src/lib/auth/session.ts`, and
Prisma Client dev-mode singleton caching in `src/lib/prisma.ts`) are
standard, safe Next.js patterns and do not change auth or data-exposure
behavior.

## Verification performed

- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm test` — 130/130 passing (7 new tests added across the two page-level fixes)
- `npm run build` — production build succeeds, all routes registered
- No schema or migration changes were required for any of the three
  fixes — all three are query-shape, permission-check, and log-statement
  changes.

## Remaining recommendations (not fixed in this pass, out of scope)

- If a future page ever needs to render more of a `User` record client-side,
  extend `EditableUser` deliberately rather than reaching for the Prisma
  `User` type or an unscoped `findUnique` — the DTO pattern introduced
  here should be the template.
- Consider adding a lightweight ESLint rule or code-review checklist item
  flagging `prisma.<model>.findUnique`/`findMany` calls without a
  `select` when the result is passed to a `"use client"` component, since
  this is exactly the shape of bug fixed in item 1 and could recur
  elsewhere as the app grows.
- The demo seed's default passwords (`Admin123!` etc.) are fine for a
  disposable, explicitly-opt-in (`DEMO_SEED=true`) demo environment per
  existing deployment docs, but if a real pilot chamber's first admin
  account is ever bootstrapped via `db:create-admin` (as documented),
  confirm that script forces a strong, non-default password and does not
  print it back to logs either.
