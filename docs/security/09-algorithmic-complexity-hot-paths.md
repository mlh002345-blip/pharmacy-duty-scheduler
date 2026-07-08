# Algorithmic Complexity & Hot Paths

Date: 2026-07-08 (audit + fixes), same branch (`deploy/postgresql-demo`).

## Scope

Identified the paths executed most often (admin dashboard `/`, the
public `/vatandas` page) or handling the most data (schedule generation,
manual assignment validation, historical import), and looked for nested
iteration over unbounded data, linear scans repeated inside loops,
repeated recomputation of invariants, and redundant serialization. This
document covers the audit and the two actionable fixes from it.

## Assumed load model

- **Schedule generation**: P = eligible pharmacies in one region (seed
  ≈20/region; a large chamber could plausibly reach 50-200), D = days in
  the month (28-31), U/R = `Unavailability`/approved `DutyRequest` rows
  already DB-filtered to that region+month (typically single digits
  today, but not bounded by the query shape as those tables grow).
- **Dashboard / `/veri-kontrol`**: these are the two most-frequently
  loaded routes in the app (the post-login landing page and its "run the
  same checks in full" sibling); each independent page load re-triggers
  a 13-query fan-out with two fully unbounded table scans
  (`Pharmacy`, `Unavailability`).
- **Manual assignment edit**: a single interactive, human-triggered
  action (not bulk), but its validation query is unbounded by date, so
  its cost is proportional to A = total `DutyAssignment` rows ever
  created for one pharmacy, which grows every month forever.

## Finding table

| # | Finding | Status |
|---|---|---|
| 1 | `generateDutySchedule` repeated linear scans in the day/pharmacy loop | **Fixed** |
| 2 | Dashboard/`/veri-kontrol` re-run the full data-health computation on every load | **Fixed** |
| 3 | `editDutyAssignmentAction`'s historical-assignment query is unbounded by date | Documented only |
| 4 | `/nobet-dengesi` "all regions" view aggregates system-wide with no cache | Documented only |
| 5 | Historical Excel import analyzer is O(n) via `Map`/`Set` | Clean |
| 6 | Public `/vatandas` uses a request-level `cache()` | Clean |
| 7 | PDF/Excel exports are bounded by one schedule's assignment count | Clean |

---

### 1. `generateDutySchedule` repeated linear scans — **Fixed**

**Before:** `src/lib/scheduling/generate-duty-schedule.ts` re-scanned the
full `unavailabilities`, `blockingRequests`, and `preferRequests` arrays
with `.some(...)` for every pharmacy on every day of the month —
**O(D × P × (U + R))** — even though these arrays are never keyed by
`pharmacyId` before the loop.

**Fix:** added a small `indexByPharmacyId()` helper and built three
`Map<pharmacyId, T[]>` indexes once, before the day loop:
`unavailabilitiesByPharmacy`, `blockingRequestsByPharmacy`,
`preferRequestsByPharmacy`. `isUnavailable`, `isBlockedByRequest`, and
`hasPreferenceForDate` now do a `Map.get(pharmacyId)` (O(1)) followed by
a scan of only that pharmacy's own (typically 0-2 entry) sub-array,
instead of the whole system-wide array. This reduces the day-loop cost
to effectively **O(D × P)** plus a one-time **O(U + R)** indexing pass.
No scoring weights, sort order, or assignment rules were touched —
purely a lookup-strategy change.

**Tests:** all 15 pre-existing `generate-duty-schedule.test.ts` tests
(covering unavailability blocking, region/active-pharmacy filtering,
holiday weights, fairness-metric alternation, opening balance,
CANNOT_DUTY/EMERGENCY_EXCUSE blocking, PENDING/REJECTED requests not
blocking, and PREFER_DUTY as a tie-break preference) pass unchanged
after the refactor, confirming behavior parity. Added one new test —
"respects multiple separate unavailability windows for the same
pharmacy" — specifically targeting the new per-pharmacy indexing (two
non-adjacent unavailability windows for one pharmacy, both correctly
still block that pharmacy while an unaffected second pharmacy fills
those dates).

### 2. Dashboard/`/veri-kontrol` data-health recomputation — **Fixed**

**Before:** `getDataHealthReport()` (`src/lib/health/data-health.ts`)
ran a 13-query `Promise.all` — including two fully unbounded
`findMany()` calls over `Pharmacy` and `Unavailability` — and was called
independently by both `src/app/(dashboard)/page.tsx` (the dashboard,
almost certainly the single most-loaded route in the app) and
`src/app/(dashboard)/veri-kontrol/page.tsx`. Both pages are
`force-dynamic`, so nothing cached this across requests; the identical
computation reran on every visit to either page, even seconds apart
with no underlying data change.

**Fix:** added a short-lived, process-local, in-memory TTL cache around
the query-fetching logic (renamed the original body to a private
`fetchDataHealthReport()`, and `getDataHealthReport()` is now a thin
caching wrapper around it):
```ts
const DATA_HEALTH_CACHE_TTL_MS = 60_000;
let cachedReport: { value: DataHealthReport; expiresAt: number } | null = null;

export async function getDataHealthReport(options?: { now?: number }) {
  const now = options?.now ?? Date.now();
  if (cachedReport && cachedReport.expiresAt > now) return cachedReport.value;
  const report = await fetchDataHealthReport();
  cachedReport = { value: report, expiresAt: now + DATA_HEALTH_CACHE_TTL_MS };
  return report;
}
```
**Why not `React.cache()`:** that only memoizes within a single request
— it would not help here, since the dashboard and `/veri-kontrol` are
always separate requests (and even repeated visits to the same page are
separate requests). A cross-request cache was required, per the task.

**Why not `unstable_cache`:** Next's `unstable_cache` was considered
(it's the framework's own cross-request cache primitive), but it relies
on Next's internal request/work-unit storage and is difficult to
exercise deterministically in a plain Vitest environment (no Next
server context), which would have worked against the "make sure the
cache does not break tests, and can be tested" requirement. The
hand-rolled module-level TTL cache is trivial to reason about, has no
framework dependency, and is directly unit-testable by passing an
explicit `now` — used exactly that way in the new tests to simulate TTL
expiry without real sleeping.

**Why not Redis/external cache:** not needed — Railway runs this app as
a single long-lived Node process (not per-request serverless), so a
module-level variable already persists correctly across requests within
that process for the app's current deployment shape, with zero added
infra.

**No per-user/sensitive data cached:** `getDataHealthReport()` takes no
user-specific input and returns only system-wide aggregate counts and
finding messages (region/pharmacy setup completeness, pending-request
counts, published-schedule counts) — safe to share across all viewers
via one cache entry.

**Invalidation / staleness:** no existing mechanism in the app currently
ties any of the ~10 mutating action files (region, pharmacy, holiday,
duty rule, duty request, historical import, etc.) to a "data health"
invalidation hook, and wiring one into all of them was judged out of
scope for this pass (a much larger, cross-cutting change than the
finding warranted). **Documented staleness: the report can be up to 60
seconds stale after any mutation elsewhere in the app** — e.g., a
newly-created region might not appear in the "Bölge tanımlandı mı?"
checklist item for up to a minute. This is acceptable because the report
is purely informational: nothing in the app *reads* this cache to gate
or validate a real mutation — `getSchedulePreCheck` (used by actual
schedule generation) queries fresh data independently and was confirmed
to never consume `getDataHealthReport`'s output.

**Tests** (`src/lib/health/get-data-health-report.test.ts`, new, with
`@/lib/prisma` mocked): a second call within the 60s TTL returns the
cached result without re-querying the database; a call after the TTL has
elapsed re-queries; a cache hit returns an object deeply equal to the
fresh computation. The pre-existing `data-health.test.ts` (13 tests
against the pure `runDataHealthCheck` function) is untouched by this
change and continues to pass, since it never imports the caching
wrapper.

---

## Documented-only items (no code change)

### 3. `editDutyAssignmentAction`'s historical query is unbounded by date

`src/app/(dashboard)/cizelgeler/[id]/atama/assignment-actions.ts:140-142`
still fetches every `DutyAssignment` a candidate pharmacy has ever had
(`where: { pharmacyId: candidatePharmacyId }`, no date bound) to check
the `minDaysBetweenDuties` rule. Left unfixed in this pass — it's a
single interactive action (not a loop or a frequently-hit path), and at
realistic per-pharmacy assignment volumes (tens of rows per year) the
cost is negligible today. Flagged in the original sweep as worth a
`where: { date: { gte, lte } }` bound (a window of roughly
`± minDaysBetweenDuties` days) whenever this file is next touched.

### 4. `/nobet-dengesi` "all regions" view has no cache

`src/app/(dashboard)/nobet-dengesi/page.tsx` → `getDutyBalanceRows()`
aggregates across every pharmacy and every historical/assignment/
adjustment row system-wide when no region filter is applied, on another
`force-dynamic` page with no cache. Lower severity than finding #2: the
heavy lifting is pushed to Postgres via `groupBy` (index-friendly, scales
far better than pulling raw rows into app memory) rather than raw
`findMany` scans, and this page is viewed less often than the dashboard.
Not fixed in this pass — same shape as #2 at smaller scale; would use
the identical TTL-cache technique if it's ever worth doing.

---

## Clean areas

### 5. Historical Excel import analyzer — O(n) via `Map`/`Set`

`analyzeImportRows` (up to `MAX_IMPORT_ROWS = 5000`) builds
`regionByName`, `pharmacyByNameAndRegion`, `pharmaciesByName`, and
`seenDatePharmacy` once up front and does only O(1) map/set lookups per
row — confirmed no per-row scan against the full row/pharmacy/region
arrays anywhere in the matching logic.

### 6. Public `/vatandas` request-level cache

`src/lib/scheduling/public-duty-lookup.ts` wraps its published-schedule
lookup in React's `cache()`, with an in-code comment explaining that
today/tomorrow (and an optional custom date) usually fall in the same
month, so without it the citizen page would look up the same schedule
2-3 times per request. This is the correct tool for that specific
problem (same-request deduplication) — left as-is.

### 7. PDF/Excel exports are bounded by one schedule's assignment count

Both export builders iterate `schedule.assignments`, bounded by
`dailyDutyCount × daysInMonth` for a single schedule (realistically
≤100 rows) — linear in a small, naturally-bounded input, never scales
with total system data.

## Verification performed

- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm test` — 173/173 passing (4 new: 1 in
  `generate-duty-schedule.test.ts`, 3 in the new
  `get-data-health-report.test.ts`)
- `npm run build` — production build succeeds, all routes registered
- No schema or migration changes were required — both fixes are
  in-process algorithm/caching changes with no persisted state.
- Live verification against real Postgres + a running dev server:
  `/` (dashboard) and `/veri-kontrol` both load correctly and show the
  same checklist categories and counts (allowing for the 60s cache TTL
  between the two page loads); `/cizelgeler/yeni` schedule generation
  still produces a correct draft schedule; `/vatandas` still resolves
  today/tomorrow duty pharmacies correctly.
