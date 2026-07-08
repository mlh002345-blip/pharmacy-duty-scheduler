# Data Access Patterns & N+1

Date: 2026-07-08 (audit), fix applied same day, same branch
(`deploy/postgresql-demo`).

## Scope

Audited how the code talks to its data stores: queries inside loops
(N+1), missing batching where the API supports it, unbounded queries on
tables that grow, over-fetching (`include`/`select *` where few fields
are used), filtering/sorting/joining done in application memory instead
of the database, repeated identical reads within one request, and
write-pattern lock contention. Covers every `prisma.*.findMany`/`count`
call site across `src/app/**/page.tsx`, the scheduling/balance/historical
modules, and the public duty-lookup path. This document covers the audit
and the one actionable fix from it.

## Finding table

| # | Finding | Status |
|---|---|---|
| 1 | `/mazeretler` unbounded query + `include: { pharmacy: true }` over-fetch | **Fixed** |
| 2 | `cizelgeler/[id]` page: three sequential independent queries | Documented only |
| 3 | `editDutyAssignmentAction`: sequential independent validation queries | Documented only |
| 4 | `Unavailability.startDate`/`endDate` range-filtered with no supporting index | Documented only — NEEDS-CONTEXT |
| 5 | Public duty lookup uses request-level `cache()` | Clean |
| 6 | No query-inside-loop patterns in scheduling/import/balance modules | Clean |
| 7 | Paginated list pages | Clean — `/mazeretler` was the one exception, now fixed |

---

### 1. `/mazeretler` unbounded query + over-fetch — **Fixed**

**Before:** `src/app/(dashboard)/mazeretler/page.tsx` ran
```ts
prisma.unavailability.findMany({
  include: { pharmacy: true },   // full Pharmacy row, only .name used
  orderBy: { startDate: "asc" },
})
```
with no `skip`/`take` and no total-count query — every `Unavailability`
row ever created (a table with no archival path, growing with normal
day-to-day usage) was fetched and rendered on every page load, and each
row over-fetched every column of its related `Pharmacy` (`mapUrl`,
`requestToken`, `address`, `phone`, timestamps, etc.) even though the
page only renders `pharmacy.name`.

**Fix:** brought the page in line with the pagination pattern already
used by `eczaneler`, `kullanicilar`, `cizelgeler`, and `nobet-talepleri`:
- Added `page` to the page's `searchParams` type and read it via the
  existing `parsePageParam` helper (same convention as every sibling
  list page).
- Added a `prisma.unavailability.count()` query, run alongside the list
  query inside one `Promise.all`.
- Added `skip: (page - 1) * DEFAULT_PAGE_SIZE, take: DEFAULT_PAGE_SIZE`
  to the list query.
- Replaced `include: { pharmacy: true }` with
  `select: { id, startDate, endDate, reason, pharmacy: { select: { name: true } } }`
  — only the fields the table actually renders.
- Rendered the existing `<Pagination>` component below the table, using
  the same no-filter-params shape as `kullanicilar/page.tsx`
  (`searchParams={{}}`, since this page has no filter form).
- Changed the record-count description from `unavailabilities.length`
  to `totalCount` (the earlier value only ever reflected the current
  page's row count, which was already slightly misleading before this
  fix and is now the correct total across all pages).

Ordering (`startDate: "asc"`), the empty-state copy
("Henüz tanımlı bir mazeret kaydı bulunmuyor."), the edit/delete action
buttons, and all other UI/Turkish text were left unchanged.

**Tests** (`src/app/(dashboard)/mazeretler/page.test.ts`, new — walks
the plain React element tree returned by the server component directly,
no jsdom/rendering needed):
- the query uses the exact `select` shape above (not `include`) plus
  `skip: 0, take: DEFAULT_PAGE_SIZE` for page 1
- `skip` is computed correctly for `page=3`
- `<Pagination>` receives the correct `page`/`pageSize`/`totalCount`
  props when the count exceeds one page
- the empty-state message still renders when there are no records
- edit links (`/mazeretler/{id}/duzenle`) and the pharmacy name still
  render for each row

---

## Documented-only items (no code change)

### 2. `cizelgeler/[id]` page: sequential independent queries

`src/app/(dashboard)/cizelgeler/[id]/page.tsx` runs `schedule` →
`holidaysInMonth` → `dutyRequestCounts` as three sequential `await`s.
The second and third depend only on values already known once `schedule`
resolves (`monthStart`/`monthEnd`/`schedule.regionId`), so they don't
depend on each other and could run inside one `Promise.all` — the same
file already does exactly that for its `historicalGroups`/
`adjustmentGroups`/`generatedGroups` batch a few lines later. This is a
latency nit (a fixed, small number of extra round-trips per page view,
not something that grows with data volume) and was left as-is per this
pass's scope, which was limited to the one HIGH finding.

### 3. `editDutyAssignmentAction`: sequential independent validation queries

`src/app/(dashboard)/cizelgeler/[id]/atama/assignment-actions.ts` runs
`unavailability.findMany`, `dutyRequest.findMany`, and (conditionally)
`dutyAssignment.findMany` as three sequential `await`s, each independent
of the others (all keyed only on `candidatePharmacyId`, already known by
that point). Same shape and same reasoning as #2 — not fixed in this
pass.

### 4. `Unavailability` date-range filter has no supporting index — NEEDS-CONTEXT

`src/lib/scheduling/generate-and-save-duty-schedule.ts` and
`src/lib/scheduling/schedule-precheck.ts` both filter
`Unavailability` by `startDate: { lte }, endDate: { gte }` on every
schedule-generation and pre-check call — the hottest write-adjacent path
in the app. `prisma/schema.prisma`'s `Unavailability` model has only
`@@index([pharmacyId])`; there is no index covering `startDate`/
`endDate`, unlike `DutyRequest`, which has explicit `@@index([startDate])`
/`@@index([endDate])` for the identical filter shape. Whether this
matters in practice depends on the real table's row count and Postgres's
actual query plan, which isn't visible from the code — tagged
NEEDS-CONTEXT rather than fixed speculatively. If revisited: either
`EXPLAIN ANALYZE` this query against production-scale `Unavailability`
data, or just get its row count, before deciding whether
`@@index([startDate, endDate])` (or a `pharmacyId`-leading composite) is
worth a migration.

---

## Clean areas

### 5. Public duty lookup uses request-level `cache()`

`src/lib/scheduling/public-duty-lookup.ts` wraps
`getPublishedScheduleForMonth` in React's `cache()`, with an explicit
comment noting that today/tomorrow (and an optional custom date) usually
fall in the same month, so without it `/vatandas` would look up the same
published schedule 2-3 times per request. This is the sweep's "repeated
identical reads within one request" category solved correctly and
documented in-code — the one place in the app that needed it.

### 6. No query-inside-loop patterns in scheduling/import/balance modules

`generate-and-save-duty-schedule.ts`, `duty-balance.ts`,
`data-health.ts`, and `analyze-import.ts` all fetch their inputs via a
single batched `Promise.all` up front, then do all matching/aggregation
with in-memory `Map`s or database-side `groupBy` — including the
historical Excel importer, which processes potentially thousands of rows
entirely against pre-fetched `Map` lookups rather than a per-row query.

### 7. Paginated list pages

`eczaneler`, `kullanicilar`, `cizelgeler`, `nobet-talepleri`, and
`denetim-kayitlari` already used the shared `DEFAULT_PAGE_SIZE`/
`Pagination`/`parsePageParam` pattern with `select`-scoped queries.
`/mazeretler` (finding #1) was the one list page that hadn't been brought
in line with that pattern — it now has been, so every list page backed
by a table that can grow is paginated and select-scoped.

## Verification performed

- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm test` — 169/169 passing (5 new, in
  `src/app/(dashboard)/mazeretler/page.test.ts`)
- `npm run build` — production build succeeds, all routes registered
- No schema or migration changes were required — this is a pure
  query-shape and page-markup change to a single file.
