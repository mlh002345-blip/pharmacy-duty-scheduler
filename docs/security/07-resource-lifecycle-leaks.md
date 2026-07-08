# Resource Lifecycle & Leaks

Date: 2026-07-08 (audit), fix applied same day, same branch
(`deploy/postgresql-demo`).

## Scope

Audited acquisition/release of every scarce resource in the codebase: DB
connections and the Prisma connection pool, the Postgres advisory lock
introduced in the Concurrency & Race Conditions sweep, file handles,
timers/intervals, event listeners, subprocesses, and temp files. For each,
asked whether release is guaranteed on all paths, including exceptions
and early returns. This document covers the audit and the one small,
actionable fix from it.

## Resources inspected

- `src/lib/prisma.ts` — the app's long-lived Prisma client singleton and
  its dev-mode hot-reload handling.
- `prisma/seed.ts`, `scripts/create-admin.ts` — standalone scripts that
  create their own dedicated `PrismaClient` instances.
- `src/lib/auth/admin-guard.ts` — the `pg_advisory_xact_lock` acquired
  inside a Prisma interactive transaction (added in the prior
  Concurrency sweep).
- Every `prisma.$transaction(...)` call site across `src/app/**/actions.ts`
  — checked for slow/blocking work held inside the transaction boundary.
- `src/lib/pdf/build-schedule-pdf.ts` (pdfkit) and
  `src/lib/historical/parse-excel.ts` /
  `src/lib/scheduling/build-schedule-excel.ts` (exceljs) — in-memory
  document generation.
- `src/components/layout/export-button.tsx` — the one client-side
  resource acquisition in the app: a `Blob` object URL.
- A repo-wide search for `setTimeout`/`setInterval`,
  `addEventListener`/`removeEventListener`, `useEffect`, `fs`/`node:fs`,
  `child_process`/`spawn`/`exec`, raw sockets, and `middleware.ts`.

## Finding table

| # | Finding | Status |
|---|---|---|
| 1 | Blob object URL not revoked on every path | **Fixed** |
| 2 | Advisory lock uses `pg_advisory_xact_lock`, transaction-scoped | Clean |
| 3 | Advisory lock wait maps to a raw error page under heavy contention | Documented only |
| 4 | Prisma client singleton lifecycle | Clean |
| 5 | Standalone scripts' disconnect behavior | Clean |
| 6 | Excel/PDF generation are in-memory only | Clean |
| 7 | No timers/listeners/subprocesses/temp files anywhere in the app | Clean |

---

### 1. Blob object URL not revoked on every path — **Fixed**

**Before:** `src/components/layout/export-button.tsx` called
`URL.createObjectURL(blob)`, then did DOM manipulation
(`document.createElement`, `appendChild`, `click`, `remove`), and only
then called `URL.revokeObjectURL(url)` — all as sequential statements in
the same `try` block. If any DOM step between creation and revoke threw,
control jumped to the outer `catch` (which only shows the existing
Turkish alert), and the object URL was never revoked — it would leak for
the remaining lifetime of the tab.

**Fix:** extracted the acquire/use/release sequence into a standalone
`downloadBlobAsFile(blob, filename)` function in the same file, with the
DOM manipulation wrapped in `try { ... } finally { URL.revokeObjectURL(url); }`.
`URL.createObjectURL(blob)` itself sits outside that inner `try` — so if
it throws, no revoke is attempted (there's no URL to revoke), matching
the required behavior exactly. `ExportButton`'s `handleClick` now just
calls `downloadBlobAsFile(blob, filename)`; the existing Turkish
alert/error behavior in `handleClick`'s own `catch`/`finally` (resetting
`isDownloading`) is unchanged — `downloadBlobAsFile` still throws on
failure, it just guarantees the revoke happens first.

No `AbortController` or other `fetch`-related change was made, per the
task's scope.

**Tests** (`src/components/layout/export-button.test.ts`, new — no jsdom
dependency added; `document`/`URL` are stubbed via `vi.stubGlobal` since
`downloadBlobAsFile` only calls a handful of their methods):
- successful download: `createObjectURL` called once with the blob,
  link `href`/`download` set correctly, `appendChild`/`click`/`remove`
  each called once, `revokeObjectURL` called once with the created URL
- `link.click()` throwing after `createObjectURL` succeeded: the
  function still throws (error not swallowed), but `revokeObjectURL` is
  still called exactly once
- `URL.createObjectURL` itself throwing: the function throws, and
  `revokeObjectURL` is never called

---

## Documented-only items (no code change)

### 2. Advisory lock is transaction-scoped — **Clean**

`assertLastActiveAdminNotRemoved` (`src/lib/auth/admin-guard.ts`)
acquires `pg_advisory_xact_lock` via `tx.$executeRaw` inside a Prisma
interactive transaction. This is provably leak-free: `_xact_`-scoped
advisory locks release automatically on both `COMMIT` and `ROLLBACK`,
Prisma reserves a single physical connection for the whole interactive
transaction (required for the lock to mean anything), and Prisma
converts a thrown error inside the callback (e.g. `LastActiveAdminError`)
into an automatic rollback — so the lock is released even on that path.
No manual unlock call exists or is needed.

### 3. Advisory lock wait is bounded by Prisma's timeout, but not gracefully handled — Documented only

Lock-wait time under contention is implicitly bounded by Prisma's
default interactive-transaction timeout (5s), so a stuck lock can't hang
a request forever. However, `updateUserAction`/`toggleUserStatusAction`'s
`catch` blocks only handle `LastActiveAdminError` and `P2002` — a
timeout surfaces as a different, uncaught Prisma error (raw error page)
rather than the friendly quorum message. Left undone in this pass:
low likelihood at this app's expected concurrency (an internal admin
panel), and the task scope for this pass was limited to the blob-URL
finding — flagged here so it isn't rediscovered as a surprise if
contention is ever observed in practice.

### 4. Prisma client singleton lifecycle — Clean

The app singleton (`src/lib/prisma.ts`) never calls `$disconnect()` —
correct by design for a long-running server process; connections are
pooled and reused across requests. The `globalForPrisma` pattern reuses
the same client across Next.js dev-mode hot reloads (via `globalThis`),
which is the standard fix preventing connection-pool exhaustion from
repeated module reloads during `next dev`. No unbounded/misconfigured
`connection_limit` exists in any `.env*` file — Prisma's default pool
sizing applies. Every `$transaction` callback across all action files
does only sequential Prisma calls (plus the one advisory-lock raw
query); CPU-bound work like `hashPassword` (scrypt) is confirmed to
always run before entering a transaction, never while holding a
reserved connection.

### 5. Standalone scripts' disconnect behavior — Clean

`prisma/seed.ts` and `scripts/create-admin.ts` each create their own
dedicated `PrismaClient` (correct, since they run in a separate
process) and both call `.finally(async () => { await prisma.$disconnect(); })`,
guaranteeing release on the success path and on any thrown error that
propagates through the promise chain. (`seed.ts`'s `.catch()` handler
calls `process.exit(1)` before the chained `.finally()` gets a turn on
that specific path, which technically skips the explicit disconnect —
but the entire process, including its DB socket, is torn down by the OS
at that same instant, so nothing actually leaks.)

### 6. Excel/PDF generation are in-memory only — Clean

`exceljs` only ever uses `.load(buffer)`/`.writeBuffer()` (no
`.readFile`/`.writeFile` to disk anywhere), and `pdfkit`'s `PDFDocument`
in `build-schedule-pdf.ts` is an in-memory `Readable` collecting into a
local `Buffer[]` — neither touches a real file descriptor or socket at
runtime. If an exception is thrown mid-construction, the abandoned
document object and its pending promise are simply garbage-collected
once nothing references them — there's no OS-level handle to leak.

### 7. No timers, listeners, subprocesses, or temp files — Clean

A repo-wide search found zero uses of `setTimeout`/`setInterval`,
manually-added `addEventListener`/`removeEventListener`, `useEffect`,
`fs`/`node:fs`, `child_process`/`spawn`/`exec`, raw `net`/`http` sockets,
or a `middleware.ts`. There is nothing in these categories to audit
further or leak.

## Verification performed

- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm test` — 164/164 passing (3 new, in
  `src/components/layout/export-button.test.ts`)
- `npm run build` — production build succeeds, all routes registered
- No schema or migration changes were required — this is a pure
  client-side code change.
