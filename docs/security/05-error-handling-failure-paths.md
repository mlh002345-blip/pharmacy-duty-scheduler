# Error Handling & Failure Paths

Date: 2026-07-08 (audit), fixes applied same day, same branch
(`deploy/postgresql-demo`).

## Scope

For every multi-step server action (a business mutation followed by an
audit-log write, or a password change followed by session invalidation),
asked: what happens if step N fails after step N-1 already committed?
Covers all mutating server actions across `src/app/(dashboard)/**/actions.ts`
and `src/app/(dashboard)/cizelgeler/[id]/atama/assignment-actions.ts`, plus
the schedule-generation library
(`src/lib/scheduling/generate-and-save-duty-schedule.ts`) and the shared
`writeAuditLog`/`invalidateUserSessions` helpers. Does not re-run the
Injection, Authentication, Authorization, or Secrets sweeps from the prior
four passes.

## Multi-step operations inspected

- Region CRUD: create / update / toggle-active / delete
  (`bolgeler/actions.ts`)
- Pharmacy CRUD: create / update / toggle-active / delete
  (`eczaneler/actions.ts`)
- Holiday CRUD: create / update / delete (`tatil-gunleri/actions.ts`)
- Unavailability CRUD: create / update / delete (`mazeretler/actions.ts`)
- Duty rule upsert (`kurallar/actions.ts`)
- Duty request: create / review (approve/reject/cancel)
  (`nobet-talepleri/actions.ts`)
- Historical duty import (batch + row insert)
  (`gecmis-nobetler/actions.ts`)
- Manual duty-balance adjustment: create / delete
  (`gecmis-nobetler/actions.ts`)
- User: create / update (incl. password change) / toggle-active
  (`kullanicilar/actions.ts`)
- Duty schedule: create (generation) / delete / publish / unpublish
  (`cizelgeler/actions.ts`, `generate-and-save-duty-schedule.ts`)
- Manual duty-assignment reassignment
  (`cizelgeler/[id]/atama/assignment-actions.ts`)

## Finding table

| # | Finding | Status |
|---|---|---|
| 1 | Business mutation committed before a separate, non-transactional audit-log write | **Fixed** |
| 2 | Password change and session invalidation were two independent, non-atomic writes | **Fixed** |
| 3 | Self-password-change: cookie-clear/redirect could be stranded by a downstream failure | **Fixed / covered by the same transaction** |
| 4 | Concurrent duplicate schedule creation could throw a raw P2002 error page | **Fixed** |
| 5 | Delete-safety-check-then-delete (region/pharmacy) has a TOCTOU gap between the count check and the delete | Documented only |
| 6 | Schedule generation writes (schedule + assignments + warnings) were already atomic | Documented (pre-existing, now also includes the audit log) |
| 7 | Schedule delete (3-table cleanup) was already atomic | Documented (pre-existing, now also includes the audit log) |
| 8 | Historical import batch + row insert was already atomic | Documented (pre-existing, now also includes the audit log) |

---

### 1. Business mutation + audit log now share one transaction — **Fixed**

**Before:** ~20 server actions followed the same pattern:
`await prisma.<model>.create/update/delete(...)` (committed) →
`await writeAuditLog({...})` (a second, independent
`prisma.auditLog.create` call) → `redirectWithMessage(...)`. If the audit
write failed after the mutation committed — a transient connection drop,
pool exhaustion — the exception propagated uncaught to Next's default
error boundary. The user saw a generic failure page even though their
region/pharmacy/schedule/assignment change had already gone through, and
the audit trail had a permanent, silent gap for that change.

**Fix:**
- `writeAuditLog` (`src/lib/audit.ts`) now requires an explicit Prisma
  client as its first argument instead of always reaching for the global
  `prisma` singleton: `writeAuditLog(client, params)`. This forces every
  call site to consciously pass either the global `prisma` (for
  standalone reads/writes outside a transaction) or a transaction's `tx`
  client — there is no silent default that would let a call accidentally
  skip the transaction.
- Every action listed above now wraps its mutation and its
  `writeAuditLog(tx, ...)` call inside a single
  `prisma.$transaction(async (tx) => { ...tx.model.create/update/delete...; await writeAuditLog(tx, {...}); })`.
  If the audit write throws, the whole transaction rolls back — the
  mutation and the audit record either both land or neither does.
- `redirectWithMessage`/`redirect`/`revalidatePath` calls were left
  **outside** the transaction in every case, per the fix requirement —
  Next's `redirect()` throws internally as its navigation mechanism, and
  throwing inside a `prisma.$transaction` callback would be
  indistinguishable from a real transaction failure.
- The two schedule-delete and historical-import actions already used
  `prisma.$transaction` for their own multi-table writes; those were
  converted to also include the `writeAuditLog` call in the same
  transaction rather than opening a second, separate transaction/write
  afterward.
- `generateAndSaveDutySchedule` (used by `createDutyScheduleAction`) now
  takes a `userId` parameter and writes its own audit log entry inside
  the same transaction that creates the `DutySchedule` +
  `DutyAssignment` + `DutyScheduleWarning` rows, instead of the caller
  doing a separate audit write after the function returns.

**No transaction helper wrapper (like `writeAuditLogTx`) was introduced** —
`writeAuditLog` itself was changed to require a client argument, which is
simpler than maintaining two parallel functions and makes "did I forget
to wrap this" a compile error rather than a runtime gap.

### 2 & 3. Password change, session invalidation, and the self-change redirect — **Fixed**

**Before:** `updateUserAction` ran `prisma.user.update(...)` (new
`passwordHash`), then — as a separate call — `invalidateUserSessions(id)`
(a second `prisma.session.deleteMany`), then a third,
separate `writeAuditLog(...)` call, and only *after* all of that,
`clearSessionCookie()` + `redirectWithMessage("/giris", ...)` for the
self-change case. A failure on the session-deletion step after the
password had already committed would leave the new password saved but
the target user's old session tokens still valid — silently defeating
the exact fix from the Authentication & Session Handling sweep
(`docs/security/02-authentication-session-handling.md`). A failure on
the audit-log step in the self-change case would additionally strand the
acting admin with a stale cookie and a raw error page instead of the
designed "please log back in" redirect.

**Fix:**
- `invalidateUserSessions` (`src/lib/auth/session.ts`) now accepts an
  optional Prisma client, defaulting to the global `prisma`:
  `invalidateUserSessions(userId, client = prisma)`.
- `updateUserAction` now wraps `tx.user.update(...)`,
  `invalidateUserSessions(id, tx)` (only when the password changed), and
  `writeAuditLog(tx, ...)` in one `prisma.$transaction`. If any of the
  three steps fails, all three roll back — a password can never be
  changed without its session invalidation and audit record landing
  alongside it, and vice versa.
- `clearSessionCookie()` and `redirectWithMessage("/giris", ...)` for the
  self-change case run **after** the transaction resolves successfully —
  they were already correctly placed outside the transaction boundary
  (they're not database operations), and now they only run once the
  transaction is known to have committed, so there's no path where the
  cookie is cleared/redirect fired without the underlying data actually
  being consistent.
- Preserved behavior exactly as required: an admin editing someone
  else's password stays logged in (their own session is untouched); an
  admin changing their own password is logged out and redirected to
  `/giris` with a success message once the transaction has committed.

### 4. Concurrent duplicate schedule creation — **Fixed**

**Before:** `createDutyScheduleAction` checked
`prisma.dutySchedule.findUnique({ year_month_regionId })` for "does this
already exist," ran the (non-trivial) schedule-generation computation,
then wrote via `generateAndSaveDutySchedule`. Two concurrent submissions
for the same region/month/year could both pass the initial check before
either committed; the second write then hit the database's
`@@unique([year, month, regionId])` constraint and threw a raw
`PrismaClientKnownRequestError` (P2002) that the action's `catch` block
didn't handle, falling through to Next's generic error page.

**Fix:** the `catch` block now checks
`error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"`
and returns the exact same `ActionState` (same Turkish message,
`"Bu bölge için seçilen ay ve yılda zaten bir nöbet çizelgesi mevcut."`)
already used for the sequential/pre-check case — extracted into a shared
`duplicateScheduleState` constant so both paths stay in sync. This
transaction's only write with a unique constraint is the schedule
create, so the P2002 code alone is unambiguous here; other, genuinely
unexpected Prisma errors are still re-thrown, not hidden.

---

## Documented-only items (no code change)

### 5. Delete-safety-check TOCTOU on region/pharmacy delete

`deleteRegionAction` and `deletePharmacyAction` both run a `count()`
safety check (no attached pharmacies / no attached duty assignments)
*before* the delete, as two separate statements. A record could
theoretically be attached in the gap between the count and the delete
under concurrent writes. This was not changed in this pass: the
underlying schema relations (`Pharmacy.regionId → Region`,
`DutyAssignment.pharmacyId → Pharmacy`) both use `onDelete: Restrict`
(confirmed in `prisma/schema.prisma`), so a delete that would violate
referential integrity fails at the database level rather than silently
corrupting data — the race can produce an unhandled exception (a worse
error message than the friendly pre-check text) but not orphaned rows.
Making this fully race-free would require re-running the count inside
the same transaction as the delete, which was judged out of scope for
this pass since no corruption results today; flagged here for a future
pass if it becomes a real operational annoyance.

### 6, 7, 8. Pre-existing atomic writes, now also covering the audit log

Three write paths were already correctly wrapped in
`prisma.$transaction` before this pass and did not need new atomicity —
only the audit-log call was folded into their existing transaction
boundary instead of running as a separate write afterward:
- `generateAndSaveDutySchedule`: `DutySchedule` + `DutyAssignment[]` +
  `DutyScheduleWarning[]` creation.
- `deleteDutyScheduleAction`: `DutyScheduleWarning` + `DutyAssignment` +
  `DutySchedule` deletion (converted from array-form `$transaction([...])`
  to callback form so the audit write could join it).
- `historicalImportAction`: `HistoricalDutyImportBatch` +
  `HistoricalDutyRecord[]` creation.

## Verification performed

- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm test` — 138/138 passing (8 new: 2 in `bolgeler/actions.test.ts`,
  2 in `eczaneler/actions.test.ts`, 1 in `kullanicilar/actions.test.ts`,
  2 in the new `assignment-actions.test.ts`, 3 in the new
  `cizelgeler/actions.test.ts` — covering both the happy paths and the
  audit-failure/session-failure rollback scenarios)
- `npm run build` — production build succeeds, all routes registered
- No schema or migration changes were required — every fix is a query/
  transaction-boundary change; `npx prisma migrate deploy` against a
  fresh local Postgres confirmed "All migrations have been successfully
  applied" with none pending, both before and after
- Live verification against real Postgres + a running dev server (not
  just mocked tests):
  - Manual duty-assignment reassignment: confirmed end-to-end through
    the actual UI (including the "minimum days between duties" override
    confirmation step), and confirmed the resulting `DutyAssignment`
    `UPDATE` audit-log row landed in the database
  - Publish / unpublish: confirmed both status flips took effect and
    both wrote their `DutySchedule` `UPDATE` audit-log rows
  - Duplicate schedule: submitting a region/month/year that already has
    a published schedule (seeded data) returned the friendly Turkish
    duplicate message, not an error page
  - User password change: an admin changing another user's (STAFF)
    password confirmed via direct DB query that the target user's
    `Session` rows were deleted (0 remaining) and the `User` `UPDATE`
    audit-log row recorded `passwordChanged: true`, while the acting
    admin's own session remained valid (still authenticated on the next
    request)
  - Self-password-change: confirmed redirect to `/giris` with the
    success message correctly encoded in the redirect URL
  - Historical import: downloaded the real template via the
    authenticated route, uploaded it back through the preview → confirm
    flow, and confirmed both the `HistoricalDutyImportBatch` row and its
    `CREATE` audit-log row were created together
  - `/veri-kontrol` loads correctly (200) for an authenticated STAFF user

## Remaining recommendations (not fixed in this pass, out of scope)

- Consider re-running the region/pharmacy delete safety count inside the
  same transaction as the delete if the TOCTOU gap in finding #5 is ever
  observed causing user-facing raw error pages in production, rather
  than pre-emptively adding complexity now.
- The self-password-change flow's `/giris?success=...` redirect message
  is not currently rendered by the login page — `src/app/giris/page.tsx`
  and `login-form.tsx` don't read the `success` search param at all
  (this is true for every `redirectWithMessage(..., "/giris", ...)` call
  site, not something introduced by this pass). This is a UI display gap,
  not an error-handling/atomicity issue, so it was left unchanged per
  this pass's "do not redesign UI" scope — worth a small follow-up if a
  future pass touches the login page.
