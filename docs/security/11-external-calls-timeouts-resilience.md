# External Calls, Timeouts & Resilience

Date: 2026-07-09 (audit + fix), same branch (`deploy/postgresql-demo`).

## Scope

Inventoried every call that leaves the Node process — HTTP, database,
cache, queue, third-party SDKs — and checked each for an explicit
timeout, distinct failure handling, bounded/idempotent retries, and
whether a slow dependency could exhaust the caller's threads/connections.
This document covers the audit and the one actionable fix from it.

## External call inventory

| Call site | Type | Timeout | Retry policy | Failure behavior |
|---|---|---|---|---|
| `src/components/layout/export-button.tsx` (`fetchExportBlob`) — same-origin fetch for Excel/PDF export download | HTTP | **30s, AbortController-based (fixed)** | None | Timeout → distinct Turkish alert; non-OK/network error → existing generic Turkish alert; `finally` always resets `isDownloading` |
| Prisma queries/`$transaction` (30+ sites across `src/app/**/actions.ts`, `generate-and-save-duty-schedule.ts`) | DB | None configured — client default (`new PrismaClient()`, no `statement_timeout`/`connect_timeout` in `DATABASE_URL`) | None | Propagates uncaught to Next's default error boundary/500 unless the action does its own validation-error handling |
| `src/lib/health/data-health.ts` — `prisma.$queryRaw` (static, invalid-unavailability lookup) | DB (raw SQL, read) | Client default | None | Propagates; feeds the 60s TTL cache, so a DB failure here also fails the cache-refresh path |
| `src/lib/auth/admin-guard.ts` — `tx.$executeRaw` (`pg_advisory_xact_lock`) inside `$transaction` | DB (raw SQL, lock) | Client default, bounded only by Prisma's implicit interactive-transaction timeout (default ~5s, unmodified) | None | Propagates as a raw DB/Prisma error, aborting the enclosing admin-deactivation transaction |
| `prisma/seed.ts`, `scripts/create-admin.ts` | DB | Client default | None | CLI scripts, not request-time paths |

**Confirmed absent:** no queue/job system, no external cache service
(Redis/memcached — only the in-process 60s TTL cache in `data-health.ts`),
no email/SMS/notification SDK (not even a stub — consistent with
CLAUDE.md's MVP scope), no third-party network SDK (`exceljs`/`pdfkit`
generate files in-process with no outbound calls), no other `fetch`/
`axios`/`http.request` call anywhere in `src/`.

## Timeout policy

- **Export fetch:** 30 seconds (`EXPORT_FETCH_TIMEOUT_MS` in
  `export-button.tsx`), enforced via `AbortController` +
  `setTimeout(() => controller.abort(), timeoutMs)`, cleared in a
  `finally` so it never fires after a request already settled.
- **Prisma/Postgres:** no explicit timeout at the client or connection-
  string level; left as-is in this pass (documented only, see below).

## Retry policy

None, anywhere — unchanged by this fix. The export fetch is a single
attempt: on any failure (timeout or otherwise) the user sees an alert and
must click the button again manually. No retry/backoff was added, per
the task's explicit instruction to keep retry policy as none.

## Failure behavior

- **Export fetch timeout:** `fetchExportBlob` throws `ExportTimeoutError`;
  `handleClick` catches it specifically and shows "İndirme zaman
  aşımına uğradı. Lütfen tekrar deneyin."
- **Export fetch non-OK response or other network error:** existing
  generic "Dışa aktarma sırasında bir hata oluştu." alert, unchanged.
- **`isDownloading` state:** always reset in `finally`, regardless of
  which branch was taken — verified this still holds after the change.
- **Blob URL revoke:** `downloadBlobAsFile` (from the prior Resource
  Lifecycle & Leaks sweep) is unchanged and still always revokes the
  object URL, including if a DOM step throws after creation.

## Fixed items

### 1. ExportButton same-origin fetch had no timeout — **Fixed**

**Before:** `fetch(href)` with no `AbortController`/`signal` and no
timeout option. A hung export request left the button in
"İndiriliyor..." indefinitely, bounded only by the browser/network
stack's own (often very long or absent) default.

**Fix:** extracted the fetch into a standalone `fetchExportBlob(href,
options?)` function (same pattern as `downloadBlobAsFile` — exported so
it's unit-testable without rendering the component). It creates an
`AbortController`, starts a 30s `setTimeout` that calls
`controller.abort()`, passes `{ signal: controller.signal }` to `fetch`,
and clears the timeout in a `finally`. If the underlying fetch rejects
because the signal was aborted, it throws a distinct `ExportTimeoutError`
so `handleClick` can show the timeout-specific Turkish message instead of
the generic failure alert. Non-OK responses and other network errors
still throw a plain `Error`, handled by the existing generic alert.
`options.fetchImpl` and `options.timeoutMs` are test-only injection
points (default to the real `fetch` and `EXPORT_FETCH_TIMEOUT_MS`).

**Tests** (`export-button.test.ts`, new `describe("fetchExportBlob", ...)`
block): fetch is called with an `AbortSignal`; a successful response
returns the parsed filename and blob; a non-OK response throws a plain
error (not `ExportTimeoutError`); an unrelated network error throws a
plain error (not `ExportTimeoutError`); using fake timers, advancing past
the 30s timeout while a never-resolving `fetchImpl` is pending causes the
call to reject with `ExportTimeoutError`. The three pre-existing
`downloadBlobAsFile` revoke-behavior tests from the prior sweep are
untouched and still pass.

## Documented-only items (no code change)

### 2. Prisma/Postgres calls have no explicit query timeout

`src/lib/prisma.ts` instantiates `new PrismaClient()` with no options —
no `statement_timeout`, `connect_timeout`, or `pool_timeout` set on the
client or in any `DATABASE_URL`. A slow or hung query (e.g. from
database-side contention or a network partition to Postgres) would block
the calling request indefinitely rather than failing fast. Left unfixed:
setting a global statement timeout is a connection-string/infra-level
change with app-wide behavioral implications (every query, not just one
button), judged out of scope for this pass, which targets the one small
actionable finding (the export fetch). Worth a dedicated pass if pursued.

### 3. Advisory lock timeout would surface as a raw DB/Prisma error under heavy contention

`admin-guard.ts`'s `pg_advisory_xact_lock` call inside `$transaction`
has no explicit timeout beyond Prisma's own default interactive-
transaction limit (~5s). Under heavy contention (many concurrent admin-
deactivation attempts), a caller could see a raw Prisma/Postgres timeout
error surfacing to the UI rather than a friendly Turkish message. Left
unfixed: same reasoning as above — a targeted change here (catching and
translating that specific error) is a separate, scoped fix better done
on its own, not bundled into this pass.

### 4. No retry/backoff wrapper anywhere

Confirmed (repo-wide grep) no retry/backoff logic exists for any call —
DB or HTTP. This is a deliberate absence, not an oversight to fix now:
Prisma calls are inside request-response cycles where a bare retry would
risk duplicating non-idempotent writes (e.g. `create` calls) without a
transaction-aware idempotency strategy, and the export fetch retry policy
was explicitly directed to stay at none in this pass.

### 5. Same-origin export fetch has no retry — accepted

Per the task's explicit instruction, `fetchExportBlob` performs exactly
one attempt with no retry/backoff added. This is intentional, not an
oversight — noted here for completeness of the finding table.

## Absent external dependencies (clean/confirmed, no finding)

No queue/job system, no external cache service (Redis/memcached), no
email/SMS/notification SDK, no third-party network SDK (payment,
storage, image processing) anywhere in the codebase — confirmed via
`package.json` dependency review and repo-wide grep for the relevant
libraries/patterns.

## Verification performed

- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm test` — 180/180 passing (5 new tests in `export-button.test.ts`
  covering `fetchExportBlob`'s signal usage, success path, non-timeout
  failure paths, and the fake-timer timeout/abort path)
- `npm run build` — production build succeeds, all routes registered
- No schema or migration changes were required — this is a client-side
  fetch-timeout change only, no Prisma/schema involvement.
