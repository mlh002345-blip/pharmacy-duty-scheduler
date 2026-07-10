# API Contract Consistency

Date: 2026-07-10 (audit + fixes), same branch (`deploy/postgresql-demo`).

## Scope

Audited the app's "API surface" as a consumer would experience it — this
is not a public REST API; it is server-rendered pages, Next.js Server
Actions, and a small number of Route Handlers. The audit covered:

- **Server Actions** across every domain file (`bolgeler`, `eczaneler`,
  `kullanicilar`, `cizelgeler`, `gecmis-nobetler`, `nobet-talepleri`,
  `mazeretler`, `tatil-gunleri`, `kurallar`, `cizelgeler/[id]/atama`,
  the public `eczane-talep/[token]`, and `lib/auth`).
- **The three Route Handlers**: `cizelgeler/[id]/export/pdf/route.ts`,
  `.../export/excel/route.ts`, and `gecmis-nobetler/sablon/route.ts`.
- **Pagination/filtering/sorting conventions** across every list page.
- **`*ActionState` variants**: `ActionState`, `ImportActionState`,
  `EditAssignmentActionState`.
- **Naming/casing** of Server Actions and Prisma schema fields.
- **Versioning/breaking-change risk** for this internal surface.

This document covers the audit and the four fixes from it. No public
REST API was added, no database schema changed, and the deliberately
different behaviors identified by the audit (documented in the "Fixed
inconsistency pairs" and "Intentional differences" sections below) were
preserved exactly as found, per the task's explicit scope.

## Fixed inconsistency pairs

### 1. Route Handler error contract

**Pair:** the schedule PDF/Excel export routes return a controlled JSON
`500` (`{ message: "..." }`) and log via the structured logger on any
unexpected failure (added in the prior "Logging, Observability &
Auditability" pass) — but `gecmis-nobetler/sablon/route.ts` (the
historical-import Excel template download, sitting right next to those
two in the same feature area) had **no try/catch at all** around its
`prisma.pharmacy.findMany` query or its ExcelJS buffer generation. A
failure there previously propagated as an unhandled framework error
page with no `{ message }` JSON shape and no log line — a different
contract for the same class of failure (a Route Handler generating a
downloadable file).

**Fix:** wrapped the query and buffer generation in
`sablon/route.ts` in the same `try/catch` shape as the other two routes.
On failure it now:
- Logs `historical_template_export_failed` (error level) with only
  `requestId` and `userId` — never file contents, tokens, cookies, or
  raw Prisma error metadata.
- Returns `NextResponse.json({ message: "Excel şablonu oluşturulurken
  bir hata oluştu." }, { status: 500 })` — the same `{ message: string }`
  shape as the other two routes' 500 responses.

The existing `403` (unauthorized) response, the successful download's
`Content-Type`
(`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`)
and `Content-Disposition`
(`attachment; filename="gecmis-nobet-sablonu.xlsx"`) headers, and the
unauthenticated `redirect("/giris")` behavior are all unchanged.

**All three Route Handlers now share an identical error contract:**
`403` → `{ message: "Bu işlem için yetkiniz bulunmuyor." }`; `404`
(export routes only, since the template route has no resource lookup by
id) → `{ message: "Nöbet çizelgesi bulunamadı." }`; `500` → a
route-specific `{ message: "..." }` plus a structured log line.

### 2. Shared `redirectWithMessage` helper usage

**Pair:** every other successful create/update-then-redirect Server
Action in the codebase (region, pharmacy, holiday, user, unavailability,
duty request review, schedule publish/unpublish/delete, balance
adjustment create/delete) calls the shared
`redirectWithMessage(path, "success", message)` helper
(`src/lib/flash-redirect.ts`) — but `createDutyScheduleAction`
(`cizelgeler/actions.ts`) and `editDutyAssignmentAction`
(`cizelgeler/[id]/atama/assignment-actions.ts`) hand-built the identical
URL shape themselves: `redirect(\`${path}?success=${encodeURIComponent(message)}\`)`.
Same outcome, duplicated implementation of the same concern.

**Fix:** both now call `redirectWithMessage(path, "success", message)`
directly, producing byte-identical query strings to before (verified by
a new test asserting the exact `REDIRECT:<path>?success=<encoded
message>` string). The unused `redirect` import was removed from both
files now that `redirectWithMessage` (which itself calls `redirect`
internally) is the only redirect mechanism used. No destination path,
message text, or redirect behavior changed.

### 3. Shared unauthorized-message convention

**Pair:** every other action using `requirePermissionOrState()` returns
`guard.state.message` (which is always the shared
`UNAUTHORIZED_MESSAGE = "Bu işlem için yetkiniz bulunmuyor."` constant
from `src/lib/auth/guard.ts`) on a permission denial — but
`deleteBalanceAdjustmentAction` (`gecmis-nobetler/actions.ts`) discarded
`guard.state` entirely and redirected with its own hardcoded string,
`"Denge düzeltmesi silme yetkisi yalnızca yöneticidedir."` — the one
unauthorized-wording outlier found in the whole codebase.

**Fix:** it now redirects with `guard.state.message` instead of the
hardcoded string, matching every other action's wording exactly. The
`ADMIN`-only permission check itself (`requirePermissionOrState("manageUsers")`)
and the redirect destination (`/gecmis-nobetler`) are unchanged — this
was a message-wording fix only, not a permission-loosening change.

### 4. Shared `zodErrorState()` usage

**Pair:** 13 other zod-validated action call sites across the codebase
use the shared `zodErrorState(parsed.error, message)` helper
(`src/lib/action-state.ts`), which surfaces per-field validation errors
via the `errors` key — but `reviewDutyRequestAction`'s `decision`-field
validation (`nobet-talepleri/actions.ts`) hand-built a generic
`{ success: false, message: "Geçersiz inceleme işlemi." }` state with no
`errors` key, discarding the parsed Zod error entirely.

**Fix:** replaced with `zodErrorState(parsed.error, "Geçersiz inceleme
işlemi.")` — the top-level message text is unchanged, but the response
now also includes the standard `errors` field-error structure. The
valid approve/reject/cancel decision paths and the stale-review
conditional `updateMany` protection (`status: { in: ["PENDING", "LATE"] }`)
are both unchanged.

## Intentional differences (preserved, not fixed)

### A. Public `ActionState` return vs. dashboard redirect

`createPublicDutyRequestAction` (the public `/eczane-talep/[token]`
form) returns an `ActionState` object and stays on the same page,
whereas dashboard `createXAction`s generally redirect to a list/detail
page on success. **This is intentional**, not a bug: the public form is
a single, standalone page with no dashboard list to navigate back to —
`useActionState` re-rendering the same page with a confirmation message
is the correct UX for that context, unlike an admin action where
redirecting to the updated list is what the operator expects next.

### B. Public duplicate submission returns `success: true`

Every other domain's P2002-duplicate handling returns `success: false`
(region, holiday, user, schedule, assignment, historical import) — but
`createPublicDutyRequestAction`'s duplicate-`dedupKey` case returns
**`success: true`** with the message "Bu talep daha önce alınmış.
Lütfen mevcut talebinizin incelenmesini bekleyin." **This is a
deliberate idempotent-success contract, preserved exactly as-is**: the
pharmacist's desired request already exists (no duplicate row is
created — the DB-level unique constraint on `dedupKey` is what actually
blocks the second `create`), and from the submitter's point of view
their request *was* received — showing them the same confirmation
screen as a fresh success, rather than an error state, is correct. A
test (`a duplicate submission returns success:true and creates no
duplicate row (idempotent, by design)`) locks this in explicitly.

### C. Domain-specific duplicate wording

The P2002-duplicate message verb varies by domain — "mevcut" (region,
schedule), "kayıtlı" (holiday), "kullanılıyor" (user email), "atanmış"
(duty assignment), "alınmış" (historical import, public duty request).
**This was not normalized.** Each verb is the natural, idiomatic Turkish
word for what actually happened in that domain ("already exists" reads
differently for a *name* than for an *assignment* or a *submission*) —
forcing a single generic template across all of them would read as
awkward machine-translated Turkish for no consumer-facing benefit, since
nothing in this codebase does generic string-matching against these
messages (each is shown directly to a human, or matched only via the
`errors` field-key structure, never the message text itself).

### D. Bounded lists without pagination

Six list pages (regions' pharmacy list, pharmacies, users, schedules,
duty requests, unavailabilities) share an identical pagination
convention: `DEFAULT_PAGE_SIZE = 20`, a `page` query param, and the
shared `Pagination` component (`src/components/layout/pagination.tsx`).
Four smaller, inherently-bounded lists (regions, duty rules per region,
holidays, historical import batches) have no pagination at all — this
is domain-appropriate (a chamber has a handful of regions and rules, not
hundreds), not an inconsistency to fix; a future consumer of these lists
still cannot assume every list endpoint is capped at 20 rows, which is
worth keeping in mind but not a defect.

### E. No API versioning

There is no versioning concept anywhere in this codebase (no `/api/v1`
prefixing, no `Accept`-header version negotiation) — expected and
correct for an app built entirely on server-rendered pages and Next.js
Server Actions rather than a public, externally-consumed REST API.
Server Actions are inherently versionless and un-deprecatable: a stale
client bundle calling a renamed/removed action's ID has no fallback.
The prior "Idempotency & Retry Safety" pass's rename of
`toggle*StatusAction` → `set*StatusAction` (adding a new required
`isActive: boolean` parameter) is exactly the kind of change that would
need the same care as a public API breaking change if this surface ever
grows external consumers — re-confirmed via grep that no stale
`toggle*StatusAction` reference remains anywhere in `src/`.

## Nullable vs. absent-field convention (confirmed consistent, no change)

- Every optional field in `prisma/schema.prisma` consistently uses
  `Type?` (nullable) — no sentinel-value convention (empty string,
  magic number) is used anywhere instead of `null`.
- All three `*ActionState` variants (`ActionState`, `ImportActionState`,
  `EditAssignmentActionState`) consistently use "absent key" rather than
  "`null` value" for the no-error/no-extra-data case — `errors?:
  Record<string, string[]>` is omitted entirely when there are no
  errors, never set to `null`.

## Verification performed

- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm test` — 259/259 passing (8 new tests: the template route's
  controlled-500 contract and unchanged success headers/403 behavior;
  `createDutyScheduleAction` and `editDutyAssignmentAction` producing
  the exact `redirectWithMessage`-shaped URL; `deleteBalanceAdjustmentAction`
  redirecting with the shared unauthorized message; `reviewDutyRequestAction`'s
  invalid-decision case returning the `zodErrorState` field-error shape;
  the public duplicate-submission idempotent-success contract explicitly
  locked in)
- `npm run build` — production build succeeds against a real local
  PostgreSQL instance, all routes registered
- No schema or migration changes were made or required — confirmed via
  `git status` showing no changes under `prisma/`
- No dependency changes — this pass only touched application code
  (Route Handler, Server Action, and test files) and this document
