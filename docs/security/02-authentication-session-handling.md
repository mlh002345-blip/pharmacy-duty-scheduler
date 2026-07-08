# Authentication & Session Handling

Date: 2026-07-08 (audit), fixes applied same day, same branch
(`deploy/postgresql-demo`).

This document covers the audit of how identity is established and
maintained in the app, and the small set of actionable fixes applied from
that audit. It intentionally does not cover other security categories
(those are tracked in `01-injection-untrusted-input-sweep.md` and future
sweep documents).

## Mechanisms inspected

- `src/lib/auth/session.ts` — session token generation, storage, lookup,
  expiry, destruction.
- `src/lib/auth/password.ts` — password hashing (`scrypt`) and comparison
  (`timingSafeEqual`).
- `src/lib/auth/actions.ts` — `loginAction`, `logoutAction`.
- `src/lib/auth/guard.ts` — permission-gated access to server actions/pages.
- `src/app/(dashboard)/layout.tsx` — route-group-level `requireUser()` gate.
- `src/app/(dashboard)/kullanicilar/actions.ts` — user create/update/
  deactivate, the only path that ever changes a password after account
  creation.
- All `route.ts` Route Handlers under `(dashboard)/` (export/excel,
  export/pdf, historical-duty template download) — these are **not**
  covered by the parent layout's auth gate in Next.js App Router, so each
  was checked individually.
- `prisma/schema.prisma` — `User`/`Session` models.

## Protected route access summary

| Surface | Protection | Verified |
|---|---|---|
| All `(dashboard)/*` pages | `layout.tsx` → `requireUser()` | ✅ empirically — unauthenticated `GET /` and `GET /eczaneler` return `307 → /giris` |
| `.../export/excel`, `.../export/pdf`, `.../sablon` route handlers | Each does its own `getCurrentUser()` + `redirect()` check | ✅ empirically — all three return `307 → /giris` when unauthenticated |
| `/vatandas` | Intentionally public | ✅ empirically — `200` unauthenticated |
| `/eczane-talep/[token]` | Intentionally public, gated by a 128-bit token (not a session) | Audited separately in the injection sweep |
| Garbage/forged session cookie | Rejected — `Session.token` lookup returns no row | ✅ empirically — `307 → /giris` |
| Expired session row (still present in DB) | Rejected at read time via `expiresAt` comparison | ✅ empirically — backdated a row's `expiresAt`, confirmed rejection even though the row wasn't deleted |
| Deactivated user, valid unexpired token | Rejected in real time on the very next request | ✅ empirically — flipped `isActive` mid-session, same token immediately stopped working |

## Findings

| # | Finding | Status |
|---|---|---|
| 1 | Password change did not invalidate existing sessions | **Fixed** |
| 2 | Inactive-account login message enumeration | **Fixed** |
| 3 | No login rate limiting / lockout | Documented only |
| 4 | Email-existence timing oracle (scrypt only runs if the account exists) | Documented only |
| 5 | No password reset / account recovery flow | Absent by design |
| 6 | No remember-me / refresh token | Absent by design |
| 7 | No session rotation (same token for the full 7-day life; no rotation on privilege change; no session-listing/"log out all devices") | Documented only |
| 8 | Expired `Session` rows are never purged from the DB | Hygiene recommendation only |

---

### 1. Password change did not invalidate existing sessions — **Fixed**

**Before:** `updateUserAction` updated `passwordHash` but never touched the
`Session` table. A session token issued before a password change remained
valid for up to 7 days after the password was rotated — meaning an
incident-response password reset by an ADMIN did not actually revoke a
potentially-compromised session.

**Fix:**
- Added two small exports to `src/lib/auth/session.ts`:
  - `invalidateUserSessions(userId)` — deletes all `Session` rows for that
    user, regardless of which browser/device they came from.
  - `clearSessionCookie()` — deletes just the `session_token` cookie
    (used when the *acting* user's own session was among those just
    invalidated).
- `updateUserAction` now calls `invalidateUserSessions(id)` whenever
  `passwordChanged` is true, immediately after the `prisma.user.update`
  call and before the audit-log write.
- **Admin editing someone else:** since the invalidation targets
  `userId = id` (the *edited* user), and the acting admin's own session
  row has `userId = <admin's own id>`, their session is untouched
  automatically — no special-casing needed, this falls out of the data
  model.
- **Admin changing their own password:** detected via
  `before.id === currentUser.id`. In that case, after invalidating
  sessions (which now includes their own), the action also calls
  `clearSessionCookie()` so the browser doesn't hold a stale cookie, and
  redirects to `/giris` with a clear Turkish message
  ("Şifreniz güncellendi. Lütfen yeni şifrenizle tekrar giriş yapın.")
  instead of the normal `/kullanicilar` redirect — a clean, intentional
  logout rather than a confusing bounce on the next click.
- Deactivation logic (self-deactivation block, last-active-admin quorum
  check) is untouched — the new code only runs after those checks pass
  and only affects the `Session` table.

**Tests** (`src/app/(dashboard)/kullanicilar/actions.test.ts`, 4 cases,
Prisma/session/audit modules mocked with `vi.mock`):
- changing another user's password calls `invalidateUserSessions` for
  that user and leaves the acting admin's own cookie untouched
- updating a user without changing the password does not call
  `invalidateUserSessions` at all
- an admin changing their own password gets their cookie cleared and is
  redirected to `/giris`
- deactivation-quorum behavior (blocking removal of the last active
  admin) is unchanged and does not trigger session invalidation

---

### 2. Inactive-account login message enumeration — **Fixed**

**Before:** `loginAction` returned three different failure states:
nonexistent email → generic message; wrong password → the same generic
message; **inactive account with the correct password** → a distinct
message, `"Kullanıcı hesabı pasif durumdadır."` An unauthenticated caller
who knew or guessed a valid email/password pair for a deactivated account
could confirm the account exists and is specifically deactivated (as
opposed to simply having a wrong password), without ever authenticating.

**Fix:** the inactive-account branch in `src/lib/auth/actions.ts` now
returns the exact same string as the other two failure cases —
`"Hatalı e-posta veya şifre."` No branch of `loginAction` reveals whether
an email exists or what state the account is in. Internal admin screens
(`/kullanicilar`) still show active/passive status normally — that
information is only exposed after authentication and only to users with
the `manageUsers` permission, which is unchanged and out of scope for
this fix.

**Tests** (`src/lib/auth/actions.test.ts`, 5 cases, Prisma/password/
session modules mocked):
- nonexistent email → generic message, `verifyPassword` never called
- wrong password on an active account → generic message
- correct password on an **inactive** account → the same generic message
  (not the old distinct one), and no session is created
- explicit assertion that all three failure messages are textually
  identical
- correct password on an active account still creates a session and
  redirects normally (regression guard — the fix didn't break the happy
  path)

---

### 3. No login rate limiting / lockout — Documented only

No attempt counter, delay, CAPTCHA, or IP/account lockout exists anywhere
in `loginAction`. An attacker can submit unlimited password guesses
against any known email. Explicitly out of scope for this pass per
instructions ("Do not... implement... full rate limiting in this pass").
For this app's threat model (small number of named internal chamber-staff
accounts, not a public signup surface), the practical exposure is lower
than for a consumer app, but this remains a real, unmitigated gap that
should be addressed in a future pass — e.g. a simple per-email or
per-IP attempt counter with exponential backoff.

### 4. Email-existence timing oracle — Documented only

`loginAction` looks up the user and returns immediately if not found,
*before* calling the CPU-expensive `scrypt`-based `verifyPassword`. A
request against a real email therefore takes measurably longer than one
against a nonexistent email, which is a coarse timing side-channel for
account-existence (not for password guessing — the hash *comparison*
itself remains genuinely constant-time via `timingSafeEqual`). Fixing
this properly means doing a dummy-but-equivalent-cost hash computation on
the "no such user" path, which changes the shape of the login flow more
than this pass's scope allows; documented for a future pass.

### 5. No password reset / account recovery — Absent by design

Confirmed by exhaustive search: no self-service reset, no email-based
recovery, no security questions, no magic links. The only ways a password
is ever set are `scripts/create-admin.ts` (operator-run, env-var gated,
deploy-time trust) and the ADMIN-only `/kullanicilar` user-management UI.
Since the flow doesn't exist, it has no attack surface (no reset-token
interception, no "does this email exist" leak via a reset form). A locked
-out user must ask an ADMIN — a usability tradeoff, not a security flaw,
and explicitly out of scope to build in this pass.

### 6. No remember-me / refresh token — Absent by design

Every login produces exactly one 7-day session token via the same code
path; there is no "remember me" checkbox, no separate short-vs-long
session choice, and no distinct refresh-token mechanism. Nothing to fix;
explicitly out of scope to build in this pass.

### 7. No session rotation — Documented only

The same token is used for a session's entire 7-day life. There's no
rotation on privilege change (e.g. a role change doesn't force
re-issuance), no idle timeout distinct from the fixed expiry, and no way
for a user to see or revoke their other active sessions ("log out all
devices"). Logging in from a second device does not invalidate the first
— `createSession` only ever creates, never checks for or revokes existing
sessions for that user. This is a reasonable simplification for a
low-traffic internal tool; noted here for future consideration, not
fixed in this pass.

### 8. Expired session rows are never purged — Hygiene recommendation only

`Session` rows are only ever deleted by explicit logout
(`deleteMany({where:{token}})`) or by the new password-change
invalidation (`deleteMany({where:{userId}})`) added in this pass.
Naturally-expired rows are left in the table indefinitely — expiry is
enforced correctly at read time regardless (confirmed empirically in the
prior audit), so this is a storage-growth/table-hygiene note, not a
security issue. Recommendation: an optional periodic cleanup (e.g. a
scheduled `DELETE FROM "Session" WHERE "expiresAt" < now()`) would keep
the table small; not required for correctness.

## Framework-dependent assumptions (not independently black-box tested here)

- `secure: process.env.NODE_ENV === "production"` on the session cookie —
  confirmed matching code logic under `next dev` (`secure: false`
  observed live). Relies on Next.js's documented behavior of setting
  `NODE_ENV=production` for `next build`/`next start`; not independently
  verified against an actual production-mode server in this pass.
- `redirect()` inside Route Handlers — verified behaviorally (all three
  route handlers correctly return `307` when unauthenticated); the
  internal mechanism (how Next converts the thrown redirect signal into
  an HTTP response for a Route Handler) is taken on trust in the
  framework, not traced through Next's own source.

## Verification performed

- `npm run typecheck` (via `npx tsc --noEmit`) — clean
- `npm run lint` — clean
- `npm test` — 111/111 passing (9 new tests added across the two fixes)
- `npm run build` — production build succeeds
- No schema or migration changes were required for either fix.
