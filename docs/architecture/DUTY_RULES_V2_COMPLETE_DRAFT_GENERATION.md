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
| `validate-draft-eligibility-origin.ts` | `DRAFT_CANDIDATE_NOT_IN_STRICT_OR_RELAXED`, `DRAFT_ORIGIN_MISMATCH`, `DRAFT_STRATEGY_MISMATCH`, `DRAFT_SELECTED_RANK_MISMATCH`, `DRAFT_SLOT_DATE_MISMATCH` |
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

## Full-period V1 equivalence — the 32-scenario golden harness

`v1-golden-equivalence.test.ts`'s "Phase 7 — full-period Complete Draft
Schedule equivalence (32-scenario matrix)" block reuses the SAME
unmodified Path A / Path B harness already used for the Phase 6 per-slot
comparisons:

- **Path A**: the actual, unmodified `generate-duty-schedule.ts`.
- **Path B**: Phase 2 (`adaptV1RuleToV2Config`, unmodified) → a
  `LoadedDutyPlanVersion` fixture shaped exactly like the Phase 3
  loader's output → the actual production `buildDutyEngineContext`
  (Phase 4/5/6, unmodified) with `buildCompatibilityRules(policy)`
  (Phase 5) and `buildV1CompatibilitySelectionStrategy` (Phase 6),
  which now additively produces `completeDraftSchedule` (Phase 7).

Neither path is ever reproduced or copied into a test helper — every
expected value in `assertFullPhase7Equivalence` is read from that run's
own live V1 output.

**Comparison fields**, asserted for every scenario: period start/end;
assignment dates; assignment order (`selectionOrdinal`); selected
pharmacy ids; daily selected counts; total selected count; required/
missing assignment count (re-derived and cross-checked, not trusted);
duty weights; underfilled dates; unresolved slots (asserted empty — a
real V1-compatibility run always has a strategy configured); no
ERROR-severity diagnostic; `STRICT`/`RELAXED` origin (well-formed and
internally consistent — see the open gap below for the one case where
origin choice itself, not merely its consistency, diverges);
`COMPLETE`/`PARTIAL` status; `isCommitEligible`; canonical assignment
tuples `(date, slotKey, selectionOrdinal, pharmacyId, membershipId,
origin, dutyWeight)`, checked for uniqueness of `draftAssignmentKey`;
`completeDraftFingerprint` (hex-shape and cross-checked against
`draft.completeDraftFingerprint`/`manifest.completeDraftFingerprint`);
manifest presence/equality. Full fingerprint/manifest determinism under
repeated execution is additionally checked by scenario 32, which
rebuilds the whole run three times and asserts a single distinct
fingerprint and a single distinct canonical manifest serialization.

**The 32-scenario matrix** (all passing): 1. dailyDutyCount=1;
2. dailyDutyCount=3; 3. multi-date period (explicit period-bound check);
4. normal weekday; 5. Saturday; 6. Sunday; 7. official holiday;
8. religious holiday; 9. OTHER holiday; 10. weekday holiday eve;
11. Saturday holiday eve; 12. Sunday holiday eve; 13. OFFICIAL→RELIGIOUS
overlap; 14. RELIGIOUS→OFFICIAL overlap; 15. three overlapping holiday
records; 16. duplicate holiday records; 17. unavailability; 18. approved
CANNOT_DUTY; 19. approved EMERGENCY_EXCUSE; 20. approved PREFER_DUTY;
21. inactive pharmacy; 22. historical weighted load; 23. historical
last-duty interval (see open gap below); 24. balance adjustment;
25. minimum-day relaxation; 26. underfill; 27. Turkish-name tie;
28. exact deterministic tie; 29. sequential multi-date load changes;
30. dailyDutyCount=3 with mixed strict/relaxed candidates; 31. same-day
multiple slots (documented contract boundary — see below); 32. repeated
complete-period execution ×3. Plus one additional no-strategy full-period
case. **70 tests total** in the file (38 Phase 6 scenarios + 32 Phase 7
scenarios), run and passing twice consecutively.

### Scenario 31 — documented contract boundary (not a gap, a structural fact)

V1's own model has exactly ONE shift per day with `dailyDutyCount`
concurrent seats on that single shift — it has no concept of multiple
DISTINCT shifts/slots on the same date. `adaptV1RuleToV2Config` (Phase 2)
therefore always produces exactly one `ShiftDefinition`/
`SlotRequirement` per served day type, and there is no V1 output to
compare a genuine multi-shift scenario against. A true "multiple
distinct shifts on one date" scenario already exists directly against
the production Phase 6 engine (`multi-slot-sequential-regression.test.ts`,
which bypasses the V1-compatibility adapter entirely) — it is simply not
representable *through this V1-comparison harness*. Scenario 31 asserts
the boundary itself (exactly one slot per date in the adapted fixture)
rather than silently omitting the requested scenario.

### Scenario 23 — KNOWN OPEN GAP (newly discovered, unresolved)

Extending the historical-interval scenario's per-date assertion to the
FULL period (rather than just the two dates the pre-existing Phase 6
test checked) surfaces a genuine, previously-undetected V1/V2
divergence: with `minDaysBetweenDuties=5` and a single historical duty
predating the period, by day 3 of the period EVERY candidate has fallen
within the interval window simultaneously, forcing V1's relaxation path
for all three. At that exact point, V1's own comparator chain (steps
1-5 tied 3-way) falls through to step 6, `lastDutyDate` ascending, and
picks the pharmacy whose last duty is oldest. V2's relaxed-candidate
ranking picks a **different** pharmacy at that same point — the
divergence traces to how the sequential accumulator resolves
`lastDutyDate` for a candidate whose most recent duty predates the
period (pure historical fact, never touched by the accumulator) versus
one whose most recent duty is *this run's own* earlier assignment (an
asymmetry no previously-committed scenario exercised, because the prior
harness never asserted equivalence past the first two dates of any
interval-relaxation fixture). **This is not fixed in this delivery** —
it requires a dedicated Phase 4/6 investigation into
`apply-sequential-selection-state.ts`'s fairness-fact folding for
historical-only vs. in-run `lastDutyDate` under simultaneous 3-way
relaxation, which is out of Phase 7's own scope and risks destabilizing
already-reviewed, previously-approved Phase 6 code if attempted under
time pressure. Scenario 23's per-date assertion is therefore
deliberately scoped to the two dates known to hold, WITH this comment
inline in the test — filed honestly rather than silently omitted or
hidden by narrowing without explanation.

## Integration point

`buildDutyEngineContext` (`engine/build-engine-context.ts`) calls
`buildDraftResult(...)` exactly as before Phase 7, then additively calls
`assembleCompleteDraftSchedule(preDraftResult, { sameDaySecondAssignmentAllowed: input.policy.sameDaySecondAssignmentAllowed })`
and spreads the three new fields onto the returned object. No stage
logic lives in the orchestrator; assembly/validation logic lives entirely
in `draft/`.

## Persisted-plan read-only integration architecture

`tests/integration/duty-rules-v2-draft-generation.integration.test.ts`
(real Postgres, `npm run test:integration`) exercises the full
`persisted organization → region → DutyPlan → DutyPlanVersion → day
types/shifts/slots/pool/memberships → an explicit persisted
RotationState row → Phase 3 loader (`loadDutyPlanVersion`) → Phase 4-7
(`buildDutyEngineContext`)` path against a real database. Rules and
selection strategies are supplied as explicit in-memory input
(`buildCompatibilityRules` / `buildV1CompatibilitySelectionStrategy`) —
Phase 5/6 configuration persistence does not exist yet in this
repository, so this is a pre-existing platform limitation, not a gap
introduced by Phase 7.

**Snapshot-before/assert-after pattern** (`snapshotDbState` +
`expectDbUnchanged`): before and after each `buildDutyEngineContext`
call, the test independently re-queries (never trusts a cached count)
`DutySchedule`/`DutyAssignment`/`DutyPlanVersion`/`RotationState`/
`RotationPoolMembership` row counts, the full `DutyPlanVersion` row
(`updatedAt`, `status`), the full `RotationState` row set for the pool
(field-by-field: `currentRound`, `lockVersion`,
`lastServedMembershipId`, `carriedForward`), and the full
`RotationPoolMembership` row set — then asserts byte-identical
canonical serialization before vs. after. Cleanup uses `deleteMany`
scoped to `{ id: { in: trackedIds } }` (tracked-id lists built during
fixture setup), never an unscoped `deleteMany` — verified by re-running
the test twice consecutively and confirming the pre-existing (unrelated,
prior-session) row count in the shared test database is unchanged by
either run.

**Two committed tests**:
1. "Phase 7: builds a deterministic Complete Draft Schedule twice from a
   persisted plan, writes nothing" — asserts byte-identical repeated
   execution (`canonicalSerialize` equality including
   `completeDraftSchedule`/`completeDraftFingerprint`/`draftManifest`),
   every provenance hash present and cross-consistent between
   `draftManifest.provenance` and `result.provenance`,
   `sourceResultFingerprint === result.resultFingerprint`, a `COMPLETE`/
   commit-eligible draft, and `expectDbUnchanged`.
2. "Phase 7 no-strategy: zero assignments, PARTIAL,
   DRAFT_NO_SELECTION_STRATEGY, unchanged DB, run twice" — the no-
   strategy contract against a real persisted plan: zero
   `provisionalSelections`, all 7 required slots still explicitly
   represented (`counts.totalSlots === 7`, never dropped), `PARTIAL`
   status, `isCommitEligible === false`,
   `manifest.unresolvedSlotKeys.length === 7`, every slot's diagnostics
   containing `DRAFT_NO_SELECTION_STRATEGY`, deterministic fingerprint/
   manifest across two builds, and `expectDbUnchanged`.

Both tests pass, run twice consecutively (see verification results
below); the full pre-existing integration suite (20 files, 96 tests)
was also re-run afterward with no regressions.

## Purity/security boundaries (verified)

Zero Prisma/raw-SQL/write-method/filesystem/network/`process.env`/
`Date.now`/`Math.random`/`randomUUID`/console-logging/ranking-or-
comparator imports anywhere under `draft/` (runtime modules only — test
files are excluded from the scan by design, e.g. `no-reranking.test.ts`
reads its own sibling `.ts` sources to prove the no-ranking-import
invariant, and the new integration test legitimately imports `prisma`
to read-only-verify no write occurred). No production route/action/page
imports anything from `draft/`. No `RotationState`/`currentRound`/
`lockVersion`/`carriedForward` read or write anywhere in `draft/`. No
`DutySchedule`/`DutyAssignment` write anywhere touched by this delivery.
No chamber/city/province hardcoding (spot-checked against known Turkish
province names). The repository's own tenant-safety scanner
(`scripts/tenant-safety/scan-unscoped-queries.test.ts`, part of `npm test`)
passes, confirming no unscoped Prisma call was introduced.

## Deferred (explicitly out of scope for this phase)

Persistence of any kind, a commit/publish transaction, UI surfaces,
public-page publication, Excel/PDF export of the draft, multi-period
optimization, backtracking/global search, any AI-generated logic.
`isCommitEligible` is a forward-looking signal only — no code in this
repository currently reads it to gate a write.

## Resolved gap: sequential-relaxation-contract corrective (PR #11)

The V1/V2 relaxed-candidate divergence previously documented here —
occurring once `minDaysBetweenDuties` simultaneously excludes every
candidate in a pool from strict eligibility — was root-caused and fixed
by PR #11 (`fix/duty-rules-v2-sequential-relaxation-contract`, commit
`29b32f8`), merged into `deploy/postgresql-demo` and brought into this
branch. The defect: Phase 4's `applyEligibilityRelaxation` computed
`relaxedEligible` only from its own static, single-slot evaluation, with
no visibility into candidates Phase 6's sequential accumulator would
later demote out of strict within the same run. The fix extracts a
shared `isRelaxAdmissible` predicate (`engine/apply-eligibility-
relaxation.ts`) used identically by Phase 4 and by a new widening step in
`resolveSequentialCandidateSet` (`selection/apply-sequential-selection-
state.ts`), which re-derives the admissible relaxed pool from current
in-run state when the accumulator-adjusted strict count drops below
`requiredCount`.

Bringing PR #11 into this branch also surfaced a second, Phase-7-local
integration bug in `draft/assemble-draft-slots.ts`: assignment origin was
computed by checking a candidate against Phase 4's static
`strictEligible`/`relaxedEligible` sets FIRST, falling back to Phase 6's
authoritative `rankFacts.origin` only when the candidate was in neither
set. Once a Phase-4-static-strict candidate is later demoted by Phase
6's sequential accumulator but still admitted into the widened RELAXED
pool, the static sets still (stale) reported it as strict, so the
assembled `DraftAssignment.origin` was silently mislabeled `STRICT`.
Fixed by always sourcing `origin` from `ranking.rankFacts.origin` — the
single authoritative, sequential-widening-aware fact Phase 6 already
computes — and by updating `draft/validate-draft-eligibility-origin.ts`
to independently re-check against that same authoritative source instead
of the stale static sets. `v1-golden-equivalence.test.ts` scenario 23
("historical last-duty interval carries into the period") now asserts
full-period equivalence (previously narrowed to 2026-09-01/09-02) with
explicit checks that both V1 and V2 select `ph-a` on 2026-09-03 with
origin `RELAXED`.
