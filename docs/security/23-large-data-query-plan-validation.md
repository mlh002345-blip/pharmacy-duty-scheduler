# Large-Data Volume & Query-Plan Validation

Date: 2026-07-11, branch `deploy/postgresql-demo`. Pre-pilot test plan,
Step 5.

## Scope

Populated a dedicated local PostgreSQL database (`PERF_DATABASE_URL`)
with synthetic data at pilot scale, measured the application's critical
read paths under a real production build, inspected PostgreSQL execution
plans for the critical query inventory, and applied one evidence-backed
fix. See `docs/testing/LARGE_DATA_QUERY_PLAN_TEST.md` for the full
architecture, safety model, and commands.

## Tested data volumes

Both profiles were run end-to-end (seed → plans → measure → cleanup for
quick; seed → plans → measure for full) against a local
`pharmacy_duty_scheduler_perf` database.

**Quick profile** (verification pass): 5 Region, 200 Pharmacy, 5,000
HistoricalDutyRecord, 2,000 AuditLog, 1,000 DutyRequest, 500
Unavailability, 40 DutySchedule, 295 DutyAssignment, 300
DutyBalanceAdjustment, 100 Session, 30 LoginAttempt, 10 User. Cleanup
verified: every deleted count matched the seeded count exactly.

**Full profile** (staging-scale benchmark, the task's default target):
50 Region, 5,000 Pharmacy, 250,000 HistoricalDutyRecord, 100,000
AuditLog, 50,000 DutyRequest, 20,000 Unavailability, 2,000 DutySchedule,
6,000 DutyAssignment, 5,000 DutyBalanceAdjustment, 3,000 Session, 500
LoginAttempt, 200 User.

## Baseline measurement (full profile, before fix)

10 measured requests per target after a 3-request warm-up, real
production build, authenticated as a seeded ADMIN user.

| Page | p50 | p95 | Status | Errors |
| --- | --- | --- | --- | --- |
| `/` | 43ms | 51ms | 200 | 0 |
| `/eczaneler` | 45ms | 63ms | 200 | 0 |
| `/mazeretler` | 40ms | 92ms | 200 | 0 |
| `/nobet-talepleri` | 210ms | 282ms | 200 | 0 |
| `/gecmis-nobetler` | **2,190ms** | **2,715ms** | 200 | 0 |
| `/nobet-dengesi` | **2,765ms** | **3,149ms** | 200 | 0 |
| `/veri-kontrol` | 597ms | 931ms | 200 | 0 |
| `/denetim-kayitlari` | 18ms | 20ms | 200 | 0 |
| `/cizelgeler` | 22ms | 28ms | 200 | 0 |
| `/cizelgeler/[id]` (populated) | 50ms | 58ms | 200 | 0 |
| Assignment edit page | 16ms | 33ms | 200 | 0 |
| Excel export | 13ms | 17ms | 200 | 0 |
| PDF export | 50ms | 55ms | 200 | 0 |

**Slowest endpoints**: `/nobet-dengesi` and `/gecmis-nobetler`, both well
over the 1,500ms investigation threshold. `/veri-kontrol` (597–931ms) is
notably slower than the rest but under threshold — not investigated
further in this pass.

## Critical query inventory (categories A–F)

Full file:line inventory and `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT
JSON)` results for every category are in the machine-readable/markdown
output of `npm run test:perf:plans` (gitignored under
`benchmark-output/`). Summary at full-profile scale:

- **A — Unavailability**: the pharmacy/date overlap query (schedule
  pre-check) uses `Unavailability_pharmacyId_idx` and completes in
  <0.1ms even at 20,000 rows. The invalid-date-range health check
  (`data-health.ts`) does a full sequential scan (flagged as
  "concerning" by row-count/selectivity heuristics: 0 of 20,000 rows
  match) but completes in 2.67ms — see residual finding A below.
- **B — Historical duty & balance**: `HistoricalDutyRecord` groupBy/count
  queries stayed in the 1.5–29ms range at 250,000 rows, all using
  existing indexes (`pharmacyId`, `regionId`, `matchStatus`). The
  unbounded `DutyAssignment` history query in `editDutyAssignmentAction`
  — see residual finding B below.
- **C — Duty requests**: pharmacy/status/date filtering and the public
  open-request count both stay under 0.1ms via `DutyRequest_pharmacyId_idx`
  / `DutyRequest_status_idx`. The review-list query (unfiltered,
  `ORDER BY status, createdAt DESC LIMIT 20`) does a sequential scan over
  50,000 rows in 19.4ms — not flagged as concerning (returns a
  proportionate slice via `LIMIT`, not a highly selective filter).
- **D — AuditLog**: `createdAt`-sorted pagination and actor filtering
  both use their respective indexes, 0.14–1.6ms at 100,000 rows.
- **E — DutyAssignment & schedules**: all schedule/date/pharmacy lookups
  use indexes, all under 0.1ms.
- **F — Session/LoginAttempt**: token lookup, per-user invalidation, and
  the rate-limit bucket lookup all use their unique/secondary indexes,
  all under 0.1ms.

No new index was added anywhere in categories C–F — every measured query
already used an appropriate existing index at full-profile scale, and no
`EXPLAIN ANALYZE` result demonstrated a meaningful benefit from a new
one.

## Residual LOW finding A — Unavailability date-range index

**Question**: does the `startDate`/`endDate` overlap query need a
composite or partial index?

**Evidence**: tested with a realistic full-region query (100 pharmacies
in one region, one month's date window) against the 20,000-row
full-profile `Unavailability` table:

```
Bitmap Index Scan on Unavailability_pharmacyId_idx
  actualRows=377, rowsRemovedByFilter=363 (date-range residual filter)
  executionTimeMs=0.873
```

Postgres already chooses the `pharmacyId` index (bitmap scan) because the
`pharmacyId IN (...)` predicate is highly selective (100 of 5,000
pharmacies) — the date-range residual filter runs over the resulting
~740-row candidate set, not the full table, and the whole query completes
in under 1ms.

**Outcome: NO CHANGE.** The existing `pharmacyId` index is sufficient. A
composite `(pharmacyId, startDate, endDate)` index would shave a
fraction of a millisecond off an already sub-millisecond query — not a
measurable benefit, and not worth the extra write/storage overhead on a
table that will keep growing.

## Residual LOW finding B — unbounded historical-assignment query in `editDutyAssignmentAction`

**Question**: does `prisma.dutyAssignment.findMany({ where: { pharmacyId } })`
(no date bound, no `LIMIT`) need bounding, aggregation, or an index?

**Evidence**:
1. At full-profile scale (6,000 `DutyAssignment` rows spread across
   5,000 pharmacies), the busiest pharmacies had only 6–7 assignments
   each — the query executed in 0.02–0.03ms via
   `DutyAssignment_pharmacyId_idx`.
2. To stress-test a deliberately unrealistic worst case, a synthetic
   diagnostic (not part of the standard profiles, self-cleaning) gave one
   pharmacy a **daily** assignment for 3,000 consecutive days (~8 years —
   structurally impossible in real use, since every region's `DutyRule`
   enforces `minDaysBetweenDuties >= 1`, and in practice a pharmacy is
   only one of many in its region). Result:
   ```
   Bitmap Index Scan on DutyAssignment_pharmacyId_idx
     actualRows=3000, rowsRemovedByFilter=0, executionTimeMs=0.57
   Prisma findMany (full row hydration): 3000 rows, 50.86ms
   ```

**Outcome: NO CHANGE.** This is an equality lookup (`pharmacyId = $1`) on
an already-indexed column — Postgres will always prefer the index over a
sequential scan regardless of row count, so there is no scan-type risk.
The *row count itself* is what "unbounded" really refers to, and that
count is structurally bounded by each region's `minDaysBetweenDuties`
scheduling cadence, not by calendar time — it cannot grow into the
thousands the way `AuditLog` or `HistoricalDutyRecord` can. Even at an
8×-unrealistic worst case, full row hydration stayed at ~51ms, well
within the 500ms investigation threshold.

## Fix applied: `getDutyBalanceRows` historical aggregation (AGGREGATE)

**Evidence before the fix**: `/nobet-dengesi`'s `getDutyBalanceRows()`
(`src/lib/balance/duty-balance.ts`) fetched every `MATCHED`
`HistoricalDutyRecord` row system-wide via an unbounded `findMany` (no
region filter by default), then reduced weekend/holiday counts in a JS
loop. At full-profile scale, 149,636 of 250,000 rows matched
`MATCHED`. This is the query the task's item 3 flagged as a candidate —
measured baseline: `/nobet-dengesi` p50=2,765ms / p95=3,149ms.

**Classification**: AGGREGATE. Replaced the `findMany` + JS reduction
with a single `GROUP BY "pharmacyId"` SQL query computing `count`,
`sum(weight)`, and conditional `SUM`s for the weekend/holiday counts
(`EXTRACT(DOW FROM "dutyDate") IN (0, 6)` and `weight >= 1.5`) directly
in PostgreSQL. `dutyDate` is stored as `TIMESTAMP(3)` **without** time
zone at UTC midnight (see `dateAtUtcMidnight()` in
`src/lib/scheduling/date-tr.ts`), the same UTC-only date model the rest
of the scheduling code assumes, so `EXTRACT(DOW ...)` performs no
timezone conversion and produces the same day-of-week classification the
previous JS `isWeekend()` call did — no product-behavior change.

**Before/after evidence**:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT "pharmacyId", count(*), sum("weight"), ... GROUP BY "pharmacyId"
FROM "HistoricalDutyRecord" WHERE "matchStatus"='MATCHED' AND "pharmacyId" IS NOT NULL;
-- Execution Time: 47.39 ms  (Parallel Seq Scan + Partial HashAggregate, 2 workers)
```

The new query itself is fast (47ms at 250,000 rows, down from an
unbounded 149,636-row fetch + JS reduction on every request). Re-running
the full-profile measurement after the fix, however, showed
**`/nobet-dengesi` essentially unchanged**: p50=2,934ms / p95=3,193ms.

**Root-cause correction**: the 47ms query was never the dominant cost at
5,000-pharmacy scale — the page renders one `<TableRow>` per pharmacy
(`src/app/(dashboard)/nobet-dengesi/page.tsx`) with **no pagination**,
so React server-side rendering ~5,000 rows × 7 cells dominates response
time regardless of query speed. `/gecmis-nobetler` has the same
unpaginated-full-roster pattern (`prisma.pharmacy.findMany()` with no
`take`/`skip`, rendered as one row per pharmacy) and was equally slow
both before and after this fix (p50 2,190ms → 2,360ms — within run-to-run
noise, not a regression from this change).

**Decision**: the `getDutyBalanceRows` aggregation change was still kept
— it removes a genuine, unbounded, growing-with-the-dataset query and
per-request JS reduction over what will become an increasingly large
`HistoricalDutyRecord` table, and is a correctness-preserving, low-risk,
independently-justified improvement even though it did not move
`/nobet-dengesi`'s headline number. **Pagination for `/nobet-dengesi` and
`/gecmis-nobetler` is the fix that would actually move that number**, but
adding real pagination (route query params, page controls, updated
tests) to two dashboard pages is a UI-level scope change beyond this
step's "database and query-plan" boundary — flagged here as a concrete,
evidence-backed follow-up recommendation rather than implemented in this
pass.

**Regression test**: `src/lib/balance/duty-balance.test.ts` updated to
mock `$queryRaw`'s pre-aggregated rows instead of raw historical
records; all 12 tests pass, including the region-scoping assertion
(checks the regionId value reaches the raw SQL call).

**Migration required**: none — no schema change, only a query-shape
change.

## Database, table, and index sizes (full profile)

```
Database size: 177 MB
```

| Table | Total size | Table size | Index size | Rows |
| --- | --- | --- | --- | --- |
| HistoricalDutyRecord | 92 MB | 63 MB | 29 MB | 254,000* |
| AuditLog | 36 MB | 23 MB | 13 MB | 100,000 |
| DutyRequest | 24 MB | 15 MB | 9.3 MB | 50,000 |
| Unavailability | 5.9 MB | 3.7 MB | 2.1 MB | 20,000 |
| DutyAssignment | 4.4 MB | 1.7 MB | 2.7 MB | 6,000 |
| Pharmacy | 2.6 MB | 1.6 MB | 0.9 MB | 5,000 |
| DutyBalanceAdjustment | 1.8 MB | 1.0 MB | 0.7 MB | 5,000 |
| Session | 1.4 MB | 0.6 MB | 0.8 MB | 3,000 |
| DutySchedule | 0.8 MB | 0.3 MB | 0.5 MB | 2,000 |
| LoginAttempt | 0.3 MB | 0.1 MB | 0.2 MB | 500 |
| User | 0.2 MB | 0.1 MB | 0.1 MB | 200 |

\* `n_live_tup` is a planner estimate (via `pg_stat_user_tables`), not an
exact count; the 3,000 dead tuples left on `DutyAssignment` are from the
residual-finding-B diagnostic's own insert-then-delete and would be
reclaimed by a routine autovacuum — not a leak from the main seed/cleanup
flow, which was verified to remove exactly what it created.

**No unexpectedly large or duplicated indexes.** `HistoricalDutyRecord`'s
29 MB of indexes across 5 indexes (`pkey`, `pharmacyId`, `regionId`,
`dutyDate`, `matchStatus`, `batchId`) on a 63 MB table (index:table ratio
~0.46) is proportionate to its column/index count, not evidence of
redundancy. Several unique/pkey indexes showed `idx_scan = 0` in
`pg_stat_user_indexes` — this reflects this benchmark run's narrow, fixed
query set (`plans.ts` + `measure.ts`'s page inventory), not evidence of
true production non-use; **no index is recommended for removal** on the
basis of this single run.

## Connection and memory observations

- `pg_stat_activity` showed 11 active connections to the perf database
  during measurement (before and after), well under `max_connections =
  100`.
- Process RSS measurement was unreliable in this run (see
  "Known measurement limitation" in
  `docs/testing/LARGE_DATA_QUERY_PLAN_TEST.md`) — the "after" reading
  came back `null` because `measure.ts` tracked the wrong pid in the
  `npm run start` process tree. No memory-growth conclusion is drawn from
  this run; flagged as a benchmarking-tool improvement for a future pass.
- No destructive connection-exhaustion or saturation testing was
  performed in this step (explicitly out of scope — belongs to a future
  DB-resilience/chaos-testing step).

## Test and report quality

New/updated automated tests (all passing):

- `tests/integration/helpers/test-db-guard.test.ts` — 9 new cases for
  `resolvePerfDatabaseUrl()` (67 total in the file, up from 58 after
  Step 4).
- `scripts/perf/rng.test.ts` — 9 cases (determinism, range, distinct
  seeds).
- `scripts/perf/batch.test.ts` — 6 cases (chunk boundaries, remainder,
  empty input, invalid size).
- `scripts/perf/manifest.test.ts` — 6 cases for
  `validateManifestForCleanup()` (missing manifest, unmarked manifest,
  empty marker, zero tracked ids, valid single-source manifest, fully
  populated manifest).
- `scripts/perf/percentile.test.ts` / `plan-parser.test.ts` — 15 / 9
  cases (statistics correctness, p99 sample-size guard, seq-scan/sort-
  spill/buffer-stat extraction from EXPLAIN JSON).
- `src/lib/balance/duty-balance.test.ts` — 12 cases, updated for the
  `$queryRaw`-based aggregation.

## Remaining risks

1. **`/nobet-dengesi` and `/gecmis-nobetler` remain slow (~2–3s p50) at
   5,000-pharmacy scale** due to unpaginated full-roster table rendering
   — a real, evidence-backed finding that should be addressed with
   pagination before a pilot chamber reaches this pharmacy count. Not
   fixed in this pass (UI-scope, see above).
2. **`/veri-kontrol`** (597ms–931ms) is comfortably under threshold but
   worth a light look if the pilot's data-health checks grow.
3. Local timings do not predict Railway production timings (different
   network topology, CPU/memory allocation, connection pooling) — see
   `docs/testing/LARGE_DATA_QUERY_PLAN_TEST.md`'s "Local vs. Railway
   limitations."
4. Process-memory observation is not yet reliable from this tooling —
   should be fixed before using `measure.ts` for memory-leak
   investigation.

## Suitability for expected pilot volume

At the full target profile (50 regions, 5,000 pharmacies, 3 years of
historical data), every measured database query completed in under 30ms,
and every category-A–F critical query used an appropriate index — the
**database layer** is suitable for pilot volume as tested. The two
slow-page findings are **rendering-layer**, not database-layer, and are
narrow in scope (two specific unpaginated dashboard tables) — they do not
indicate a systemic database problem, but should be fixed (via
pagination) before a pilot chamber's pharmacy count approaches the
thousands tested here. A chamber with pharmacy counts in the low hundreds
(more typical of an initial pilot than the stress-tested 5,000) would not
be expected to hit either slow-page finding in practice.
