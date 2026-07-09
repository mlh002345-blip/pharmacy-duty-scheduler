# Idempotency & Retry Safety

Date: 2026-07-09 (audit + fixes), same branch (`deploy/postgresql-demo`).

## Scope

Assumed every state-changing operation can be delivered twice (double
click, browser back+resubmit, client-side network retry — this app has
no queue system, confirmed in a prior sweep, so "queue redelivery" does
not apply). Inventoried every `create`/`update`/`upsert`/`delete` server
action against `prisma/schema.prisma`'s unique constraints and classified
each. This document covers the audit and the four fixes from it.

## Operation inventory summary

~36 state-changing operations were inventoried across `src/app/**/actions.ts`,
the public `eczane-talep/[token]` endpoint, and schedule generation.

## Classification table

| Classification | Operations |
|---|---|
| **Naturally idempotent** (absolute-value updates, deletes-by-id/`deleteMany`) | Pharmacy/Region/Unavailability/Holiday updates, all deletes, `publishDutyScheduleAction`/`unpublishDutyScheduleAction`, `logoutAction`/`invalidateUserSessions` |
| **Protected by DB unique constraint / explicit dedup check** | Holiday create (`@@unique([date,type])`), `upsertDutyRuleAction` (`regionId @unique`), `createUserAction` (`email @unique`), schedule generation (`@@unique([year,month,regionId])`), `editDutyAssignmentAction` (`@@unique([dutyScheduleId,pharmacyId,date])`), `reviewDutyRequestAction` (conditional `updateMany` on status), Region create (`name @unique`), last-active-admin guard (Postgres advisory lock) |
| **Fixed this pass** | `createPublicDutyRequestAction`, `historicalImportAction` (import step), `createBalanceAdjustmentAction`, `togglePharmacyStatusAction`/`toggleUserStatusAction`/`toggleRegionStatusAction` (renamed to `set*StatusAction`) |
| **Documented-only, still UNSAFE** | `createPharmacyAction`, admin `createDutyRequestAction`, `createUnavailabilityAction`, `writeAuditLog`, `loginAction`/`createSession` (low-risk, undeduped) |

---

## Fixed items

### 1. Public duty request duplicate submit — **Fixed**

**File:** `src/app/eczane-talep/[token]/actions.ts` (`createPublicDutyRequestAction`)

**Before:** no unique key on `DutyRequest`; a double-submitted public form
created two identical rows.

**Fix:** a `prisma.dutyRequest.findFirst` dedup check runs before create,
matching on the practical business key: `pharmacyId` (derived from the
token server-side, never client-supplied — unchanged), `requestType`,
`startDate`, `endDate`, `explanation` (already trimmed by the zod schema),
`source: "PUBLIC_LINK"`, and `status: { in: ["PENDING", "LATE"] }` (open,
non-final states). If a match exists, the action returns `{ success:
true, message: "Bu talep daha önce alınmış. Lütfen mevcut talebinizin
incelenmesini bekleyin." }` instead of creating a second row — rendered
by `PublicRequestForm` as the same confirmation screen a first-time
submitter sees, since from the pharmacist's perspective their request
*was* received. Genuinely different requests (different dates, type, or
explanation) are unaffected and still create a new row.

**No schema change.** This is a `findFirst`-then-`create` check, not a DB
constraint, so a residual race window exists under true concurrency (two
requests arriving within the same few milliseconds could both pass the
check before either commits its `create`). This was an explicit tradeoff
per the "no migration unless absolutely necessary" instruction — the
realistic threat here is double-click/resubmit, not two truly concurrent
public submissions, and the existing `MAX_OPEN_PUBLIC_REQUESTS = 10` cap
still bounds the worst case even if the race is hit.

**Tests** (`src/app/eczane-talep/[token]/actions.test.ts`, new): double-
submitting the same request creates only one row (second call's `create`
mock still shows `toHaveBeenCalledOnce()`); a different date range still
creates a new row; a different request type still creates a new row;
invalid-token and inactive-pharmacy behavior is unchanged (no DB writes,
same generic message, no info leak).

### 2. Historical import duplicate confirm — **Fixed**

**File:** `src/app/(dashboard)/gecmis-nobetler/actions.ts` (`historicalImportAction`)

**Before:** no dedup at all across separate submissions — the in-file
`seenDatePharmacy` check in `analyzeImportRows` only catches duplicate
rows *within one upload*, not a second click of "confirm import" for the
same file.

**Fix — no migration:** `computeImportFingerprint()` builds a
deterministic SHA-256 hash (Node's built-in `crypto`, no external
dependency) over the canonicalized, sorted set of *accepted* rows
(`dutyDate`, normalized `rawPharmacyName`, normalized `dutyType`,
`weight`, `matchedPharmacyId`) — the same fields that get persisted to
`HistoricalDutyRecord` and feed the duty-balance calculation. Before
creating a new batch, `historicalDutyImportBatch.findFirst({ where: {
note: fingerprint } })` checks whether an identical accepted-row set was
already imported. If found, the action returns `{ success: false,
message: "Bu geçmiş nöbet aktarımı daha önce içeri alınmış." }` without
touching the database further.

**Why the `note` field and not a new column:** `HistoricalDutyImportBatch.note`
is an existing `String?` column that was declared in the schema but never
written or read anywhere in the codebase (confirmed by search — not
displayed on `/gecmis-nobetler`, not referenced in any other action).
Repurposing it to store `fp:<hash>` is a zero-migration way to persist a
durable, DB-queryable fingerprint. If this field is ever needed for its
originally-intended purpose (a free-text admin note), a real migration
(a dedicated `importFingerprint String? @unique` column) would be the
correct next step — flagged here rather than done pre-emptively, per
"prefer no migration if a safe no-schema solution is possible."

**Preview and in-file dedup unchanged:** the fingerprint check only runs
in the `mode === "import"` (confirm) branch — preview requests never
call it or touch `historicalDutyImportBatch` at all. `analyzeImportRows`'s
`seenDatePharmacy` in-file duplicate detection is untouched.

**Residual race:** same caveat as item 1 — `findFirst` then `create` is
not atomic. Realistic for this action (a manual, deliberate admin
operation, not a hot public endpoint) but noted for completeness.

**Tests** (`src/app/(dashboard)/gecmis-nobetler/actions.test.ts`, new):
repeated final import of the identical accepted-row set calls
`historicalDutyImportBatch.create` and `historicalDutyRecord.createMany`
only once across two submissions; a different payload (different
pharmacy name) still imports as a second batch; an explicit test confirms
`historicalDutyRecord.createMany` is not called a second time on a
duplicate confirm (the mechanism the duty-balance double-count bug
depended on).

### 3. Balance adjustment duplicate submit — **Fixed**

**File:** `src/app/(dashboard)/gecmis-nobetler/actions.ts` (`createBalanceAdjustmentAction`)

**Before:** no unique key on `DutyBalanceAdjustment`; a double-submitted
adjustment form applied the same ± points twice.

**Fix:** a `prisma.dutyBalanceAdjustment.findFirst` dedup check runs
before create, matching `pharmacyId`, `reason`, `points`, `createdById`
(the current user), and `createdAt: { gte: now - 60s }` — a short recency
window (`DUPLICATE_ADJUSTMENT_WINDOW_MS = 60_000`) so that two
legitimately identical adjustments made minutes/days apart (e.g. the same
recurring correction) are not permanently blocked. A match returns `{
success: false, message: "Bu denge düzeltmesi daha önce kaydedilmiş." }`
— same `success: false` convention as the codebase's existing
`DUPLICATE_HOLIDAY_STATE`/`DUPLICATE_EMAIL_STATE` pattern. A different
reason or a different point value still creates a new row, unaffected.

**Tests**: double-submitting an identical adjustment (same pharmacy,
reason, points, user) creates only one row; a different reason still
creates a new row; a different point value still creates a new row.

### 4. Toggle actions replaced with explicit desired-state actions — **Fixed**

**Files:** `src/app/(dashboard)/eczaneler/actions.ts`,
`src/app/(dashboard)/bolgeler/actions.ts`,
`src/app/(dashboard)/kullanicilar/actions.ts`, and their three `page.tsx`
callers.

**Before:** `togglePharmacyStatusAction(id)` / `toggleRegionStatusAction(id)`
/ `toggleUserStatusAction(id)` each read the row's *current* `isActive`
from the database and wrote its negation. Two submissions of the same
button click (double-click, browser back+resubmit) each read-then-negate
independently, so the second call saw the first call's already-flipped
value and flipped it back — silently cancelling the admin's intended
change while still writing two redundant `AuditLog` "UPDATE" entries.

**Fix:** renamed to `setPharmacyStatusAction(id, isActive)` /
`setRegionStatusAction(id, isActive)` / `setUserStatusAction(id, isActive)`,
each now writing the **explicit target state passed by the caller**
instead of negating a fresh DB read. The three `page.tsx` files bind the
button's `action` with the target computed once at render time —
`setPharmacyStatusAction.bind(null, pharmacy.id, !pharmacy.isActive)` —
so every resubmission of that same rendered button (double-click or
retry) submits the *same* absolute target value and converges to the
same end state, instead of re-deriving a new target from a possibly
already-changed row. `StatusToggleButton`'s own interface, the Turkish
button labels ("Aktif Yap"/"Pasif Yap"), and the Turkish success/error
messages are all unchanged — this is a pure semantics fix, no UI
redesign.

**Last-active-admin protection preserved exactly:** `setUserStatusAction`
keeps the same `isDeactivatingAdmin` check and calls
`assertLastActiveAdminNotRemoved(tx)` (the Postgres advisory-lock guard)
inside the same transaction as before, now driven by the passed-in
`isActive` value instead of a locally negated one — the guard logic
itself was not touched.

**Tests** (`eczaneler/actions.test.ts`, `bolgeler/actions.test.ts`,
`kullanicilar/actions.test.ts`, extended/renamed): double-submitting a
deactivate call leaves the record inactive (not flipped back); double-
submitting an activate call leaves the record active; last-active-admin
protection still blocks deactivating the sole active admin, including
under a retried double-submit; STAFF/VIEWER status changes and the
region/pharmacy/user `AuditLog` write path are unaffected (pre-existing
assertions on `writeAuditLog`/`prisma.$transaction` wiring still pass
unchanged).

---

## Documented-only items (no code change)

### `createPharmacyAction` duplicate creates

No unique constraint on `Pharmacy.name`; a double-submitted "add
pharmacy" form creates two rows with identical name/address/region but
different ids and different `requestToken` public links. Left unfixed:
unlike a duty request or adjustment, a legitimate business reason exists
for two pharmacies sharing a name in different districts of the same
region in some chambers, so a blanket dedup-by-name check risks blocking
real, distinct pharmacies. This needs a clearer business-key policy
(name+address? name+district?) decided by the product owner before an
automated dedup check is safe to add — flagged for a future pass, not
fixed here.

### Admin `createDutyRequestAction` duplicate

Same missing-unique-key shape as the (now-fixed) public version, but the
admin entry path is staff-operated, not a public retry-prone form, and
staff may legitimately want to log two similar-looking requests for
different underlying reasons in quick succession. Needs a clearer
business-key policy (should admin-entered duplicates be blocked the same
way as public ones, or is staff intent trusted?) before applying the same
fix — documented, not fixed, this pass.

### `createUnavailabilityAction` duplicate

No unique constraint on `Unavailability`; a double-submitted "add
mazeret" form creates two identical rows for the same pharmacy/date
range. Needs the same business-key-policy decision as above (is a
"duplicate" here always unwanted, or could two overlapping reasons for
the same dates be legitimate?) before adding a dedup check — documented
only.

### `writeAuditLog` has no idempotency key

`AuditLog` is append-only with no dedup mechanism at all. Every action
above — including the ones now protected against duplicate *business*
rows — can still write an extra `AuditLog` entry if the underlying
request was retried after a stale read (e.g. two concurrent
`publishDutyScheduleAction` calls both passing a stale status check).
This doesn't corrupt scheduling/balance data, but the audit trail itself
is not fully replay-safe. Left unfixed: adding an idempotency key to
every audit-log call site is a much larger, cross-cutting change (~30+
call sites) than this pass's scope; flagged for a dedicated pass if audit
correctness under retries becomes a compliance requirement.

### `loginAction` can create redundant sessions

Every login form submission creates a fresh `Session` row (`Session.token`
is freshly random each time, so its `@unique` constraint never actually
triggers as a dedup mechanism). A double-submitted login creates two
valid, independent sessions for the same login action. Not corruption —
each session works correctly — just redundant rows. Left unfixed: low
severity, no business-data impact, and deduping logins by user+timestamp
would add complexity (what counts as "the same" login attempt?) for a
purely cosmetic row-count concern.

## Verification performed

- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm test` — 197/197 passing (17 new tests across
  `eczane-talep/[token]/actions.test.ts`,
  `gecmis-nobetler/actions.test.ts`, and extensions to
  `eczaneler/actions.test.ts`, `bolgeler/actions.test.ts`,
  `kullanicilar/actions.test.ts`)
- `npm run build` — production build succeeds, all routes registered
- No schema or migration changes were required or made — confirmed via
  `git status` showing no changes under `prisma/`. All four fixes are
  application-level dedup checks or a rename to explicit-state semantics;
  the historical-import fingerprint reuses an existing unused column
  (`HistoricalDutyImportBatch.note`) rather than adding one.
- Live verification against the dev server (no real Postgres configured
  in this environment, same limitation noted in prior sweeps): `/`,
  `/veri-kontrol`, and `/gecmis-nobetler` all correctly redirect to
  `/giris` (auth gate intact, routes compile and execute up to the DB
  call); the public `/eczane-talep/[token]` route reaches the same DB
  call as before this change with no new failure introduced by the dedup
  check itself.
