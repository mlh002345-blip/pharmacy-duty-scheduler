# Logging, Observability & Auditability

Date: 2026-07-09 (audit + fixes), same branch (`deploy/postgresql-demo`).

## Scope

A prior read-only sweep evaluated whether production failures could be
diagnosed from the outside and found that, outside the `AuditLog` table
(which only covers successful, committed business mutations), the app
had **zero** operational signal: no `console.*` calls anywhere in `src/`,
no logger library, no correlation IDs, and several genuinely
unreconstructable incident classes. This document covers that sweep's
findings and the fixes applied — a minimal, dependency-free structured
logger, request correlation IDs, and instrumentation of the highest-
value diagnostic blind spots. No external logging/APM service was
added, no database schema changed, and no user-facing message changed.

## Previous blind spots (from the sweep)

| # | Blind spot | Status |
|---|---|---|
| 1 | Login failures (wrong password, unknown email, inactive account) were completely invisible | **Fixed** |
| 2 | Any non-P2002 error inside a `$transaction` re-threw to a zero-trace default Next.js error page | Fixed at the highest-value paths (schedule generation, historical import, public duty request, exports, data health) |
| 3 | Schedule-generation failures left zero trace | **Fixed** |
| 4 | No correlation ID existed anywhere in the request path | **Fixed** |
| 5 | Historical-import failures (non-duplicate) left zero trace | **Fixed** |
| 6 | Permission-denial attempts weren't recorded | **Fixed** |
| 7 | PDF/Excel export routes had no error handling at all | **Fixed** |
| 8 | The dashboard's data-health cache failure path was uncaught and unlogged | **Fixed** |

## Logging architecture

**`src/lib/observability/logger.ts`** — a small, dependency-free
structured logger. `logger.error(event, context?, error?)` /
`logger.warn(...)` / `logger.info(event, context?)` each emit exactly
one line of JSON via `console.error`/`console.warn`/`console.info`
respectively, which Railway's platform-level stdout/stderr capture picks
up automatically (no new infrastructure). Every record includes
`timestamp` (ISO 8601), `level`, and `event`; optional context fields
(`requestId`, `userId`, `regionId`, `pharmacyId`, `scheduleId`,
`entityId`, `reason`, `prismaCode`, etc.) are spread in verbatim except
where redacted (see below). A logging call **can never throw** — the
entire emit path is wrapped in a `try { } catch { }` so a serialization
failure or a broken `console` implementation never breaks the business
operation that triggered the log call.

**`src/lib/observability/request-id.ts`** — `getRequestId()`, an async
helper that reads the `x-request-id` header (set by middleware, below)
via `next/headers`. Returns `undefined` (never throws) outside a request
context, so every call site can unconditionally spread it into a log
context.

**`src/middleware.ts`** — request correlation only, nothing else. For
every request (excluding static assets, via the `matcher`), it accepts
an existing `x-request-id` header only if it matches a conservative safe
format (`src/lib/observability/request-id-format.ts`:
`/^[A-Za-z0-9_-]{8,128}$/`); otherwise it generates a fresh
`crypto.randomUUID()` (Web Crypto API, since middleware runs on the Edge
runtime). The ID is forwarded to the downstream request headers (so
`getRequestId()` can read it later in the same request) and set on the
response headers (so a client/proxy can correlate its own logs too).
**No auth/authorization logic was added here** — that remains entirely
in `src/lib/auth/guard.ts`/layouts, unchanged. **No per-request access
log was added** — middleware does not call the logger at all, to avoid
noisy logging on every successful page view; only the specific
failure/denial paths below log, and only when they actually fire.

## Log levels and event names

| Level | Meaning | Example events |
|---|---|---|
| `error` | An unexpected failure — something that should not normally happen and needs investigation | `schedule_generation_failed` (unexpected_error), `historical_import_failed` (unexpected_transaction_error), `public_duty_request_failed` (unexpected_create_error), `schedule_pdf_export_failed`, `schedule_excel_export_failed`, `data_health_report_failed` |
| `warn` | An expected-but-noteworthy business-rule rejection or a denied action | `auth_login_failed`, `authorization_denied`, `schedule_generation_failed` (precheck_failed / duplicate_schedule), `historical_import_failed` (raw_rows_json_parse_failed / duplicate_fingerprint) |
| `info` | A routine, expected event kept at low noise for context, not because it's a problem | `auth_login_succeeded`, `public_duty_request_failed` (duplicate_dedup_key — deliberately kept `info`, not `warn`, since a duplicate public submission is a normal, expected occurrence, not a business-rule violation worth escalating) |

Handled, expected outcomes (a caught `P2002` unique-constraint conflict,
a caught business-rule error) are **never** logged at `error` —
consistent with the task's instruction not to double-log or over-
escalate friendly, already-handled rejections. Only truly unexpected
failures (a re-thrown, non-P2002 error) are `error`-level.

## Redaction rules

`logger`'s `redactContext()` replaces the *value* of any context key
matching `/password|token|cookie|authorization|secret|database.?url/i`
(case-insensitive, substring match) with the literal string
`"[REDACTED]"` before serialization — this is a blanket guard,
independent of what any individual call site passes. Additionally, by
convention (not code-enforced, since it can't be generically detected),
every call site in this pass was written to never pass: the submitted
password, the user's email address, the public duty-request token, the
request explanation text, uploaded Excel filenames, or a full Prisma
error object. `toSafeError()` only ever extracts `name`, a known `code`
(e.g. Prisma's `"P2002"`), and a message truncated to 200 characters —
**never a stack trace**, and Prisma's `meta` field (which can embed the
offending row's actual values) is never read at all.

## AuditLog vs. operational-log separation

This is a deliberate, preserved separation, not an oversight:

- **`AuditLog`** (`src/lib/audit.ts`) records **successful, committed
  business mutations** — who changed what row, with a before/after
  snapshot, always written inside the same DB transaction as the change
  it documents. If the transaction rolls back, the audit row rolls back
  with it.
- **The structured logger** (this pass) records **operational events**:
  failures, denials, authentication attempts, and diagnostic context —
  many of which, by definition, have no committed row to attach an
  `AuditLog` entry to (a failed login never creates a `User`-related
  row; a failed schedule generation never creates a `DutySchedule` row).

Per the task's explicit instruction, **no non-transactional `AuditLog`
write was added for any failed operation**, and failed-login/system-
error events are **not** stored in `AuditLog` — they exist only in the
structured operational log stream described above.

## Request ID behavior

- Generated or validated once per request, in `src/middleware.ts`.
- Present on both the outgoing response (`x-request-id` response
  header) and the incoming request as seen by every Server
  Component/Action/Route Handler downstream (via
  `NextResponse.next({ request: { headers } })`).
- Read back via `getRequestId()` wherever a log call needs it — every
  new log call in this pass includes it when available.
- **Correlates only within this single Next.js service** — there is no
  distributed trace propagation to Postgres, to Railway's own
  infrastructure logs, or to any external system, since none of those
  exist in this stack.

## Fixed paths (instrumentation added)

| File | Event(s) | Trigger |
|---|---|---|
| `src/lib/auth/actions.ts` | `auth_login_failed` (warn), `auth_login_succeeded` (info) | Every login attempt — failure reason category (`unknown_account` / `invalid_password` / `inactive_account`) logged server-side only; the client-facing message is unchanged (`"Hatalı e-posta veya şifre."`); success logs `userId`, never the email |
| `src/lib/auth/guard.ts` | `authorization_denied` (warn) | An authenticated user's `hasPermission()` check fails, in both `requirePermissionOrState` and `requirePermissionOrRedirectWithMessage` (and therefore `requirePermissionOrRedirect`); logs `userId`, `requiredPermission`, and `redirectPath` where applicable. Deliberately **not** logged for the plain "no session, redirect to /giris" case — that would fire on every anonymous page view |
| `src/app/(dashboard)/cizelgeler/actions.ts` (`createDutyScheduleAction`) | `schedule_generation_failed` (warn for precheck/duplicate, error for unexpected) | A `DutyScheduleGenerationError` (missing region/duty-rule/active-pharmacies), a `P2002` race on the year+month+region unique constraint, or any other rethrown error — all include `userId`, `regionId`, `year`, `month` |
| `src/app/(dashboard)/gecmis-nobetler/actions.ts` (`historicalImportAction`) | `historical_import_failed` (warn for the JSON-parse/duplicate-fingerprint cases, error for unexpected) | A malformed `rawRows` payload (previously a bare, unsignalled `catch {}`), a duplicate-fingerprint `P2002` rejection, or an unexpected transaction failure — includes `userId` and `acceptedRowCount`; **never** the filename or row contents |
| `src/app/eczane-talep/[token]/actions.ts` (`createPublicDutyRequestAction`) | `public_duty_request_failed` (info for the expected duplicate case, error for unexpected) | A duplicate `dedupKey` `P2002` (kept at `info`, since it's a normal occurrence for a public form) or an unexpected create failure — includes `pharmacyId` (already derived from the token server-side); **never** the token itself or the explanation text |
| `src/app/(dashboard)/cizelgeler/[id]/export/pdf/route.ts`, `.../export/excel/route.ts` | `schedule_pdf_export_failed`, `schedule_excel_export_failed` (error) | Either export route previously had **no try/catch at all** around PDF/Excel generation; both now catch, log (`userId`, `scheduleId`, safe error), and return a controlled `500` JSON response instead of leaking an unhandled exception |
| `src/lib/health/data-health.ts` (`getDataHealthReport`) | `data_health_report_failed` (error) | Only fires on an actual cache-miss refresh failure (never on a cache hit, so it cannot fire on every dashboard/`/veri-kontrol` page load) — logs, then re-throws so existing behavior (the page's own error handling) is unchanged |

## Remaining limitations

- Railway's log retention, search, and alerting are dashboard-controlled
  and **not inspectable from this repository** — this pass only ensures
  something is written to stdout/stderr; retention/searchability policy
  is Railway's, outside this codebase's control.
- **No external APM or distributed tracing** was added (deliberately,
  per the task's constraints) — there is no cross-service trace, no
  flame graph, no automatic error aggregation/deduplication beyond what
  `grep`-ing structured JSON log lines can do.
- **Request IDs correlate only within this single service** — there is
  no upstream/downstream service to propagate a trace to in this
  architecture, so the ID's value is limited to tying together this
  app's own log lines and its own response header.
- **No automated brute-force alerting or rate limiting** exists yet —
  `auth_login_failed` events are now logged, but nothing currently
  monitors their volume or blocks repeated attempts; a human or an
  external log-analysis tool watching Railway's log stream would have to
  notice a pattern manually.
- **Historical logs before this change cannot be reconstructed** — this
  pass only affects behavior going forward; incidents that occurred
  before this deploy remain exactly as unreconstructable as the original
  sweep found them, since there was no logging at all to retroactively
  produce.
- **Successful read operations are not audit-logged, by design** — only
  successful *mutations* get an `AuditLog` row (unchanged, pre-existing
  behavior); viewing a page, running a report, or a successful data-
  health refresh produces no log line at all (a successful data-health
  refresh is silent by design — see the "Fixed paths" table above,
  logging only fires on failure).
- Several other server actions with the same "`catch` P2002 → friendly
  message; otherwise rethrow" shape (region/pharmacy/holiday/user/
  unavailability CRUD in `bolgeler`, `eczaneler`, `tatil-gunleri`,
  `kullanicilar`, `mazeretler`, and manual duty-assignment reassignment
  in `assignment-actions.ts`) were **not** instrumented in this pass —
  this was scoped to the highest-value blind spots identified by the
  sweep (auth, authorization, schedule generation, historical import,
  public duty requests, exports, and the dashboard's data-health report).
  These remaining action files still re-throw unexpected errors to the
  default Next.js error boundary with no log line, same as before this
  change — a reasonable next candidate if a future pass wants to extend
  coverage further.

## Verification performed

- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm test` — 251/251 passing (34 new tests across
  `src/lib/observability/logger.test.ts`, `src/middleware.test.ts`,
  `src/lib/auth/actions.test.ts`, `src/lib/auth/guard.test.ts`,
  `src/app/(dashboard)/cizelgeler/[id]/export/excel/route.test.ts`,
  `src/app/(dashboard)/gecmis-nobetler/actions.test.ts`, and
  `src/app/eczane-talep/[token]/actions.test.ts`) — covering: valid
  structured JSON output; correct `console` method per level; key-based
  redaction; the logger never throwing on a serialization failure or a
  broken `console`; middleware generating a fresh ID when none is
  supplied; a valid incoming ID being preserved; an oversized or
  invalid-character incoming ID being replaced; login-failure logs never
  containing the email or password; authorization-denial logs including
  safe context and never firing for a plain unauthenticated redirect;
  export failures returning a controlled `500` with no internal detail
  in the response body while still logging that detail server-side;
  the historical-import JSON-parse failure emitting a signal instead of
  a bare `catch {}`; and the expected-duplicate cases (fingerprint,
  dedupKey) logging at `warn`/`info` rather than `error`
- `npm run build` — production build succeeds against a real local
  PostgreSQL instance, all routes registered, including the new
  `middleware.ts`
- No `prisma/` changes were made — confirmed via `git status`; no
  migration was generated or required
- No new runtime dependency was added — `package.json`'s
  `dependencies`/`devDependencies` are unchanged; the logger and
  middleware use only Node/Web-standard built-ins (`console`,
  `crypto.randomUUID`, `next/headers`, `next/server`)
- Manually confirmed no secret/token value appears in any test's
  captured log output (asserted directly in the new tests above, not
  just by inspection)
