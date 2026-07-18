# Duty Rules V2 — Phase 9: Draft Approval and Publication

## Purpose

Phase 8 (`docs/architecture/DUTY_RULES_V2_ATOMIC_DRAFT_PERSISTENCE.md`)
persists a Phase 7 `CompleteDraftSchedule` as a `DRAFT` `DutySchedule`.
Phase 9 adds the two remaining steps of a controlled lifecycle:

```
DRAFT --[approveGeneratedDraft]--> APPROVED --[publishApprovedSchedule]--> PUBLISHED
```

Approval is a human-review checkpoint that changes nothing about
rotation state. Publication is the one moment `RotationState` — the
persistent "whose turn is it" cursor — actually advances, in the same
atomic transaction as the schedule's status change.

## What this phase does NOT do

- **No manual editing.** Neither service touches a single
  `DutyAssignment` row's content — both are proven, by test, to leave
  every persisted assignment byte-identical.
- **No re-running Phase 4-7.** RotationState advancement is derived
  entirely from already-persisted facts: each assignment's
  `membershipId` (an existing FK) and `slotKey` (parsed for its
  `dayTypeKey` segment — a already-computed, already-validated string,
  not a re-derivation of eligibility/ranking).
- **No production caller.** Nothing in `src/app/` imports either
  service.
- **No V1 change.** `src/lib/scheduling/` is untouched.
- **No UI.** This phase is service-layer only, exactly like Phase 8.

## Persisted model changes

- `DutyScheduleStatus` gains `APPROVED` between `DRAFT` and `PUBLISHED`.
  V1-generated schedules never pass through it — V1 has no approval
  service and continues to go straight to `PUBLISHED` via the
  pre-existing, unmodified `publishDutyScheduleAction`.
- `DutyGenerationRunStatus` gains `APPROVED` and `PUBLISHED`, mirroring
  the schedule's own status for this run.
- `DutyGenerationRun` gains, all nullable/additive:
  - `approvedById` (FK to `User`, `reviewedById`-style convention from
    `DutyRequest`) / `approvedBy` / `approvedAt`.
  - `publishedById` / `publishedBy` / `publishedAt`.
  - `rotationStateSnapshot` (JSON): captured once, at approval, as
    `[{ rotationStateId, lockVersion }, ...]` for every `RotationState`
    row publication will touch. This is the optimistic-lock baseline —
    see "Optimistic locking" below.
- Migration: `20260718133653_duty_rules_v2_approval_publication`,
  purely additive (new enum values, new nullable columns, new FKs) — no
  destructive change.

## Approval lifecycle (`approve-generated-draft.ts`)

Input: `{ dutyScheduleId, organizationId, userId }` — trusted caller
context, exactly matching Phase 8's `commitCompleteDraft` convention.

Validation, in order:
1. Schedule exists (`SCHEDULE_NOT_FOUND`).
2. Schedule belongs to the caller's organization (`TENANT_MISMATCH`).
3. Schedule carries a `DutyGenerationRun` — V1 schedules and any schedule
   not created via Phase 8 have none (`GENERATION_RUN_MISSING`).
4. The generation run's own `organizationId`/`regionId` agree with the
   schedule's (`TENANT_MISMATCH`).
5. Status handling: `PUBLISHED` → `SCHEDULE_ALREADY_PUBLISHED`;
   `APPROVED` → idempotent replay (see below); anything else that isn't
   `DRAFT` → `SCHEDULE_NOT_DRAFT`.
6. Integrity re-check (`validate-generation-run-integrity.ts`, shared
   with publication — see below): fingerprint/manifest presence,
   persisted assignment count vs. the manifest's own stored count, every
   assignment's provenance columns non-null, every referenced
   pharmacy/membership still belongs to the same tenant.
7. The target-conflict check Phase 8 needed is unnecessary here: the
   persisted `DutySchedule.@@unique([year, month, regionId])` makes a
   second schedule for this exact target structurally impossible while
   this row exists.

On success, in one `Serializable` transaction:
1. `dutySchedule.updateMany({ where: { id, status: "DRAFT" }, data: { status: "APPROVED" } })` —
   conditional, not an unconditional update after a separate read, so
   two concurrent approvals can never both "win."
2. `dutyGenerationRun.update`: `status: "APPROVED"`, `approvedById`,
   `approvedAt`, and the freshly-resolved `rotationStateSnapshot`.
3. One `AuditLog` entry (`entity: "DutySchedule"`, `action: "UPDATE"`).

Approval **never** calls `rotationState.update` — it only reads
`RotationState` rows (via `resolveRotationTargets`, read-only) to build
the snapshot. Proven by a dedicated integration test asserting the
touched pool's `RotationState` row is byte-identical before and after.

## Publication lifecycle (`publish-approved-schedule.ts`)

Input: `{ dutyScheduleId, organizationId, userId }`.

Pre-transaction validation re-verifies everything approval already
checked (defense-in-depth against drift between approval and
publication — never trusts "it was fine at approval time" is still
true): schedule found/tenant match/generation run present, status must
be `APPROVED` (`DRAFT` → `SCHEDULE_NOT_APPROVED`; `PUBLISHED` → idempotent
replay or `GENERATION_RECORD_CORRUPTED` if inconsistent), the same
`validateGenerationRunIntegrity` re-check, and the optimistic-lock
comparison described below.

Transaction (`Serializable`):
1. Re-check `status === "APPROVED"` fresh (closes the pre-check's TOCTOU
   window); if already `PUBLISHED`, resolve as idempotent replay.
2. Re-resolve rotation targets and re-compare against the approval
   snapshot (second TOCTOU close).
3. For each touched `RotationState` row: compute the new
   `currentRound`/`lastServedMembershipId`/`carriedForward` via the pure
   `computeRotationAdvancement`, then
   `rotationState.updateMany({ where: { id, lockVersion: expected }, data: { ..., lockVersion: { increment: 1 } } })`.
   If the affected count isn't exactly 1, a genuine race is caught here
   too (belt-and-suspenders alongside the pre-check).
4. `dutySchedule.updateMany({ where: { id, status: "APPROVED" }, data: { status: "PUBLISHED" } })`
   — same conditional-update race protection as approval.
5. `dutyGenerationRun.update`: `status: "PUBLISHED"`, `publishedById`,
   `publishedAt`.
6. One `AuditLog` entry.

## RotationState advancement rules

The full algorithm lives in `advance-rotation-state.ts` and is
documented in-line there in detail (it is the FIRST writer of this
table anywhere in the codebase — there is no prior specification to
match, so every assumption is stated explicitly and unit-tested):

- **Scope resolution** (`resolveRotationTargets`) mirrors
  `resolve-rotation-facts.ts`'s existing READ-side rule exactly: an
  exact `dayTypeScope` match wins, else the pool's `"ALL"` state, else
  no state at all for that pool (nothing to advance — not an error).
  Using the identical rule on both the read and write side means
  approval's snapshot and publication's actual update can never disagree
  about which row is "the" state for a given assignment.
- **Only pools/scopes actually referenced by this run's persisted
  assignments are touched** — `resolveRotationTargets` is built strictly
  from `DutyAssignment.membershipId`/`.slotKey` rows belonging to this
  `generationRunId`; an unrelated pool's `RotationState` is never read
  for writing and never appears in the update set. Proven by a dedicated
  integration test with two independent pools.
- **`lastServedMembershipId`** becomes the membership served LAST in the
  batch (assignments ordered date ASC, then `selectionOrdinal` ASC — the
  exact order Phase 6's own sequential accumulator processed them in).
- **`currentRound`** advances by the number of full passes through the
  pool's currently-active membership list this batch consumed, using
  the SAME "distance from cursor, a zero distance wraps to a full pool
  size" formula `resolve-rotation-facts.ts` already uses to compute
  `distanceFromCursor` for reading — symmetric with the pre-existing
  read model, not independently invented. Cumulative distance across the
  batch is summed, then floor-divided by the active pool size.
- **`carriedForward`** is never used to invent a new debt (that would
  require re-running Phase 4 eligibility for every non-selected
  candidate — explicitly out of scope). It only clears an existing entry
  when that exact membership was actually served in this batch.
- Active pool membership ("the currently active list", used only for
  round-distance math) is a simple `leftAt: null` query — deliberately
  NOT the full temporal as-of-date resolution Phase 4's pool loader
  performs, which would duplicate Phase 4/7 logic. This is a legitimate,
  intentional simplification, not an oversight.

## Optimistic locking

`RotationState.lockVersion` (pre-existing column, previously unused —
see the core schema's own comment anticipating "a future engine")
becomes meaningful in Phase 9:

1. **Approval** snapshots each touched row's CURRENT `lockVersion` into
   `DutyGenerationRun.rotationStateSnapshot` — the "state expected by
   the generation input" the task requires publication to check against.
2. **Publication**, before opening its transaction, re-resolves the
   SAME rows and compares their CURRENT `lockVersion` against the
   snapshot. Any difference (a different set of rows, or a matching row
   whose `lockVersion` has moved) is
   `ROTATION_STATE_CONFLICT` — publication refuses to run, the schedule
   stays `APPROVED`, nothing about `RotationState` is touched.
3. The SAME comparison runs again inside the transaction (closing the
   pre-check's TOCTOU window), and each individual
   `rotationState.updateMany({ where: { lockVersion: expected } })` is
   itself a conditional write — three independent layers of protection
   against a stale write.
4. Every successful advancement increments `lockVersion` by exactly 1.

A stale `RotationState` — proven with a dedicated integration test that
mutates `lockVersion` out-of-band between approval and a publication
attempt — is rejected outright; the schedule and every `RotationState`
row remain exactly as they were.

## Idempotency and conflicts

| Scenario | Result |
|---|---|
| Same schedule approved twice | Second call: `outcome: "IDEMPOTENT_REPLAY"`, same `approvedBy`/`approvedAt`, zero duplicate audit entries |
| Same schedule published twice | Second call: `outcome: "IDEMPOTENT_REPLAY"`, same `publishedBy`/`publishedAt`, `RotationState` advanced exactly once |
| Concurrent identical approval | Exactly one `APPROVED`, the other `IDEMPOTENT_REPLAY` — proven with real concurrent `Promise.all` |
| Concurrent identical publication | Exactly one `PUBLISHED`, the other `IDEMPOTENT_REPLAY`, `RotationState.lockVersion` advances by exactly 1 — proven with real concurrent `Promise.all` |
| Stale `RotationState` | `ROTATION_STATE_CONFLICT`, no write |
| `DRAFT` sent directly to publication | `SCHEDULE_NOT_APPROVED` |
| Foreign tenant | `TENANT_MISMATCH` |
| Corrupted/incomplete generation record | `GENERATION_RECORD_CORRUPTED` |

`PUBLICATION_TARGET_CONFLICT` exists as a stable error code for the
theoretical case where a race-recovery re-query finds neither an
idempotent match nor a resolvable state — given
`DutySchedule.@@unique([year, month, regionId])` prevents two schedules
from ever sharing a target, this is a defensive code, essentially
unreachable in the current schema, included for forward-compatibility
and symmetry with Phase 8's `DRAFT_TARGET_CONFLICT`.

Every failure returns `{ ok: false, code, message }` with a fixed, safe
message — never a raw Prisma/driver error.

## Rollback behavior

Both services use one `Serializable` Prisma transaction. Publication's
`Serializable` transaction body is provably all-or-nothing: a test-only
seam (`failAfterStep`, mirroring `commitCompleteDraft`'s `failAfterStep`
convention) forces a failure after the first `RotationState` update,
after all `RotationState` updates, after the schedule status update, and
after the audit write. All four are proven, against real Postgres, to
leave the schedule still `APPROVED` (never a partial `PUBLISHED`), every
`RotationState` row byte-identical to before the attempt, zero new audit
rows, and — critically — the schedule still cleanly publishable
afterward (the "failed" attempt didn't leave the target half-occupied).

## Audit trail

Both services write exactly one `AuditLog` row per real state change
(`action: "UPDATE"`, `entity: "DutySchedule"`), in the same transaction
as the state change itself — if the audit write fails, everything above
it rolls back too, exactly like every other transactional write path in
this codebase. Idempotent replays write no additional audit row (nothing
new happened).

## V1 compatibility

`DutyScheduleStatus.APPROVED` and every new column are additive; V1's
`generateAndSaveDutySchedule` and `publishDutyScheduleAction` are
untouched and never produce or read the new fields. A V1 schedule has no
`DutyGenerationRun`, so `approveGeneratedDraft`/`publishApprovedSchedule`
correctly refuse it with `GENERATION_RUN_MISSING` rather than silently
mishandling it.

## Remaining UI integration boundary

No route, server action, or UI surface calls either service in this
phase — confirmed via a full `src/app/` grep. A future phase must add
the authorization-guarded route/action layer (mirroring
`requireOrganizationRole`/`writeAuditLog` conventions already used by
`publishDutyScheduleAction`) before either service is reachable from the
product.
