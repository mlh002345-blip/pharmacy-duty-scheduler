# Concurrency & Race Conditions

Date: 2026-07-08 (audit + fixes), same branch (`deploy/postgresql-demo`).

## Runtime model

Next.js Server Actions/Route Handlers run in Node.js: single-threaded per
request, but the process serves many requests concurrently via the event
loop, all sharing one Prisma connection pool against Postgres. There is no
shared in-process mutable state anywhere in the codebase (confirmed by
search — no module-level `let`/caches/counters), so classic in-memory
data-race categories (unsynchronized shared variables, JS-level lock
ordering/deadlock) don't apply. Every race in this app can only happen in
the database, across separate statements within one request or between
two concurrent requests.

## Findings table

| # | Finding | Status |
|---|---|---|
| 1 | Concurrent admin deactivation could leave zero active admins | **Fixed** |
| 2 | Manual duty-assignment reassignment could double-book a pharmacy on one date | **Fixed** |
| 3 | Duty request could be reviewed twice, second reviewer silently overwrites first | **Fixed** |
| 4 | Region/User unique-name/email checks raced to a raw P2002 | **Fixed** |
| 5 | Holiday duplicate date/type had no pre-check and could throw raw P2002 | **Fixed** |
| 6 | No shared in-process mutable state | Clean |
| 7 | Duty balance has no stored running total (no lost-update category) | Clean |
| 8 | `DutyRule.upsert` is already atomic | Clean |

---

### 1. Concurrent admin deactivation — **Fixed**

**Before:** `updateUserAction` and `toggleUserStatusAction` each read
`activeAdminCount` as a separate statement *before* their own
transaction. Two requests deactivating two different admins could both
read the same pre-write count, both pass, both commit — leaving zero
active admins with no error to either actor.

**Fix:** added `src/lib/auth/admin-guard.ts` —
`assertLastActiveAdminNotRemoved(tx)` — called from *inside* the same
`prisma.$transaction` as the write, immediately before it, in both
`updateUserAction` and `toggleUserStatusAction`. It first acquires a
Postgres session/transaction-scoped advisory lock
(`pg_advisory_xact_lock(hashtext('pharmacy-duty-scheduler:last-active-admin'))`)
via `tx.$executeRaw`, then recounts active admins. The lock serializes
every admin-deactivation transaction system-wide: a second concurrent
transaction blocks on the lock until the first commits or rolls back,
and Postgres's Read Committed isolation guarantees the second
transaction's subsequent `count()` then sees the first transaction's
already-committed result — so the second deactivation correctly sees
the reduced count and is blocked. This is a plain advisory lock rather
than Serializable isolation + retry handling, which was chosen because
it fails predictably (a clean, deterministic block with the existing
friendly message) rather than a serialization-conflict error that would
need its own retry/translation logic.

Preserved behavior exactly as required: self-deactivation is still
blocked by the earlier, unrelated check; an admin changing another
user's non-admin-status fields still works with zero added lock
overhead (the lock is only acquired when `isDeactivatingAdmin` is true);
STAFF/VIEWER toggles never touch the guard at all.

**Tests:** `src/lib/auth/admin-guard.test.ts` (lock-then-count ordering,
throws at count ≤ 1, resolves above that); `kullanicilar/actions.test.ts`
adds a "simulates two concurrent deactivation requests" test where a
shared mutable counter models the committed state across two sequential
calls (real concurrency isn't reproducible with a synchronous mock, but
this proves the second call's recount reflects the first's commit, which
is exactly what the advisory lock guarantees against a real database),
plus new `toggleUserStatusAction` tests (blocks last admin, STAFF/VIEWER
toggle unaffected, activating an admin unaffected).

### 2. Manual assignment double-booking — **Fixed (migration added)**

**Before:** `editDutyAssignmentAction`'s `isAlreadyAssignedOnDate` check
ran against a snapshot of the schedule's assignments loaded once at the
top of the action. Two concurrent edits on different assignment rows in
the same schedule, each picking the same replacement pharmacy for the
same date, could both pass their own stale check and both commit — no
database constraint existed to catch it.

**Fix — database-level, per the requirement's preference:** added
`@@unique([dutyScheduleId, pharmacyId, date])` to `DutyAssignment` in
`prisma/schema.prisma`. This is the one truly reliable defense — no
application-level check-then-act can fully close this race, but a
unique index makes the invariant unconditional at the database. It
covers only `DutyAssignment`; `HistoricalDutyRecord` is a separate table
(imported historical data, never converted into live assignments) and is
untouched.

**Migration:** `prisma/migrations/20260708120000_duty_assignment_unique_pharmacy_date/`.

**Preflight check performed before writing the migration** (per the
task's requirement): queried the local seeded Postgres database for
existing violations —
```sql
SELECT "dutyScheduleId", "pharmacyId", "date", COUNT(*)
FROM "DutyAssignment"
GROUP BY "dutyScheduleId", "pharmacyId", "date"
HAVING COUNT(*) > 1;
```
Result: **0 rows** across 62 seeded assignment rows (one published +
one draft schedule, generated by the real scheduling algorithm). The
migration was then applied via `npx prisma migrate deploy` against that
same seeded database and succeeded cleanly. The scheduling algorithm
never intentionally assigns a pharmacy twice on one date within a
schedule, so this reflects normal production data, not a lucky empty
seed.

`editDutyAssignmentAction` now catches the resulting `P2002` and returns
the required friendly Turkish message:
`"Bu eczane aynı tarihte bu çizelgede zaten nöbetçi olarak atanmış."`
Any other, unexpected Prisma error is still re-thrown, not hidden.

**Tests:** `assignment-actions.test.ts` adds a P2002-mapping test, a
"still throws unexpected errors" test, and confirms the existing
successful-reassignment test still passes unchanged.

### 3. Duty request double review — **Fixed**

**Before:** `reviewDutyRequestAction` read `request.status`, checked it
was `PENDING`/`LATE`, then — as a later, separate statement — updated
it. Two reviewers reviewing the same request at once could both pass the
read-time check; whichever `update` committed last silently overwrote
the other's decision, with two conflicting audit-log entries.

**Fix:** the update is now a single conditional statement —
`tx.dutyRequest.updateMany({ where: { id, status: { in: ["PENDING", "LATE"] } }, data: {...} })` —
inside the existing transaction. Postgres evaluates the `WHERE` clause
against the current committed row at execution time, so if a first
reviewer's transaction already committed a status change, the second
reviewer's `updateMany` matches zero rows. The action checks
`count === 0` and returns the required friendly message
`"Bu talep daha önce incelenmiş. Lütfen sayfayı yenileyin."` — the audit
log is written only when `count === 1`, inside the same transaction as
the conditional update, so a "stale review" attempt writes no audit
record and appears to the user as a clean rejection rather than a
last-write-wins overwrite.

**Tests:** `nobet-talepleri/actions.test.ts` — stale second review
returns the friendly message with no audit write; a successful review
updates conditionally and writes the audit log in the same call; the
existing sequential-status-check path (request already `APPROVED` at the
initial read) still blocks with its original message.

### 4. Region/User duplicate-name/email races — **Fixed**

**Before:** `createRegionAction`/`updateRegionAction` and
`createUserAction`/`updateUserAction` each had a `findUnique`/`findFirst`
pre-check before their write, with the same shape as the schedule
duplicate race fixed in the prior Error Handling sweep. A concurrent
double-submission with the same region name or user email could pass
the pre-check and raise a raw, uncaught `P2002` on the write.

**Fix:** each of the four actions now wraps its `$transaction` call in a
`try/catch` that checks `error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"` and returns the exact same
`ActionState` already used for the sequential case — extracted into
shared `DUPLICATE_REGION_NAME_STATE`/`DUPLICATE_EMAIL_STATE` constants
so both the pre-check and the race-recovery path stay in sync. Any
other, unexpected Prisma error is still re-thrown.

**Tests:** `bolgeler/actions.test.ts` adds create/update P2002-mapping
tests, an "unexpected error still throws" test, and a normal-creation
regression test.

### 5. Holiday duplicate date/type — **Fixed**

**Before:** `Holiday` has `@@unique([date, type])`, but
`createHolidayAction` had no pre-check at all (unlike every other create
action in the app) — even a single, non-concurrent duplicate submission
threw a raw `P2002`.

**Fix:** both `createHolidayAction` and `updateHolidayAction` now catch
`P2002` and return the required friendly Turkish message
`"Bu tarih ve tür için tatil günü zaten kayıtlı."` A pre-check was not
added in addition to the catch — the catch alone closes both the
single-request gap and the concurrent-race gap with one, smaller change,
consistent with "prefer minimal, targeted fixes."

**Tests:** `tatil-gunleri/actions.test.ts` — P2002 mapping on both
create and update, "unexpected error still throws," and a normal
creation regression test.

---

## Clean / documented-only (no change needed)

### 6. No shared in-process mutable state

Confirmed by search — no module-level `let`/`var`/mutable `Map`/`Set`
anywhere in `src/`. The Prisma client singleton (`src/lib/prisma.ts`) is
evaluated once, synchronously, at module import time under Node's module
cache, not lazily per-request — there is no first-access race to guard
against.

### 7. Duty balance has no stored running total

`src/lib/balance/duty-balance.ts` computes every balance on demand via
`groupBy`/`SUM` aggregation over insert-only `DutyBalanceAdjustment` and
`DutyAssignment` rows. There is no "read balance, compute new balance,
write balance" pattern anywhere, so the classic "balance-then-deduct"
lost-update race this sweep looked for doesn't exist in this app by
construction.

### 8. `DutyRule.upsert` is already atomic

`kurallar/actions.ts`'s `upsertDutyRuleAction` uses a single Prisma
`upsert` keyed on `DutyRule.regionId @unique`, not a separate
check-then-create/update. Two concurrent submissions for the same
region safely serialize at the database level with no uncaught error
and no lost update — this needed no change.

### Not re-litigated from the prior Error Handling sweep

The region/pharmacy delete-safety `count()`-then-`delete()` TOCTOU
(documented in `docs/security/05-error-handling-failure-paths.md`,
finding #5) is the same shape of check-then-act race but was already
assessed there: it's self-healing because of `onDelete: Restrict`
foreign keys, so it can surface an unhandled error under a race but
cannot corrupt data. Not touched again in this pass.

## Interleavings prevented

- **Two admins deactivating each other simultaneously** (or two
  different admins being deactivated by two different actors at once)
  can no longer leave zero active admins — the second transaction now
  always sees the first's committed result before deciding.
- **Two staff members reassigning different duty-assignment rows to the
  same pharmacy on the same date at the same time** can no longer both
  succeed — the database now unconditionally rejects the second write.
- **Two reviewers approving/rejecting the same pending request at the
  same time** can no longer both "win" — the second reviewer's
  conditional update matches zero rows and they're told to refresh,
  with no audit-log entry recorded for the attempt that didn't take
  effect.
- **Two duplicate-name/email/holiday submissions racing the pre-check**
  no longer produce a raw crash page — both land on the same friendly
  message a sequential duplicate would have gotten.

## Migration added: yes

`prisma/migrations/20260708120000_duty_assignment_unique_pharmacy_date/` —
adds `UNIQUE (dutyScheduleId, pharmacyId, date)` on `DutyAssignment`.

## Deployment notes

- **Preflight already run locally** against a realistic seeded Postgres
  database (100 pharmacies, 2 generated schedules, 62 assignment rows)
  with zero violations found; see finding #2 above for the exact query.
- On Railway (or any environment with pre-existing production data),
  run the same preflight query against the production database **before**
  deploying this migration:
  ```sql
  SELECT "dutyScheduleId", "pharmacyId", "date", COUNT(*)
  FROM "DutyAssignment"
  GROUP BY "dutyScheduleId", "pharmacyId", "date"
  HAVING COUNT(*) > 1;
  ```
  If this returns any rows, they must be resolved (e.g., by manually
  reassigning or deleting the duplicate row on the more recently created
  side, per the audit log) **before** `prisma migrate deploy` — a
  `CREATE UNIQUE INDEX` will otherwise fail outright and the deploy will
  abort, not silently corrupt data.
- `npx prisma migrate deploy` was run locally and applied cleanly; a
  subsequent run reported "No pending migrations to apply."
- No other schema changes were made — findings #1, #3, #4, #5 are all
  query/transaction-boundary changes with no migration.

## Verification performed

- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm test` — 161/161 passing (23 new: 4 in `admin-guard.test.ts`, 6 in
  `kullanicilar/actions.test.ts`, 4 in `bolgeler/actions.test.ts`, 4 in
  `tatil-gunleri/actions.test.ts` (new file), 4 in
  `nobet-talepleri/actions.test.ts` (new file), 3 in
  `assignment-actions.test.ts`)
- `npm run build` — production build succeeds, all routes registered
- `npx prisma migrate deploy` against a fresh local Postgres — applied
  cleanly, confirmed "No pending migrations to apply" on a second run
- Live verification against real Postgres + a running dev server:
  - Manual assignment reassignment still works end-to-end through the
    real UI (including the minimum-days-between-duties override step)
  - Duplicate region name, duplicate holiday date+type, and duplicate
    user email each returned their friendly Turkish message through the
    real UI instead of a crash page
  - Duty request review: approving a pending request worked, and
    revisiting the same (now-reviewed) request's page confirmed its
    review controls are gone (the page only renders them for
    `PENDING`/`LATE` status)
  - Admin create → deactivate → reactivate confirmed working end-to-end
    via direct database inspection (`isActive` flipped correctly both
    times); the true concurrent-deactivation-blocked path cannot be
    triggered by a single sequential actor by construction (the acting
    admin always counts as one of the active admins), so that specific
    branch is verified by the unit/simulation tests instead, as noted
    in finding #1
  - `/veri-kontrol` loads correctly (200) for an authenticated STAFF user
