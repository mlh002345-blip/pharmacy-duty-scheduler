# Duty Rules V2 (Phases 8–13) — Security & Robustness Audit

Date: 2026-07-19 (audit + fixes), branch `feature/duty-rules-v2-security-audit`,
checked out from `deploy/postgresql-demo` at HEAD commit
`632fd450009504bd766c6cd0894b5578f221d7c2` (merge of PR #17, Phase 13 —
Manual Assignment Editing).

## Scope

Every file under, exactly as scoped by the task:

- `src/lib/duty-rules-v2/persistence/` (Phase 8/9 — commit, approve, publish,
  rotation-state math/reads, generation-run integrity validation)
- `src/lib/duty-rules-v2/ui/` (Phase 10/12 — engine-input assemblers, draft
  preview store, runtime facts, lifecycle error messages)
- `src/lib/duty-rules-v2/configuration/` (Phase 11/12 — plan/version/day-type/
  shift/slot/pool/membership CRUD, activation, policy)
- `src/lib/duty-rules-v2/persistence-edit/` (Phase 13 — replacement-membership
  and min-interval-policy resolution for manual edits)
- `src/app/(dashboard)/cizelgeler/v2/**` (all pages + server actions)
- `src/app/(dashboard)/cizelgeler/[id]/v2-lifecycle-actions.ts`
- `src/app/(dashboard)/cizelgeler/[id]/atama/v2-assignment-actions.ts` and
  `.../v2-duzenle/**`
- `scripts/duty-rules-v2-demo/seed-bilecik-and-run-demo.ts`
- The Phase 10 additive V2 filter/action wiring in
  `src/app/(dashboard)/cizelgeler/page.tsx` and
  `src/app/(dashboard)/cizelgeler/[id]/page.tsx`

Phases 2–7 (engine/rules/selection/draft assembly — pure, DB-free
computation, no direct server-action caller outside the assemblers above)
were explicitly out of scope, per the task, and were not re-audited.

## Methodology

Every file in scope was read in full (not skimmed). For every server
action and page, the auth-check call was located and its position relative
to the first DB read/write was confirmed. Every client-supplied id
(`scheduleId`, `previewId`, `versionId`, `poolId`, `membershipId`, `planId`,
`pharmacyId`, `regionId`, `assignmentId`) was traced through to the Prisma
call that eventually uses it, to confirm a tenant filter is present at the
point of use — not merely upstream. At least three full call chains were
traced end-to-end (`activatePlanVersionAction` → `activatePlanVersion` →
every Prisma call inside; `approveV2DraftAction`/`publishV2ScheduleAction`
→ `approveGeneratedDraft`/`publishApprovedSchedule`; `editV2DutyAssignmentAction`
→ `resolveReplacementMembership`/`resolveMinIntervalPolicy`). Idempotency
claims in Phase 8/9/11 doc comments were independently re-derived from the
actual transaction logic, not taken on faith. The repo was grepped for
`cron`/`setInterval`/scheduled-cleanup mechanisms, raw SQL (`$queryRaw`/
`$executeRaw`), and any `.github/workflows` reference to the demo script.

## Findings table

| # | Finding | Status | Severity |
|---|---|---|---|
| 1 | `markDraftPreviewConsumed` updated a `DutyDraftPreview` row by bare id with no tenant filter in the `where` clause | **Fixed** | LOW |
| 2 | `resolveMinIntervalPolicy` looked up a `DutySchedule` by bare id with zero tenant check in the function itself | **Fixed** | LOW |
| 3 | `JSON.parse` on `rulesJson`/`shiftsJson`/`slotsJson` form fields had no size or array-length bound before/after parsing | **Fixed** | LOW-MEDIUM |
| 4 | `DutyDraftPreview` rows have no cleanup mechanism for expired-but-never-consumed previews | Documented only | LOW |
| 5 | "Validate id against a tenant-scoped set, then `update({where:{id}})` without repeating the filter inline" pattern in `update-shift-definitions.ts` / `update-slot-requirements.ts` / `reorderPoolMemberships` / `activate-plan-version.ts`'s retirement loop | Documented only | LOW |
| 6 | Two fully unbounded (no date-range) `findMany` queries in `editV2DutyAssignmentAction`'s min-interval check | Documented only | LOW |
| 7 | Phase 11 declarative-replace audit-log entries record `after` only, never `before`, though the prior state is already in memory | Documented only | LOW |
| 8 | ADMIN-only lifecycle actions gate on `user.role !== "ADMIN"` directly rather than `hasPermission()` | Clean (confirmed safe, deliberate) | — |
| 9 | Idempotency of commit/approve/publish/activate under sequential replay and concurrent races | Clean | — |
| 10 | Tenant scoping across 3 full traced call chains | Clean | — |
| 11 | Cross-tenant existence disclosure in error messages | Clean | — |
| 12 | Bilecik demo script's production-database guard | Clean | — |
| 13 | Raw Prisma error/stack leakage to the client | Clean | — |
| 14 | SQL injection / dynamic `orderBy`/`where` key construction from client input | Clean | — |

---

### 1. `markDraftPreviewConsumed` bare-id update — **Fixed**

**Before:** `src/lib/duty-rules-v2/ui/draft-preview-store.ts` exported
`markDraftPreviewConsumed(previewId: string)`, which ran
`prisma.dutyDraftPreview.update({ where: { id: previewId }, ... })` — a
plain `update` by bare id, with **no `organizationId` anywhere in the
function**. Every other write in the same module (`saveDraftPreview`,
`loadDraftPreview`) is correctly tenant-scoped; this one function was not.

**Exploit scenario:** in production today this is not reachable — its
sole caller, `commitV2DraftAction`, only calls it *after*
`loadDraftPreview({ previewId, organizationId })` has already succeeded
(which itself is tenant-scoped and would 404-equivalent on a foreign-tenant
id before `markDraftPreviewConsumed` is ever reached). So this is a
defense-in-depth gap, not a live IDOR: no code path today lets an attacker
supply an arbitrary `previewId` straight into this function. The risk is
prospective — a future call site that doesn't pre-validate would silently
inherit a real cross-tenant write primitive.

**Fix:** converted to `prisma.dutyDraftPreview.updateMany({ where: { id,
organizationId }, data: { consumedAt } })`, matching the codebase's
conditional-write idiom used throughout Phase 8/9
(`commit-complete-draft.ts` / `approve-generated-draft.ts` /
`publish-approved-schedule.ts`). The function signature now requires
`organizationId` as a parameter, so any future caller is forced to supply
tenant context at the type level, not just by convention. Updated the sole
production call site (`onizleme/[previewId]/actions.ts`) and both
integration-test call sites accordingly.

**Fix files:** `src/lib/duty-rules-v2/ui/draft-preview-store.ts`,
`src/app/(dashboard)/cizelgeler/v2/onizleme/[previewId]/actions.ts`,
`tests/integration/duty-rules-v2-ui-generation.integration.test.ts`.

**Tests:** new `src/lib/duty-rules-v2/ui/draft-preview-store.test.ts` —
asserts `updateMany` is called with `organizationId` in the same `where`
clause, and that a wrong-organization call resolves cleanly with zero rows
affected rather than throwing or silently succeeding cross-tenant. Updated
the existing mock assertion in
`src/app/(dashboard)/cizelgeler/v2/onizleme/[previewId]/actions.test.ts`
to match the new call signature.

**Verification:** `npx vitest run` on both files — 4/4 passing (2 new + 2
updated). `npx tsc --noEmit` clean.

---

### 2. `resolveMinIntervalPolicy` bare-id lookup — **Fixed**

**Before:** `src/lib/duty-rules-v2/persistence-edit/resolve-min-interval-policy.ts`
took only `{ dutyScheduleId }` and ran `prisma.dutySchedule.findUnique({
where: { id: dutyScheduleId }, ... })` — no tenant check at all inside the
function.

**Exploit scenario:** same shape as finding #1 — not reachable today. The
sole caller, `editV2DutyAssignmentAction`, only calls this after already
fetching `assignment` scoped to `dutySchedule: { region: { organizationId:
user.organizationId } }`, so `assignment.dutyScheduleId` is guaranteed
same-tenant by the time it reaches this function. This is prospective
defense-in-depth, not a live gap.

**Fix:** added a required `organizationId` parameter and switched
`findUnique` to `findFirst({ where: { id: dutyScheduleId, region: {
organizationId } } })`. The result only differs from before when the id
belongs to a different tenant (in which case it now correctly returns
`null` instead of leaking the row) — behavior for the same-tenant case is
byte-identical.

**Fix files:**
`src/lib/duty-rules-v2/persistence-edit/resolve-min-interval-policy.ts`,
`src/app/(dashboard)/cizelgeler/[id]/atama/v2-assignment-actions.ts`.

**Tests:** extended
`src/lib/duty-rules-v2/persistence-edit/resolve-min-interval-policy.test.ts`
with a new case asserting the `where` clause includes
`region: { organizationId }`, and updated all 5 existing cases to pass
`organizationId` and mock `findFirst` instead of `findUnique`.

**Verification:** 6/6 tests passing. `npx tsc --noEmit` clean.

---

### 3. Unbounded `JSON.parse` on Phase 11 configuration form fields — **Fixed**

**Before:** `updateDayTypeRulesAction`, `updateShiftDefinitionsAction`, and
`updateSlotRequirementsAction` in
`src/app/(dashboard)/cizelgeler/v2/planlar/[planId]/versions/[versionId]/actions.ts`
each did:
```ts
let parsedJson: unknown;
try {
  parsedJson = JSON.parse(typeof raw === "string" ? raw : "[]");
} catch { return { success: false, message: GENERIC_ERROR_MESSAGE }; }
const parsed = schema.safeParse(parsedJson);
```
The `try/catch` only guarded against a syntactically invalid string — it
did not bound the string's *size* before handing it to `JSON.parse`, and
none of the three zod array schemas (`dayTypeRulesSchema`,
`shiftDefinitionsSchema`, `slotRequirementsSchema`) had a `.max()` on
array length. A caller with `managePlanConfiguration` permission (ADMIN or
STAFF within the organization — this is not an anonymous/public endpoint)
could submit an arbitrarily large `rulesJson`/`shiftsJson`/`slotsJson`
string. `JSON.parse`'s cost scales with input size regardless of whether
the result later fails validation, and a schema-valid-but-huge array (e.g.
tens of thousands of slot-requirement objects) would additionally have
reached `setSlotRequirements`'s per-item transaction loop, multiplying the
cost into real DB load.

**Severity reasoning:** LOW-MEDIUM, not HIGH — the action is gated behind
authentication + `managePlanConfiguration` (not public), so this is a
malicious-or-compromised-authenticated-account risk, not an open DoS
surface. Still worth closing cheaply since the blast radius (a single
Server Action process handling a multi-megabyte string, or a slot-table
insert storm) is disproportionate to the legitimate use case (a plan
version realistically has a few dozen day types/shifts/slots).

**Fix:** added `parseConfigurationJsonField()`, which rejects any raw
string over `MAX_CONFIGURATION_JSON_FIELD_LENGTH` (100,000 characters —
generous headroom over any realistic legitimate payload) *before* calling
`JSON.parse`, and added `.max(100)` / `.max(200)` / `.max(1000)` array
bounds to the three zod schemas respectively (day types are bounded by a
short fixed enum in practice; shifts and slots get more generous caps
reflecting plausible real-world scheduling complexity). All three actions
now route through the shared helper.

**Fix file:**
`src/app/(dashboard)/cizelgeler/v2/planlar/[planId]/versions/[versionId]/actions.ts`.

**Tests:** new
`src/app/(dashboard)/cizelgeler/v2/planlar/[planId]/versions/[versionId]/actions.test.ts`
— asserts an oversized raw string is rejected before the underlying
service function (`setDayTypeRules`/`setShiftDefinitions`/
`setSlotRequirements`) is ever called, that an array exceeding the
`.max()` bound is rejected even when the raw string itself is small, and
that a normal well-formed payload still succeeds.

**Verification:** 6/6 new tests passing. `npx tsc --noEmit` and
`npm run lint` clean.

---

### 4. `DutyDraftPreview` has no cleanup mechanism — Documented only (LOW)

**Evidence:** `saveDraftPreview` sets `expiresAt` (30-minute TTL) and
`markDraftPreviewConsumed` sets `consumedAt`, but a repo-wide grep for
`cron`/`setInterval`/scheduled-deletion/`deleteMany.*expiresAt` found
**zero** cleanup job anywhere — for this table or its sibling
`HistoricalDutyImportBatch`. The Prisma schema's `@@index([expiresAt])` on
`DutyDraftPreview` appears to anticipate a cleanup job that was never
built. Every abandoned "generate but never review/save" flow leaves a row
behind forever.

**Severity reasoning:** LOW, not MEDIUM/HIGH. Each row is small (one JSON
draft payload — bounded by a single month's worth of assignments for one
region, at most a few hundred KB), and the realistic write rate is
low-frequency, deliberate admin action (one generation attempt per
region per scheduling period, not a hot/automated path). Even a chamber
generating drafts daily for every region would accumulate on the order of
thousands of rows per year, not millions — Postgres handles that without
difficulty, and the `@@index([expiresAt])` keeps any future cleanup query
cheap. This matches the exact judgment already made for `Session` rows in
`docs/security/02-authentication-session-handling.md` (finding #8,
documented-only) and is not a new category of risk this phase introduces.

**Recommendation (not blocking):** a periodic cleanup job (e.g. a cron
route or scheduled task deleting `DutyDraftPreview` rows where
`expiresAt < now()`) would be good hygiene before this reaches meaningfully
larger multi-chamber scale, but is not required for a pilot deployment.

---

### 5. "Pre-validate id membership, then bare-id `update()`" pattern — Documented only (LOW)

**Evidence:** four sites share this shape: validate that a client-supplied
id is a member of an already tenant-scoped set (fetched via a `findMany`
filtered by `organizationId`/`versionId`/`poolId`), then write via
`tx.model.update({ where: { id }, data })` — where the individual write's
own `where` clause does **not** repeat the tenant filter:

- `update-shift-definitions.ts` — `tx.shiftDefinition.update({ where: { id: shift.id }, ... })`
- `update-slot-requirements.ts` — `tx.slotRequirement.update({ where: { id: slot.id }, ... })`
- `update-pool-membership.ts::reorderPoolMemberships` — `tx.rotationPoolMembership.update({ where: { id }, data: { sortIndex } })`
- `activate-plan-version.ts`'s sibling-retirement loop — `tx.dutyPlanVersion.update({ where: { id: other.id }, ... })`

**Why this is safe today:** in every case, the set of valid ids was
already fetched scoped to the caller's own tenant (and, for
shift/slot/activation, the specific `versionId`/`regionId`) in the same
function, immediately before the write loop — an id from a different
tenant could never appear in that set to begin with. This differs from
findings #1/#2 above, where there was **no** upstream tenant-scoped set at
all; here, the validation is present, just performed as a membership check
against a pre-fetched set rather than repeated inline in the `WHERE`
clause of the write itself.

**Why not fixed now:** converting these to `updateMany` + count-check
(matching the Phase 8/9 idiom) would touch four files' write loops and
their error-handling paths for a change that improves defense-in-depth
without closing any currently-reachable gap — outside the "small,
surgical fixes only" instruction for a documented-only finding. Flagging
for a future consistency pass (ideally alongside finding #4, as part of a
dedicated hardening phase) rather than bundling a broad refactor into this
audit.

---

### 6. Unbounded `findMany` queries in manual-edit interval check — Documented only (LOW, performance not security)

**Evidence:** `editV2DutyAssignmentAction` (`v2-assignment-actions.ts`)
runs `prisma.unavailability.findMany({ where: { pharmacyId:
candidatePharmacyId } })` (entire unavailability history, no date bound)
and `prisma.dutyAssignment.findMany({ where: { pharmacyId:
candidatePharmacyId } })` (every assignment ever made to that pharmacy, no
date bound) purely to check a single date's interval/availability
conflict.

**Why not a tenant/security issue:** `candidatePharmacyId` is re-validated
to belong to the caller's own organization immediately before these
queries run (`prisma.pharmacy.findFirst({ where: { id: candidatePharmacyId,
region: { organizationId } } })`), so both queries are transitively
tenant-scoped — no cross-tenant data is fetched, only extra same-tenant
rows.

**Severity reasoning:** LOW, performance-only. This is the same shape as
an already-documented-only finding for the V1 sibling action in
`docs/security/08-data-access-patterns-n-plus-one.md` (finding #3), except
the V2 version is *marginally* worse (no date bound at all, where V1's had
one). Not fixed here to keep this audit focused on security; recommend
folding a fix into a future N+1/performance pass alongside the V1
finding, so both get bounded consistently rather than V2 alone.

---

### 7. Phase 11 declarative-replace audit-log entries omit `before` — Documented only (LOW)

**Evidence:** `setDayTypeRules` / `setShiftDefinitions` /
`setSlotRequirements` each write an `AuditLog` entry with only `after`
(the full new desired state + a deleted-count), never `before` — even
though `existingRules`/`existingSlots`/(analogous existing set for shifts)
are already fetched into memory before the transaction and could cheaply
be attached as `before`. This differs from Phase 8/9's convention (every
audit entry there carries both `before` and `after`).

**Severity reasoning:** LOW — not a security hole (every mutation *is*
audited, `writeAuditLog` runs inside the same transaction as the write in
all three, so there is no silent-mutation gap), just an audit-trail
completeness gap: reconstructing "what changed" from the log alone
requires diffing consecutive `after` snapshots by timestamp rather than
reading one entry. Not fixed now because it changes the *shape* of
existing audit data (a product/ops decision about what the audit UI should
display) rather than closing a bug, and touches three files' happy-path
data assembly for a purely additive convenience — better suited to a
deliberate follow-up than bundled into this security pass.

---

### 8. ADMIN-only gating via direct role check — Clean (confirmed safe, deliberate)

Verified all three ADMIN-only V2 lifecycle actions
(`approveV2DraftAction`, `publishV2ScheduleAction` in
`v2-lifecycle-actions.ts`; `activatePlanVersionAction` in
`planlar/[planId]/versions/[versionId]/actions.ts`) call
`requireOrganizationMember()` (any authenticated org member, any role)
followed immediately by an explicit `if (user.role !== "ADMIN")` guard
that redirects with an error flash **before any DB read/write** — not
`hasPermission("publishSchedule")`, which STAFF also holds for the V1
flow. This is documented as deliberate in three places (`permissions.ts`'s
`managePlanConfiguration` comment, and both action files) precisely
because V2 approve/activate/publish must be strictly narrower than STAFF's
V1 publish grant. Traced: there is no code path that reaches
`approveGeneratedDraft`/`publishApprovedSchedule`/`activatePlanVersion`
without first passing this check — calling the exported server action
function directly (bypassing the UI button) still re-derives `user` from
the session via `getCurrentUser()` inside `requireOrganizationMember()`,
so a crafted request from a non-ADMIN session is rejected identically to
one from the UI.

---

### 9. Idempotency of commit / approve / publish / activate — Clean

Independently re-traced (not taken from doc comments) for both the
sequential-replay and concurrent-race cases:

- **`commitCompleteDraft`** — pre-checks `completeDraftFingerprint`
  uniqueness and the `(year, month, regionId)` target outside the
  transaction (fast path), re-checks both **inside** the `Serializable`
  transaction (closing the TOCTOU window), and additionally reclassifies
  `P2002`/`P2034` errors by re-querying the actual winner rather than
  guessing — so two concurrent identical commits always converge on one
  `IDEMPOTENT_REPLAY` result rather than a duplicate row or an unhandled
  error.
- **`approveGeneratedDraft`** / **`publishApprovedSchedule`** — both use
  `updateMany({ where: { id, status: "DRAFT"/"APPROVED" } })` +
  count-check as the *only* write that flips status, inside a
  `Serializable` transaction; a second concurrent call's `updateMany`
  matches zero rows and is reclassified as `IDEMPOTENT_REPLAY` by
  re-querying. `publishApprovedSchedule` additionally re-validates its
  `RotationState` `lockVersion` snapshot **inside** the transaction (not
  just before it), so a rotation-state change between approval and
  publication is caught even under concurrent publication attempts.
- **`activatePlanVersion`** — same `updateMany` + count-check idiom for
  the target version's DRAFT→ACTIVE transition. Its retry loop
  (`MAX_ACTIVATION_ATTEMPTS = 5`) is a **documented, deliberate deviation**
  from the Phase 8/9 re-query-the-winner idiom: activating two *different*
  DRAFT versions for the same region is a genuine race between two
  distinct, non-duplicate writes (not the same logical operation replayed
  twice), so a losing attempt has done no recoverable work and must retry
  the whole read-check-write cycle from scratch. Five bounded attempts
  under `Serializable` isolation is sane for this app's realistic
  concurrency (a handful of admins per organization, not a high-throughput
  public endpoint) — a pathological simultaneous-hammering scenario would
  exhaust the 5 attempts and surface a clear
  `ACTIVATION_TRANSACTION_FAILED` error rather than hang or loop
  unboundedly; each attempt is a single bounded transaction, so worst-case
  latency is 5× one transaction's cost, not open-ended.

---

### 10. Tenant scoping across traced call chains — Clean

Three full call chains traced end-to-end, confirming tenant scoping holds
at every layer (not just the outermost check):

- `activatePlanVersionAction` → `activatePlanVersion` → `dutyPlanVersion.findFirst({ plan: { organizationId, regionId } })` → (retirement loop scoped via `plan: { regionId }` fetched from the same tenant-checked `others` query) → `writeAuditLog` with session-derived `organizationId`.
- `approveV2DraftAction`/`publishV2ScheduleAction` → `approveGeneratedDraft`/`publishApprovedSchedule` → `dutySchedule.findUnique` + explicit `schedule.region.organizationId !== organizationId` check + a second explicit check on `run.organizationId`/`run.regionId` (defense-in-depth against the generation run itself somehow disagreeing with the schedule) → every subsequent Prisma call scoped to the already-validated `run.id`/`schedule.id`.
- `editV2DutyAssignmentAction` → `resolveReplacementMembership` (re-checks `original.pool.organizationId` even though the caller already scoped `assignment`, an explicit, commented defense-in-depth choice) and `resolveMinIntervalPolicy` (now tenant-scoped directly, see finding #2).

No layer in any of the three chains trusts a client-supplied id without
re-validating it against `organizationId` at that layer.

---

### 11. Cross-tenant existence disclosure — Clean

Checked every V2 error-message map (`lifecycle-error-messages.ts`) and the
underlying service error codes: a nonexistent id and a foreign-tenant id
consistently produce the same generic outcome (`SCHEDULE_NOT_FOUND`
covers "doesn't exist"; `TENANT_MISMATCH`/`DRAFT_TENANT_MISMATCH` produce
a generic "bu kayda erişim yetkiniz yok" message that reveals nothing
about whether the id exists — it fires identically whether the id is
real-but-foreign or was simply guessed). `loadDraftPreview` returns
`NOT_FOUND` for both a nonexistent and a foreign-tenant `previewId` via a
single `findFirst({ where: { id, organizationId } })` — structurally
incapable of distinguishing the two cases, matching the codebase's
documented non-disclosure convention.

---

### 12. Bilecik demo script's production-safety guard — Clean

`guardDatabaseUrl()` in `seed-bilecik-and-run-demo.ts` requires the parsed
`DATABASE_URL`'s hostname to literally match `/^(localhost|127\.0\.0\.1|::1)$/i`
**and** rejects the run if either the hostname or the database name
contains `prod`/`production`/`live` (so even a hypothetical
"localhost-production" naming mistake is still blocked). Confirmed via
`package.json` grep: wired only as its own explicit
`demo:duty-rules-v2-bilecik` script. Confirmed via `find
.github/workflows`: **no workflow directory exists in this repo at all**,
so there is no CI/deploy pipeline that could invoke it, intentionally or
accidentally.

---

### 13. Raw Prisma error / stack leakage — Clean

Every `catch` block checked across `commit-complete-draft.ts`,
`approve-generated-draft.ts`, `publish-approved-schedule.ts`,
`activate-plan-version.ts`, and the Phase 11 configuration services maps
unexpected errors to a generic Turkish message via a typed error code,
logging the real error server-side via `logger.error(event, context,
error)` — the raw error/stack is never included in the returned
`ActionState`/result object. `activate-plan-version.ts`'s retry loop
specifically: `P2034` (serialization conflict) is caught, re-classified by
re-querying actual DB state, and only ever surfaces the generic
`"Etkinleştirme sırasında bir eşzamanlılık çakışması oluştu."` message —
never the underlying Prisma error text.

---

### 14. SQL injection / dynamic query construction — Clean

Grepped the entire V2 scope for `$queryRaw`/`$executeRaw`/`Prisma.sql` —
zero matches. No file constructs a Prisma `orderBy` or `where` key from a
client-supplied string (every `orderBy` in scope uses a literal, hardcoded
field name). No client-supplied string is interpolated into a `logger.*`
call template in a way that could forge a log line's structure (all
`logger.*` calls in scope pass a fixed event-name string plus a structured
context object).

---

## Verification performed

- `npx tsc --noEmit` — clean, zero errors.
- `npm run lint` — clean (2 pre-existing warnings in an unrelated
  integration test file, untouched by this audit).
- `npx vitest run` on every file touched by a fix:
  - `src/lib/duty-rules-v2/persistence-edit/resolve-min-interval-policy.test.ts` — 6/6 passing
  - `src/lib/duty-rules-v2/ui/draft-preview-store.test.ts` (new) — 2/2 passing
  - `src/app/(dashboard)/cizelgeler/v2/onizleme/[previewId]/actions.test.ts` — 3/3 passing
  - `src/app/(dashboard)/cizelgeler/v2/planlar/[planId]/versions/[versionId]/actions.test.ts` (new) — 6/6 passing
  - `src/app/(dashboard)/cizelgeler/[id]/atama/v2-assignment-actions.test.ts` — 10/10 passing
  - **Total: 27/27 passing** across the 5 files above.
- `npm run test:integration` was **not** run — this sandbox has no
  `TEST_DATABASE_URL` configured (`tests/integration/helpers/test-db-guard.ts`
  refuses to run without one, by design, to prevent accidental destructive
  runs against an unintended database). No file under
  `src/lib/duty-rules-v2/persistence/` (the Phase 8/9 files the task
  specifically calls out for mandatory integration re-runs) was modified
  by this audit, so the persistence-layer integration suite has no source
  change to regress against. `tests/integration/duty-rules-v2-ui-generation.integration.test.ts`
  *was* updated (both `markDraftPreviewConsumed` call sites) for API
  compatibility with finding #1's fix and confirmed to type-check cleanly
  under `tsc --noEmit`; it could not be executed in this environment.

## Overall verdict

No CRITICAL or HIGH severity findings. All three fixed findings (#1–#3)
were defense-in-depth or authenticated-actor-only hardening — none was a
live, externally-reachable vulnerability in the code as merged, but all
three are now closed with a required-parameter/type-level guarantee rather
than an informal "the caller already validates this" comment, which is
strictly better going forward. The four documented-only findings (#4–#7)
are genuine but low-severity gaps consistent with — and in most cases
directly precedented by — judgment calls already made and accepted
elsewhere in this codebase's V1 audit series; none blocks a pilot
deployment at realistic chamber scale. The persistence layer (Phase 8/9)
in particular is exceptionally solid: every status transition uses the
conditional-`updateMany`-plus-count-check race-safe idiom, every mutating
transaction closes its own TOCTOU window with an in-transaction re-check,
and idempotency holds under both sequential replay and genuine concurrent
races. **Duty Rules V2 (Phases 8–13) is safe for a real chamber's
operational data at this point.**
