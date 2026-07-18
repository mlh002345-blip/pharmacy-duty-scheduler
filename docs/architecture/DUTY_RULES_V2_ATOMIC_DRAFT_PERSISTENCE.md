# Duty Rules V2 — Phase 8: Atomic Draft Persistence

## Purpose

Phase 7 (`docs/architecture/DUTY_RULES_V2_COMPLETE_DRAFT_GENERATION.md`)
produces `CompleteDraftSchedule` — a complete, self-consistent,
in-memory description of a generated schedule. It performs no database
writes. Phase 8 adds exactly one thing: a way to persist ONE such draft
safely and atomically as a `DRAFT` `DutySchedule`, or to do nothing at
all. It never invents, re-ranks, or replaces a single assignment — every
row it writes is a direct restatement of a fact Phase 7 already computed.

## What this phase does NOT do

- **No publication.** A committed schedule's `status` is always `DRAFT`,
  never `PUBLISHED`. Publishing (`publishDutyScheduleAction`) remains a
  separate, pre-existing, unrelated action a human operator invokes later
  — this phase never calls it and never changes what it does.
- **No approval workflow, no manual editing.** Nothing here lets a user
  review, adjust, or approve a draft before/after commit. That is Phase
  9's job (see "Phase 9 boundary" below).
- **No RotationState advancement.** `currentRound`, `lockVersion`,
  `carriedForward`, and `lastServedMembershipId` are never read for
  write purposes and never written by this module. See "Why RotationState
  is not advanced yet" below.
- **No production caller.** Nothing in `src/app/` imports
  `commit-complete-draft.ts`. It is reachable only from tests in this
  phase. Wiring it into a route/server action is explicitly deferred.
- **No V1 changes.** `src/lib/scheduling/generate-duty-schedule.ts` and
  `generate-and-save-duty-schedule.ts` are untouched. Every new
  `DutyAssignment` column this phase adds is nullable and defaults to
  `NULL`/unset for existing rows; V1's own INSERT statements never
  reference them, so V1-generated schedules are byte-identical in every
  column they always wrote.

## Persisted models

### `DutyGenerationRun` (new)

One immutable, append-only provenance record per successful atomic
commit. Never updated after creation. Fields:

| Field | Source |
|---|---|
| `organizationId`, `regionId` | Trusted caller context, cross-checked against the draft |
| `planId`, `planVersionId` | Resolved by looking up `draft.provenance.planVersionId` in the database |
| `dutyScheduleId` | The `DutySchedule` row created in the same transaction (`@unique` — 1:1) |
| `generationMode`, `periodStart`, `periodEnd` | `draft.generationMode` / `draft.periodStart` / `draft.periodEnd`, verbatim |
| `configurationFingerprint`, `runtimeInputHash`, `ruleSetFingerprint`, `strategySetFingerprint` | `draft.provenance.*`, verbatim (Phase 2-6 provenance) |
| `upstreamResultFingerprint` | `draft.manifest.sourceResultFingerprint` — the Phase 4-6 `DutyEngineDraftResult.resultFingerprint` this draft was assembled from |
| `membershipSnapshotHash` | **Derived**: `sha256Canonical` over the sorted, deduplicated set of every assignment's own `sourceProvenance.membershipSnapshotHash`. `CompleteDraftSchedule` has no single top-level membership-snapshot hash because one draft can span more than one rotation pool; this is the run-level aggregate. See `aggregateMembershipSnapshotHash` in `commit-complete-draft.ts`. |
| `provisionalSelectionFingerprint` | **Derived**: `sha256Canonical` over every assignment's own restated Phase 6 facts (`slotKey`, `candidateKey`, `selectionOrdinal`, `provisionalRank`, `origin`, `strategyId`, `strategyType`), sorted deterministically. Same reasoning as above — no single top-level field exists on the draft for this. See `aggregateProvisionalSelectionFingerprint`. |
| `completeDraftFingerprint` | `draft.completeDraftFingerprint`, verbatim. **`@unique`** — this is the idempotency key (see below). |
| `engineVersion`, `selectionEngineVersion` | `draft.engineVersion` / `draft.selectionEngineVersion`, verbatim (Phase 4-6/7's own versions) |
| `draftEngineVersion` | `commit-complete-draft.ts`'s **own** contract version (`DRAFT_ENGINE_VERSION`, currently `1`) — which shape of `CompleteDraftSchedule` and which validation rules this commit service was built against. Independent of Phase 7's own versioning; not a Phase 7 field. |
| `manifest` | `draft.manifest` (the `DraftGenerationManifest`), stored verbatim as plain descriptive JSON. Never interpreted as code. |
| `status` | Always `COMMITTED` in this phase (the enum is deliberately left open for a future status a later phase might add) |

Every write is redundant-but-consistent with what a join through
`DutySchedule` could derive — `organizationId`/`regionId`/`planId`/
`planVersionId` are stored directly on the row (not solely derivable
through the `dutySchedule` relation) so tenant-scoped audit/history
queries never need a join back through `DutySchedule -> Region ->
Organization`.

`dutyScheduleId` is `onDelete: Cascade` from `DutySchedule` — deleting a
schedule (the pre-existing `deleteDutyScheduleAction`) cleans up its
generation run automatically, exactly like `DutyScheduleWarning` already
does. `organizationId`/`regionId`/`planId`/`planVersionId` are
`onDelete: Restrict` — a generation run keeps its tenant/plan-version
references alive, matching every other historical-provenance FK in this
schema (`DutySchedule.planVersionId`, `DutyAssignment.shiftDefinitionId`,
etc.).

### `DutyAssignment` (extended, additive-only)

New, all-nullable columns:

| Field | Meaning |
|---|---|
| `draftAssignmentKey` | `DraftAssignment.draftAssignmentKey` verbatim |
| `membershipId` (+ relation to `RotationPoolMembership`, `onDelete: SetNull`) | `DraftAssignment.membershipId` |
| `selectionOrdinal` | `DraftAssignment.selectionOrdinal` |
| `origin` (new `AssignmentOrigin` enum: `STRICT` \| `RELAXED`) | `DraftAssignment.origin` |
| `strategyId`, `strategyType` | `DraftAssignment.strategyId` / `.strategyType` |
| `fallbackUsed` | `DraftAssignment.fallbackUsed` |
| `selectedRank` | `DraftAssignment.provisionalRank` |
| `decisiveCriterion` | `DraftAssignment.decisiveComparatorCriterion` |
| `generationRunId` (relation to `DutyGenerationRun`, `onDelete: Cascade`) | Which commit produced this row |

Three fields the task's own field list names are **deliberately not
duplicated**, because they already exist on `DutyAssignment` from V1/
earlier V2 work and this phase writes into them directly:
- `weight` (existing column) ← `DraftAssignment.dutyWeight`
- `shiftDefinitionId` (existing column, already FK'd to `ShiftDefinition`) ← `DraftAssignment.shiftId`
- `slotKey` (existing column) ← `DraftAssignment.slotKey`

All nine new columns are `NULL` for every V1 row and for any row created
outside this phase's commit service — V1's own INSERT statements in
`generate-and-save-duty-schedule.ts` never reference them, so nothing
about V1 assignment creation changed.

**Uniqueness** (both composite, both scoped by the nullable
`generationRunId` — PostgreSQL never enforces a unique constraint across
rows where any indexed column is `NULL`, so V1 rows are structurally
exempt and can never collide with a Phase 8 row or each other):
- `(generationRunId, draftAssignmentKey)` — no duplicate assignment
  inside one generation run.
- `(generationRunId, slotKey, selectionOrdinal)` — no duplicate
  selection ordinal inside one persisted slot of one generation run.

## Commit eligibility

`commitCompleteDraft` (`src/lib/duty-rules-v2/persistence/commit-complete-draft.ts`)
takes exactly `{ draft: CompleteDraftSchedule, organizationId, regionId,
userId }` — never a raw assignment array independent of the draft. Before
opening any write, it runs three gates, in order, each returning
immediately on failure:

1. **Structural gate** (`validateDraftStructurally`, no I/O):
   - `draft.status === "COMPLETE"` (rejects `PARTIAL` and `INVALID`)
   - `draft.isCommitEligible === true`
   - `draft.manifest.blockingDiagnosticCodes.length === 0`
   - `completeDraftFingerprint` **recomputed** via the exact same
     `computeCompleteDraftFingerprint` function Phase 7 uses, and
     compared against `draft.completeDraftFingerprint` — catches any
     tampering/corruption between generation and commit.
   - `draft.manifest`'s own fingerprint/period/identity/assignment-count
     fields cross-checked against the draft's own top-level fields.
   - The draft's period must fall within exactly one calendar month —
     `DutySchedule` is `@@unique([year, month, regionId])`, a
     single-month granularity this phase persists into; a multi-month
     draft is correctly rejected rather than silently truncated.
2. **Tenant gate** (`validateTenant`, no I/O): the caller's
   `organizationId`/`regionId` must match `draft.provenance.organizationId`
   / `.regionId` exactly.
3. **Reference gate** (`validateReferences`, read-only DB queries): the
   plan version, every referenced pharmacy, rotation-pool membership, and
   shift definition must still exist AND belong to the same tenant/plan
   version. This is independent, defense-in-depth verification — it
   never trusts the Phase 3 loader alone (see the "membership outside
   target region" and "shift from a different plan version" tests in
   `tests/integration/duty-rules-v2-atomic-draft-persistence.integration.test.ts`,
   both of which construct a self-consistent, correctly-fingerprinted
   draft whose references have since gone stale in the database).

Only once all three pass does the function open a transaction.

## Transaction sequence

One `prisma.$transaction` at `Serializable` isolation:

1. **Re-check target state** — re-run the fingerprint/target lookups
   inside the transaction, closing the TOCTOU window between the
   pre-check (done once, outside the transaction, as a fast path) and
   the transaction itself. A conflict found here throws an internal
   signal that unwinds the transaction and is reclassified outside it.
2. **Create the `DutySchedule`** — `status: "DRAFT"`, never `PUBLISHED`.
3. **Create the `DutyGenerationRun`** provenance record.
4. **Create every `DutyAssignment` row**, one at a time (not
   `createMany`, deliberately — see "Rollback guarantees" below), in
   Phase 7's own deterministic order (`draft.assignments` is already
   sorted `draftAssignmentKey` ASC).
5. **Write an `AuditLog` entry** (`entity: "DutySchedule"`,
   `action: "CREATE"`), using the existing `writeAuditLog(tx, ...)`
   helper — same transaction, so an audit-log failure rolls back
   everything above it, exactly like every other transactional write
   path in this codebase (`generateAndSaveDutySchedule`,
   `publishDutyScheduleAction`, `deleteDutyScheduleAction`).
6. **Return** a typed `CommitCompleteDraftSuccess`.

## Idempotency

Same `completeDraftFingerprint` committed twice:
- The pre-check (and the in-transaction re-check) finds the existing
  `DutyGenerationRun` row and returns it — `outcome: "IDEMPOTENT_REPLAY"`,
  same `dutyScheduleId`/`generationRunId`/`assignmentCount` as the first
  call. No new row of any kind is created.
- Concurrent identical commits: `completeDraftFingerprint` is
  `@unique` on `DutyGenerationRun`. If both transactions' pre-checks miss
  each other (genuine race), the LOSING transaction's insert violates
  that unique constraint (`P2002`) or aborts under `Serializable`
  isolation with a write-conflict/deadlock error (`P2034`) — both are
  caught, and the loser re-queries and returns `IDEMPOTENT_REPLAY`
  against the winner's row rather than surfacing a raw database error.
  Proven with real concurrent `Promise.all` calls against Postgres in the
  integration suite (not a mock).

## Conflict behavior

Different `completeDraftFingerprint` targeting the same
`(organizationId's region, year, month)` slot — `DutySchedule` is
`@@unique([year, month, regionId])`:
- The pre-check (and in-transaction re-check) finds the existing,
  different-fingerprint schedule and returns `DRAFT_TARGET_CONFLICT`
  **without ever attempting to overwrite or delete it**.
- Concurrent different drafts for the same target: the same
  `(year, month, regionId)` unique constraint decides exactly one
  winner; the loser is reclassified from `P2002`/`P2034` into
  `DRAFT_TARGET_CONFLICT`, never a raw error. Proven with real
  concurrent commits in the integration suite — the surviving schedule's
  assignment count is asserted to match EXACTLY ONE of the two candidate
  drafts, never a mix.

### Stable error codes

`DRAFT_NOT_COMMIT_ELIGIBLE`, `DRAFT_FINGERPRINT_MISMATCH`,
`DRAFT_MANIFEST_MISMATCH`, `DRAFT_TENANT_MISMATCH`,
`DRAFT_REFERENCE_MISMATCH`, `DRAFT_ALREADY_COMMITTED` (defensive-only —
the race-recovery path that resolves a `P2002`/`P2034` on
`completeDraftFingerprint` normally succeeds in re-finding the winner and
returning `IDEMPOTENT_REPLAY`; this code is reserved for the extremely
rare case where that re-query itself finds nothing), `DRAFT_TARGET_CONFLICT`,
`DRAFT_TRANSACTION_FAILED`. Every failure path returns
`{ ok: false, code, message }` — never a raw Prisma error or driver
message.

## Rollback guarantees

Every write in the transaction body is a single Prisma `$transaction`
callback. If ANY step throws — including a test-injected failure, a
constraint violation, or an unexpected error — the ENTIRE transaction
rolls back: zero new `DutySchedule`, `DutyGenerationRun`,
`DutyAssignment`, or `AuditLog` rows survive. `DutyAssignment` rows are
inserted one at a time (not via `createMany`, which is a single
indivisible statement) specifically so a test can force a genuine
mid-insertion failure at an exact row boundary and prove the whole batch
— not just the not-yet-inserted rows — reverts.

`commitCompleteDraft`'s second (test-only) parameter,
`{ failAfterStep: "SCHEDULE_CREATED" | "GENERATION_RUN_CREATED" |
"PARTIAL_ASSIGNMENTS" }`, mirrors the existing `writeAuditLogFn`
test-seam convention already used by `generateAndSaveDutySchedule` —
production code never sets it, so production behavior is byte-identical
whether or not the parameter is passed. The integration suite proves all
three failure points leave zero new rows anywhere and an unchanged
`RotationState`, then proves a subsequent real commit of the exact same
draft succeeds cleanly (the "failed" slot was genuinely left free, not
half-occupied).

## Tenant validation

- `organizationId`/`regionId` are always the caller's trusted, session-
  derived context (mirroring `generateAndSaveDutySchedule`'s
  `organizationId` parameter convention) — never taken from the draft
  itself.
- The tenant gate rejects any mismatch between that context and the
  draft's own `provenance.organizationId`/`.regionId` before any database
  read.
- The reference gate independently re-verifies, against the database,
  that the plan version belongs to that same organization/region, and
  that every referenced pharmacy/membership/shift belongs to the same
  tenant and plan version — never trusting the in-memory draft's
  self-consistency alone. Proven with a real second organization/region
  in the integration suite (cross-tenant commit rejected; a hand-built,
  self-consistent-but-stale-referencing draft rejected for both a
  cross-region membership and a cross-plan-version shift).

## Assignment provenance

See the `DutyAssignment` table above. Every new field is a direct
restatement of a Phase 6/7 fact already computed — this module never
re-ranks, re-derives eligibility, or invents a value. The integration
suite's happy-path test asserts every persisted field against the
source `DraftAssignment` object field-by-field, including `origin`,
`strategyId`/`strategyType`, `fallbackUsed`, `selectedRank`, and
`decisiveCriterion`.

## Audit record

One `AuditLog` row per successful `CREATED` commit (not per
`IDEMPOTENT_REPLAY` — nothing new happened on replay), written in the
same transaction via the existing `writeAuditLog(tx, ...)` helper:
`entity: "DutySchedule"`, `entityId` = the new schedule's id,
`action: "CREATE"`, `after` = `{ status: "DRAFT", generationRunId,
completeDraftFingerprint, assignmentCount }`. `userId`/`organizationId`
are the same trusted caller context used everywhere else in this module.

## DRAFT-only schedule status

Every schedule this phase creates has `status: "DRAFT"`. Nothing in this
module ever sets `status: "PUBLISHED"` — that remains the exclusive job
of the pre-existing, unmodified `publishDutyScheduleAction`.

## Why RotationState is not advanced yet

`RotationState` (`currentRound`, `lockVersion`, `carriedForward`,
`lastServedMembershipId`) is Model A's persistent "whose turn is it"
cursor, meant to advance only once a schedule is truly committed to
production use — not merely generated as a draft. Advancing it here,
before a human has reviewed or approved anything, would let a
never-published, possibly-discarded draft permanently consume rotation
turns. This phase snapshots `RotationState` before and after every
commit path (successful, idempotent, conflicting, and rolled-back) in
its integration tests and asserts it is byte-identical every time.
Advancing rotation state is explicitly reserved for a later phase, once
publication/approval exists to gate it.

## Phase 9 boundary

Deferred to a later phase, not built here: manual editing of a committed
draft's assignments, an approval workflow, publication (setting
`status: "PUBLISHED"`), and RotationState advancement tied to that
publication. This phase's `isCommitEligible`/`CREATED` outcome is a
forward-looking signal only — no code in this repository currently reads
it to gate anything beyond this phase's own commit.

## Confirmation: V1 production unchanged

- `src/lib/scheduling/generate-duty-schedule.ts` and
  `generate-and-save-duty-schedule.ts`: zero changes.
- Every new `DutyAssignment` column is nullable/additive; V1's own
  `tx.dutyAssignment.createMany` call in `generate-and-save-duty-schedule.ts`
  never references any of them, so V1-created rows are written exactly
  as before.
- No route or server action in `src/app/` imports
  `commit-complete-draft.ts` — there is no production caller in this
  phase.
- The full pre-existing test suite (`npm test`, `npm run test:integration`,
  `npm run test:e2e`, `npm run test:file`) re-run after this phase's
  changes, with no regressions — see the delivering PR's verification
  results.

## Security / purity

- No raw SQL — every read/write goes through the typed Prisma client.
- No `process.env`/`Date.now()`/randomness affects fingerprints,
  idempotency, or draft identity — every hash this module computes or
  compares is a pure function of the draft's own already-computed,
  deterministic content.
- No arbitrary JSON is executed — `manifest` is stored and read back as
  plain descriptive data only.
- Foreign organization/region/plan/pharmacy references are rejected by
  the tenant and reference gates before any write.
