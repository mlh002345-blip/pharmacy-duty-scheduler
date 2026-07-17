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
  `ProvisionalSlotSelection.selectedCandidateKeys` entry.
- It creates no `DutySchedule`/`DutyAssignment` database records, advances
  no `RotationState`, and performs no I/O.
- It does not decide whether a plan is "active" or introduce a production
  runtime switch — this is a pure, in-memory, read-only projection.
- It does not implement commit/publish transactions, multi-period
  optimization, or backtracking. `isCommitEligible` is a flag a
  not-yet-built commit step could consult; this phase does not build that
  step.

## Module layout (`src/lib/duty-rules-v2/draft/`)

- `domain/draft-schedule.ts` — `CompleteDraftSchedule`, `DraftDay`,
  `DraftSlot`, `DraftAssignment`, `DraftGenerationManifest` contracts.
- `domain/draft-diagnostic.ts` — the stable `DraftDiagnosticCode`
  catalogue (19 codes) with ERROR/WARNING/INFO severity.
- `assemble-draft-slots.ts` — pure per-slot assembly: turns one
  `ResolvedSlot` + its `SelectionInput` + its `ProvisionalSlotSelection`
  into a `DraftSlot`, classifying `FILLED` / `UNDERFILLED` / `UNRESOLVED`
  / `UNSCHEDULED` and recording every structural inconsistency it
  observes (never silently tolerating or "fixing" one).
- `validate-draft-cross-slot.ts` — whole-schedule checks over the flat
  assignment list: duplicate assignment keys, same-pharmacy-same-day
  conflicts across different slots (only when
  `sameDaySecondAssignmentAllowed` is false), fallback-usage notes.
- `fingerprint-complete-draft.ts` — `computeCompleteDraftFingerprint`,
  the same `sha256Canonical`-over-canonical-serialization pattern used by
  `resultFingerprint` elsewhere in the engine.
- `build-complete-draft-schedule.ts` — the single entry point,
  `assembleCompleteDraftSchedule(result, options)`, which assembles days/
  slots/assignments, runs cross-slot validation, classifies the overall
  status, and computes the fingerprint + manifest.

## Slot status classification

| Status | Meaning |
|---|---|
| `FILLED` | `assignments.length === requiredCount` (or `requiredCount === 0`). |
| `UNDERFILLED` | Some but not enough (or zero, non-`unresolved`) candidates were selected — `requiredCount > 0`. |
| `UNRESOLVED` | The slot is resolvable (has a pool) but no strategy was configured, or the configured strategy chain could not resolve. |
| `UNSCHEDULED` | The slot has no pool at all (`ResolvedSlot.resolvable === false`) — nothing could ever have been assigned. |

## Overall draft status

- `INVALID` — at least one ERROR-severity diagnostic exists anywhere in
  the draft (a structural inconsistency between Phase 6's own output and
  what this module could assemble from it). `isCommitEligible` is always
  `false`.
- `PARTIAL` — no ERROR diagnostics, but at least one slot is
  `UNDERFILLED`, `UNRESOLVED`, or `UNSCHEDULED`.
- `COMPLETE` — every slot is `FILLED` and there are no ERROR diagnostics.
  `isCommitEligible` is `true` only in this case.

## Fingerprint and manifest

`completeDraftFingerprint` is a `sha256Canonical` hash over the whole
draft (days, assignments, counts, diagnostics, status) minus the
fingerprint and manifest fields themselves. `DraftGenerationManifest`
anchors provenance via `sourceResultFingerprint` — the Phase 4-6
`DutyEngineDraftResult.resultFingerprint` this draft was assembled from —
plus a copy of `EngineRunProvenance` and a validation summary
(error/warning/info counts).

## Integration point

`buildDutyEngineContext` (`engine/build-engine-context.ts`) calls
`buildDraftResult(...)` exactly as before Phase 7, then additively calls
`assembleCompleteDraftSchedule(preDraftResult, { sameDaySecondAssignmentAllowed: input.policy.sameDaySecondAssignmentAllowed })`
and spreads the three new fields onto the returned object. No stage
logic lives in the orchestrator; assembly/validation logic lives entirely
in `draft/`.

## Deferred (explicitly out of scope for this phase)

Persistence of any kind, a commit/publish transaction, UI surfaces,
public-page publication, Excel/PDF export of the draft, multi-period
optimization, backtracking/global search, and any AI-generated logic.
`isCommitEligible` is a forward-looking signal only — no code in this
repository currently reads it to gate a write.
