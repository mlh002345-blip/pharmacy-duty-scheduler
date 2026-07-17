# Duty Rules V2 — Phase 7: Complete Draft Schedule Generation

## Purpose

Phase 4 (eligibility/fairness), Phase 5 (configurable rules), and Phase 6
(configurable selection strategies) each produce their own inspectable
output, but nothing assembled them into ONE canonical, judgeable artifact
describing "what a full draft schedule for this period would look like."

Phase 7 adds exactly that: `CompleteDraftSchedule`, assembled purely from
the already-computed `DutyEngineDraftResult` (Phase 4-6 output). It is
additive — `buildDutyEngineContext` still returns byte-identical Phase
4-6 fields; three new fields (`completeDraftSchedule`,
`completeDraftFingerprint`, `draftManifest`) are attached alongside them.

## What this module does NOT do

- It never re-ranks, re-selects, excludes, or resurrects a candidate.
  Every `DraftAssignment` is a direct, traceable projection of a Phase 6
  `ProvisionalSlotSelection.selectedCandidateKeys` entry. Proven by the
  dedicated `no-reranking.test.ts` suite (order preservation, no
  candidate invention, no silent discard, requiredCount never exceeded,
  a malformed Phase 6 winner stays visible as an `INVALID` diagnostic
  rather than being repaired) plus a static source scan that fails the
  build if any `draft/` module ever imports `rank-candidates.ts`,
  `apply-fallback-chain.ts`, `build-strategy-context.ts`, or
  `resolve-candidate-set.ts`.
- It creates no `DutySchedule`/`DutyAssignment` database records, advances
  no `RotationState`, and performs no I/O.
- It does not decide whether a plan is "active" or introduce a production
  runtime switch — this is a pure, in-memory, read-only projection.
- It does not implement commit/publish transactions, multi-period
  optimization, or backtracking. `isCommitEligible` is a flag a
  not-yet-built commit step could consult; this phase does not build that
  step.

## Validator architecture

Assembly (`assemble-draft-slots.ts`) is **pure projection only** — it
never decides whether something is a diagnostic. It does its best-effort
construction (an unresolvable `candidateKey` simply cannot produce an
assignment fact — there is no `pharmacyId` to project) and every
validator independently re-derives its own expectations from the same
Phase 4-6 source data, so a validator never trusts assembly's output at
face value. Each validator owns a **disjoint** slice of
`DraftDiagnosticCode`:

| Validator | Owns |
|---|---|
| `validate-draft-references.ts` | `DRAFT_SLOT_WITHOUT_POOL`, `DRAFT_ASSIGNMENT_REFERENCES_UNKNOWN_SLOT`, `DRAFT_ASSIGNMENT_REFERENCES_UNKNOWN_CANDIDATE`, `DRAFT_ASSIGNMENT_COUNT_MISMATCH_SELECTION`, `DRAFT_UNKNOWN_PHARMACY_REFERENCE`, `DRAFT_MEMBERSHIP_MISMATCH`, `DRAFT_PLAN_VERSION_MISMATCH`, `DRAFT_SHIFT_MISMATCH`, `DRAFT_POOL_MISMATCH`, `DRAFT_SLOT_KEY_FORMAT_INVALID` |
| `validate-draft-capacity.ts` | `DRAFT_NO_SELECTION_STRATEGY`, `DRAFT_SLOT_UNDERFILLED`, `DRAFT_ASSIGNMENT_COUNT_EXCEEDS_REQUIRED`, `DRAFT_MISSING_COUNT_MISMATCH`, `DRAFT_STRATEGY_MISSING_FOR_SELECTED_SLOT` |
| `validate-draft-eligibility-origin.ts` | `DRAFT_CANDIDATE_NOT_IN_STRICT_OR_RELAXED`, `DRAFT_ORIGIN_MISMATCH`, `DRAFT_STRATEGY_MISMATCH`, `DRAFT_SELECTED_RANK_MISMATCH`, `DRAFT_RELAXATION_MISMATCH`, `DRAFT_SLOT_DATE_MISMATCH` |
| `validate-draft-cross-slot.ts` | `DRAFT_DUPLICATE_ASSIGNMENT_KEY`, `DRAFT_SAME_DAY_PHARMACY_CONFLICT`, `DRAFT_SAME_DAY_PHARMACY_MULTI_MEMBERSHIP_CONFLICT`, `DRAFT_FALLBACK_USED_ON_ASSIGNMENT` |
| `validate-draft-chronology.ts` | `DRAFT_DUPLICATE_SLOT_IDENTITY`, `DRAFT_PERIOD_BOUNDARY_VIOLATION`, `DRAFT_DUPLICATE_CANDIDATE_KEY_IN_SLOT`, `DRAFT_SAME_SLOT_DUPLICATE_PHARMACY`, `DRAFT_DUPLICATE_SELECTION_ORDINAL`, `DRAFT_SELECTION_ORDINAL_GAP`, `DRAFT_RANK_NOT_MONOTONIC` |
| `validate-draft-completeness.ts` | `DRAFT_DAY_SUMMARY_INCONSISTENT`, `DRAFT_PERIOD_SUMMARY_INCONSISTENT` |

No validator repairs or drops data — every finding is reported as a
`DraftDiagnostic` alongside the (still-present) slot/assignment it
concerns. `build-complete-draft-schedule.ts` runs all six, aggregates
and sorts their output, and re-attaches each diagnostic back onto the
slot(s) whose `subjectKey` it matches (a pure re-projection, not a new
decision).

## Module layout (`src/lib/duty-rules-v2/draft/`)

- `domain/draft-schedule.ts` — `CompleteDraftSchedule`, `DraftDay`,
  `DraftSlot`, `DraftAssignment`, `DraftGenerationManifest` contracts.
- `domain/draft-diagnostic.ts` — the stable `DraftDiagnosticCode`
  catalogue (34 codes) with ERROR/WARNING/INFO severity, owned per the
  table above.
- `assemble-draft-slots.ts` — pure per-slot/per-assignment projection
  (no diagnostic decisions).
- `validate-draft-references.ts`, `validate-draft-capacity.ts`,
  `validate-draft-eligibility-origin.ts`, `validate-draft-cross-slot.ts`,
  `validate-draft-chronology.ts`, `validate-draft-completeness.ts` — the
  six validators above.
- `fingerprint-complete-draft.ts` — `computeCompleteDraftFingerprint`.
- `build-complete-draft-schedule.ts` — the single entry point,
  `assembleCompleteDraftSchedule(result, options)`.

## Slot status classification (final decision: keep UNSCHEDULED)

The original request listed `FILLED` / `UNDERFILLED` / `UNRESOLVED` /
`INVALID` as the requested `DraftSlotStatus` values. This implementation
deliberately keeps a **fourth** per-slot status, `UNSCHEDULED`, instead
of folding "no pool at all" into `UNDERFILLED` or `UNRESOLVED` — both of
those imply a strategy COULD have run and failed to fill the seat, which
is a materially different situation from "there was never anything to
run against." Collapsing the distinction would hide a
configuration-time gap (`SLOT_WITHOUT_POOL`, already a Phase 4 concept)
behind the same status used for a resolution-time gap. `INVALID` is
never a per-slot status here — it is exclusively the **draft-level**
`status`, because a single slot's own facts can never by themselves make
the diagnostic ERROR (invalidity always arises from a cross-reference
disagreeing with something outside that one slot, e.g. an
`unknown-candidate` or `origin-mismatch` finding).

Documented semantics, per the review request:

- **Exact meaning**: `UNSCHEDULED` = `ResolvedSlot.resolvable === false`
  (`rotationPoolId` was never configured for this slot/day-type). No
  strategy ever runs against it; it is a Phase 4 configuration gap
  restated at draft level.
- **requiredAssignmentCount**: an `UNSCHEDULED` slot's `requiredCount` is
  still whatever the plan configured (never forced to 0) — it DOES
  contribute to `counts.totalSlots` / `manifest.counts.totalSlots` and to
  its `DraftDay`'s `requiredCount` roll-up, exactly like any other slot.
  It never contributes to `filledSlots`.
- **Draft status**: any `UNSCHEDULED` slot forces the overall draft to at
  best `PARTIAL` (never `COMPLETE`), identically to `UNDERFILLED` /
  `UNRESOLVED` — see `counts.unscheduledSlots` in the `PARTIAL` branch of
  `build-complete-draft-schedule.ts`.
- **Commit eligibility**: `isCommitEligible` is `false` whenever any slot
  is `UNSCHEDULED`, via the same `PARTIAL`/`COMPLETE` gate as the other
  non-`FILLED` statuses.
- **Difference from UNRESOLVED**: `UNRESOLVED` means the slot COULD have
  been served (it has a pool) but either no strategy was configured at
  all, or the configured strategy chain failed to resolve — a
  resolution-time gap. `UNSCHEDULED` means there was never a pool to
  resolve against — a configuration-time gap. They carry different
  diagnostic codes (`DRAFT_SLOT_WITHOUT_POOL`, INFO vs.
  `DRAFT_NO_SELECTION_STRATEGY`, WARNING) and are never conflated in
  `counts` or `manifest`.
- **Day/period summaries**: `DraftDay.status` rolls up to `UNSCHEDULED`
  only when EVERY slot on that day is `UNSCHEDULED`; a day with a mix of
  `UNSCHEDULED` and other non-`FILLED` slots reports the more actionable
  `UNDERFILLED`/`UNRESOLVED` status. `manifest.underfilledSlotKeys` and
  `manifest.unresolvedSlotKeys` deliberately do NOT include
  `UNSCHEDULED` slot keys (they are neither) — a future consumer that
  wants configuration gaps specifically should filter
  `days[].slots[].status === "UNSCHEDULED"` directly.
- **Fingerprint participation**: `UNSCHEDULED` participates in the
  fingerprint exactly like every other status — it is a value of
  `DraftSlot.status`, which is part of `days`, which is part of the
  hashed payload (see below). No special-casing.

Tested explicitly in `build-complete-draft-schedule.test.ts` ("marks a
slot UNSCHEDULED (not UNDERFILLED) when it has no pool...").

## Overall draft status

- `INVALID` — at least one ERROR-severity diagnostic exists anywhere in
  the draft. `isCommitEligible` is always `false`.
- `PARTIAL` — no ERROR diagnostics, but at least one slot is
  `UNDERFILLED`, `UNRESOLVED`, or `UNSCHEDULED`.
- `COMPLETE` — every slot is `FILLED` and there are no ERROR diagnostics.
  `isCommitEligible` is `true` only in this case.

## No-strategy behavior

When `configuredSelectionStrategies` is empty, `provisionalSelections`
is empty for the whole run (Phase 6 behavior, unchanged). Every
resolvable, `requiredCount > 0` slot is then classified `UNRESOLVED`
with diagnostic `DRAFT_NO_SELECTION_STRATEGY` (WARNING), zero
assignments, draft `status: "PARTIAL"`, `isCommitEligible: false`, and a
deterministic fingerprint/manifest exactly like any other run. Proven
end-to-end (including against a real V1-equivalent multi-week period,
not just a synthetic fixture) in
`v1-golden-equivalence.test.ts`'s "no-strategy run over the same full
period" case.

## completeDraftFingerprint — canonical payload

`completeDraftFingerprint = sha256Canonical(payload)`, where `payload`
is **exactly**:

```
{ engineVersion, selectionEngineVersion, generationMode, periodStart,
  periodEnd, provenance, days, assignments, counts, diagnostics,
  status, isCommitEligible, sourceResultFingerprint }
```

i.e. the whole `CompleteDraftSchedule` minus `completeDraftFingerprint`
itself and minus `manifest` (circular — the manifest embeds this same
fingerprint), **plus** the upstream `sourceResultFingerprint` (Phase
4-6's own `resultFingerprint`) folded directly into the hashed payload
so the fingerprint is sensitive to upstream changes even when they
happen not to alter any field this draft itself projects.
`sha256Canonical` → `canonicalSerialize` recursively sorts object keys,
so key order never affects the hash; all set-like arrays embedded in the
payload are already deterministically ordered by assembly itself
(`draftAssignmentKey` / `slotKey` / `date+code+subjectKey` ASC).

Tested in `fingerprint-manifest.test.ts`: changes on selected-pharmacy/
assignment order, `requiredCount`, upstream fingerprint, engine version,
any blocking diagnostic, strategy id/type, and fallback use; stability
under object key order (full recursive key-order reversal), repeated
execution (3x), and two independently-built runs from identical input.

## DraftGenerationManifest contract

Includes: `planVersionId`/`organizationId`/`regionId` (identity),
`periodStart`/`periodEnd`, `status`/`isCommitEligible`, `counts`,
`sourceResultFingerprint` + full `provenance` (every upstream hash),
`completeDraftFingerprint`, `assignmentKeys` (deterministically ordered),
`unresolvedSlotKeys`/`underfilledSlotKeys` (sorted), deduplicated sorted
`blockingDiagnosticCodes` (ERROR-severity only), and `validation`
(error/warning/info counts). Excludes any timestamp, database-generated
id, environment value, hostname, path, secret, or display-only text —
verified by a dedicated test that scans manifest keys/serialized content
for forbidden substrings and ISO-timestamp patterns.

## Full-period V1 equivalence (Phase 7 extension)

`v1-golden-equivalence.test.ts` gained a new "Phase 7 — full-period
Complete Draft Schedule equivalence" block that reuses the SAME unmodified
Path A (`generateDutySchedule`) / Path B (`buildDutyEngineContext`, now
including `completeDraftSchedule`) harness already used for the Phase 6
per-slot comparisons, asserting per-day/whole-period Complete Draft
Schedule equivalence: assignment dates, ordered selected pharmacy ids,
per-day assignment count, total assignment count, duty weights,
underfilled-date sets, and `COMPLETE`/`PARTIAL` status. It covers a
representative core of the previously requested scenario matrix
(dailyDutyCount 1 and 3, official and religious holiday, holiday eve,
unavailability, interval relaxation/underfill, Turkish-name tie, mixed
strict/relaxed multi-date period, repeated execution ×3, and the
no-strategy case) — **11 new scenarios**, layered on top of the 37
pre-existing Phase 6 scenarios in the same file (48 total in that file).
This is honestly a SUBSET of the originally requested 29-scenario matrix
at the Phase-7 comparison level specifically (it does not re-run
CANNOT_DUTY/EMERGENCY_EXCUSE/PREFER_DUTY/historical-load/balance-
adjustment/exact-tie/three-holiday-overlap individually through the new
Phase 7 assertion helper, though every one of those IS already exercised
at the Phase 6 per-slot level in the same file, which
`completeDraftSchedule` is directly built from).

## Integration point

`buildDutyEngineContext` (`engine/build-engine-context.ts`) calls
`buildDraftResult(...)` exactly as before Phase 7, then additively calls
`assembleCompleteDraftSchedule(preDraftResult, { sameDaySecondAssignmentAllowed: input.policy.sameDaySecondAssignmentAllowed })`
and spreads the three new fields onto the returned object. No stage
logic lives in the orchestrator; assembly/validation logic lives entirely
in `draft/`.

## Read-only integration evidence

A full disposable Prisma-backed integration test (persisted plan →
loader → Phase 4-6 → Phase 7, run twice, proving zero DB writes and
byte-identical output) was **not** built in this delivery — it requires
provisioning a local Postgres instance and the existing `load-duty-plan-version.ts`
DB-round-trip test harness, which was out of scope for the time
available in this increment. The purity/security scan above (zero
Prisma/SQL/write/fs/network/env/Date.now/randomness/console imports
anywhere under `draft/`, confirmed by repository-wide grep) is the
evidence available in this delivery; it demonstrates the module is
*structurally* incapable of a write, but does not exercise a real
database. Flagged as a known gap for the next increment rather than
claimed as done.

## Purity/security boundaries (verified)

Zero Prisma/raw-SQL/write-method/filesystem/network/`process.env`/
`Date.now`/`Math.random`/`randomUUID`/console-logging anywhere under
`draft/` (runtime modules only — test files are excluded from the scan
by design, e.g. `no-reranking.test.ts` reads its own sibling `.ts`
sources to prove the no-ranking-import invariant). No production
route/action/page imports anything from `draft/`. No `RotationState`
read or write. No chamber/city/province hardcoding (spot-checked against
known Turkish province names).

## Deferred (explicitly out of scope for this phase)

Persistence of any kind, a commit/publish transaction, UI surfaces,
public-page publication, Excel/PDF export of the draft, multi-period
optimization, backtracking/global search, any AI-generated logic, and
the full Prisma-backed read-only integration test described above.
`isCommitEligible` is a forward-looking signal only — no code in this
repository currently reads it to gate a write.
