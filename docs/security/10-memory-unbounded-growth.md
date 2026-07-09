# Memory & Unbounded Growth

Date: 2026-07-09 (audit + fix), same branch (`deploy/postgresql-demo`).

## Scope

Looked for two related classes of memory risk across the codebase:

1. **Request-time over-materialization** — a request handler or service
   function loading an entire table into Node memory to compute a result
   that only needs a small subset of rows.
2. **Process-lifetime unbounded growth** — module-level arrays, maps,
   queues, listeners, or timers that accumulate entries for the life of
   the process with no eviction, and database tables that grow forever
   with no retention/cleanup policy.

## Growth drivers inspected

- Every module-level `let`/`const` holding a mutable collection or cache
  (the new data-health TTL cache from the prior sweep included).
- Every `findMany()` call with no `where`/`take` bound, checked against
  whether the caller only needs a filtered subset.
- Tables with an obvious "append every month/import/login forever" shape:
  `Session`, `AuditLog`, `HistoricalDutyRecord`, `DutyAssignment`.
- Excel/PDF export buffer construction (checked for unbounded buffering
  across requests, not just within one).
- Any `setInterval`/`setTimeout`/event-listener registration that isn't
  scoped to and cleaned up within a single request or component lifetime.

## Finding table

| # | Finding | Status |
|---|---|---|
| 1 | Unavailability full-table load in data health report | **Fixed** |
| 2 | data health TTL cache is bounded to one report and 60 seconds | Clean |
| 3 | expired Session rows no cleanup | Documented only |
| 4 | AuditLog no retention policy | Documented only |
| 5 | HistoricalDutyRecord growth but current reads use aggregation/count | Documented only / clean read path |
| 6 | Excel/PDF buffers bounded and request-scoped | Clean |
| 7 | no module-level growing arrays/maps/queues/listeners/timers | Clean |

---

### 1. Unavailability full-table load in data health report — **Fixed**

**Before:** `fetchDataHealthReport()` in `src/lib/health/data-health.ts`
ran `prisma.unavailability.findMany({ select: { startDate, endDate,
pharmacy: { name } } })` with no `where` clause — every `Unavailability`
row in the system was pulled into Node memory just to find the (normally
zero, always small) subset where `endDate < startDate`, then discarded.
This runs on every dashboard/`/veri-kontrol` load (subject to the 60s TTL
cache from the prior sweep), so the full table was re-materialized in
memory once per cache period, growing without bound as the table grows.

**Fix:** Prisma's query-builder API cannot express a same-row
column-to-column comparison (`"endDate" < "startDate"`) — there is no
`where` clause shape for comparing two fields of the same row against
each other. Replaced the `findMany()` with a narrowly scoped, fully
static `prisma.$queryRaw`:

```ts
prisma.$queryRaw<UnavailabilityHealthInput[]>`
  SELECT p."name" AS "pharmacyName", u."startDate", u."endDate"
  FROM "Unavailability" u
  JOIN "Pharmacy" p ON p."id" = u."pharmacyId"
  WHERE u."endDate" < u."startDate"
`
```

**Why this is safe:** the query is a fixed tagged-template string with
**zero `${}` interpolations** — no request data, user input, or any
runtime value is ever substituted into it. There is no dynamic SQL
construction (no string concatenation, no building the query text at
runtime), so there is no injection surface at all — the exact same text
runs every time, identical to a static migration or a hardcoded report
query. The filtering now happens in Postgres (index-friendly on
`pharmacyId`/date columns already declared in the schema) and only the
(normally empty) set of actually-invalid rows crosses into Node memory.

The downstream `invalidUnavailabilities` field in `DataHealthCheckInput`
is now populated directly from the query result (column aliases already
match `UnavailabilityHealthInput`), removing the in-memory
`.filter().map()` pass entirely. `runDataHealthCheck`'s signature,
categories, and Turkish messages are unchanged — only how the invalid
rows are sourced changed.

### 2. data health TTL cache is bounded — Clean (self-audit)

The `cachedReport` module variable added in the prior "Algorithmic
Complexity & Hot Paths" sweep holds at most **one** `DataHealthReport`
object at a time (a single `{ value, expiresAt }`, overwritten — never
appended to — on every recompute) and expires after
`DATA_HEALTH_CACHE_TTL_MS` (60s). It cannot grow; re-confirmed after this
turn's change since the shape of the cached value didn't change.

---

## Documented-only items (no code change)

### 3. Expired `Session` rows have no cleanup

`Session` rows are created on login and invalidated (not deleted) on
password change or logout, per `docs/security/02-authentication-session-
handling.md`. There is no scheduled job or query that deletes expired or
invalidated sessions, so the table grows by roughly one row per login
forever. At realistic chamber-admin usage volumes (a handful of staff
accounts, infrequent logins) this is a very slow, low-risk table-size
growth, not a Node-memory issue — reads against `Session` are always
single-row lookups by token, not full-table scans. Left unfixed: adding
a retention/cleanup job is a new piece of infra (a cron/scheduled task)
and out of scope for this pass; worth revisiting if session volume ever
becomes material.

### 4. `AuditLog` has no retention policy

Every manual duty-assignment change, setup-data mutation, etc. writes an
`AuditLog` row (per `CLAUDE.md`'s "every manual duty assignment change
must be auditable" requirement) with no deletion path — by design, for
an audit trail. This table will grow indefinitely. Confirmed the current
read paths (audit log views) are paginated/filtered queries, not
full-table loads, so this is a database storage-growth concern, not a
Node process memory concern. Left unfixed: retention policy for audit
logs is a product/compliance decision (how long must audit history be
kept?), not something to decide unilaterally in a memory-safety sweep.

### 5. `HistoricalDutyRecord` growth but current reads use aggregation/count

`HistoricalDutyRecord` grows with every historical import and accumulates
over chamber lifetime. Checked every read site: the data-health report
uses `count()`/`groupBy()` (aggregated in Postgres, not loaded row-by-
row), and `/nobet-dengesi`'s duty-balance view (documented in the prior
sweep) also uses `groupBy`. No code path was found that does
`historicalDutyRecord.findMany()` without a scoping `where`. Table growth
itself is expected and fine; the read paths already avoid materializing
it in memory. Documented only — no fix needed, this is a clean read
pattern, just noting the table's natural growth for completeness.

---

## Clean areas

### 6. Excel/PDF export buffers are bounded and request-scoped

Both export builders (`exceljs` workbook, PDF generator) allocate their
buffer within a single request/action call, bounded by one schedule's
assignment count (≤ `dailyDutyCount × daysInMonth`, realistically ≤100
rows), and the buffer is not retained anywhere after the response is
sent — confirmed no module-level buffer cache or accumulation across
requests.

### 7. No other module-level growing state

Searched the codebase for module-level `let`/`const` array/Map/Set/queue
declarations and any `setInterval`/`setTimeout`/`addEventListener` not
scoped to a single request or component. Found only the data-health TTL
cache (item 2, confirmed bounded) and the request-level `React.cache()`
wrapper in `public-duty-lookup.ts` (documented in the prior sweep, which
is per-request and garbage-collected with the request — not process-
lifetime state). No other candidates found.

## Verification performed

- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm test` — all tests passing (2 new tests in
  `get-data-health-report.test.ts` covering the `$queryRaw` path)
- `npm run build` — production build succeeds, all routes registered
- No schema or migration changes were required — the fix targets query
  construction only; the `Unavailability`/`Pharmacy` tables and columns
  used by the raw query already exist unchanged in `prisma/schema.prisma`.
- Live verification against real Postgres + a running dev server: `/`
  (dashboard) and `/veri-kontrol` both load correctly and show the same
  data health categories/counts as before this change.
