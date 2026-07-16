# Duty Rules V2 — Phase 4: Scheduling Engine Domain Architecture

Branch `feature/duty-rules-v2-engine-domain`. The **pure domain
architecture** of the V2 scheduling engine: a staged pipeline that turns
a validated `LoadedDutyPlanVersion` plus fully explicit runtime inputs
into a deterministic, inspectable **scheduling context** — every
calendar fact, day type, shift, slot, pool, candidate, eligibility
verdict, fairness fact, and rotation fact a selection engine needs, with
diagnostics explaining every inclusion, exclusion, and unresolved slot.

**No winner is selected, no schedule or assignment is written, no plan is
activated, nothing calls Prisma, and no production code calls any of
it.** V1 (`generate-duty-schedule.ts`, `DutyRule`, `/kurallar`) remains
the production source of truth, byte-untouched. No chamber, city,
province, or district is hardcoded anywhere.

## Pipeline (each stage: typed input → typed output, pure, tested)

| Stage | Module (`src/lib/duty-rules-v2/engine/`) | Output |
|---|---|---|
| Runtime input + validation | `domain/engine-input.ts` | `DutyEngineInput` (typed errors) |
| 1 Calendar context | `resolve-calendar-context.ts` | `CalendarDayContext[]` |
| 2 Day type | `resolve-day-type.ts` | `ResolvedDayType` |
| 3 Shifts | `resolve-shifts.ts` | `ResolvedShift[]` |
| 4 Slots | `resolve-slots.ts` | `ResolvedSlot[]` |
| 5 Pool | `resolve-pool.ts` | `ResolvedPool` (reuses `resolvePoolMembershipAsOf`) |
| 6 Candidates | `resolve-candidates.ts` | `SlotCandidate[]` + `indexRuntimeFacts` |
| 7a Constraints | `evaluate-constraints.ts` + `domain/constraint.ts` | `ConstraintResult[]` |
| 7b Eligibility | `evaluate-eligibility.ts` | `CandidateEligibilityResult` |
| 8 Fairness facts | `calculate-fairness-facts.ts` | `CandidateFairnessFacts` |
| 9 Rotation facts | `resolve-rotation-facts.ts` | `CandidateRotationFacts` |
| 10 Relaxation | `apply-eligibility-relaxation.ts` | `EligibilityRelaxationResult` |
| 11 Selection input | `build-selection-input.ts` | `SelectionInput` (+ provenance) |
| 12 Draft result | `build-draft-result.ts` | `DutyEngineDraftResult` |
| Orchestrator | `build-engine-context.ts` | `buildDutyEngineContext(input)` |

Dependency direction: every stage depends only on `domain/*`, earlier
stage outputs, and Phase 3's pure `resolve-pool-membership` — never on
Prisma, the loader service, the clock, or ambient state. The orchestrator
composes; it contains no stage logic. Diagnostics come from a stable
catalogue (`domain/diagnostics.ts`); codes are the program contract,
Turkish messages belong to a later presentation layer.

## Runtime input contract

`DutyEngineInput`: `loadedPlan`, explicit `organizationId`/`regionId`
(consistency assertions against the plan — never a scoping source),
`periodStart`/`periodEnd` (max 366 days), `generationMode`
(PREVIEW | SIMULATION), explicit `policy`, and plain arrays: holidays,
custom day-category overrides, unavailability windows, duty requests,
historical duties, balance adjustments, existing assignments. All dates
are `YYYY-MM-DD` strings; no Prisma models, Date objects, timestamps,
DB handles, or session objects. Validation throws typed
`DutyEngineError` (`INVALID_INPUT`, `INVALID_PERIOD`,
`ORGANIZATION_MISMATCH`, `REGION_MISMATCH`, `FOREIGN_PHARMACY` — every
runtime pharmacyId must exist in the plan's temporal membership
universe, `DUPLICATE_RUNTIME_RECORD`, `UNKNOWN_DAY_TYPE_WEIGHT`).

**Explicit policy** (`EngineSchedulingPolicy`): `minDaysBetweenDuties`,
`relaxMinIntervalWhenInsufficient`, `dayTypeWeights` (per day-type key —
a served day type with no weight is a typed error, never a silent 1),
`sameDaySecondAssignmentAllowed`. The Phase 1 schema deliberately
persists no weights/interval, so in compatibility mode these derive from
the region's `DutyRule` via the Phase 2 adapter; a later phase may move
them into persisted configuration.

## Calendar precedence and day-type resolution

Stage 1 produces facts only (weekday number/name, Saturday/Sunday flags,
all matching holidays sorted (type, name), eve flag — true when the
following day has any holiday, even outside the period — and the
candidate built-in day types, strongest first). `Holiday.type OTHER`
maps to `OFFICIAL_HOLIDAY`, V1's documented weighting rule.

Stage 2 selects deterministically:

1. explicit custom category override (exactly one plan rule with that
   category; zero → `UNKNOWN_CUSTOM_DAY_CATEGORY`, several →
   `AMBIGUOUS_DAY_TYPE`; both are controlled unresolved results)
2. RELIGIOUS_HOLIDAY 3. OFFICIAL_HOLIDAY 4. HOLIDAY_EVE 5. SUNDAY
6. SATURDAY 7. WEEKDAY

The result carries the matched rule id/key, served flag (`UNSERVED_DAY`
diagnostic when false — an explicit "no duty" decision), and the
evaluated precedence trail. Unresolvable dates return
`resolved: false` — never a silent guess.

**Documented V1-compatibility boundary:** V1 does not distinguish
holiday eves (weights an eve as its underlying calendar day). Because
rank 4 selects `HOLIDAY_EVE` for pre-holiday dates, exact V1 weight
parity on eve dates is a **Phase 5 compatibility-mode responsibility**:
`CalendarDayContext` deliberately preserves the full underlying facts
(Saturday/Sunday/holiday flags) so compatibility weighting can be
derived from the calendar context rather than the resolved day type.
Slot expansion is unaffected for V1-adapted plans (all six day types
carry identical slots).

## Shifts, slots, pools, candidates

- **Shifts** (Stage 3): all shifts referenced by the day type's slots,
  ordered (sortOrder, name, id). Never one-shift-per-date. No fabricated
  times: the persisted 0/0/false convention for the synthetic V1 shift is
  surfaced as `null/null/null`; overnight shifts keep `spansMidnight`.
- **Slots** (Stage 4): stable, row-id-independent key
  `{date}:{dayTypeKey}:{shiftKey}:{sortOrder}`; multiple slots per shift
  and `requiredCount > 1` pass through; slots are never collapsed; a null
  pool stays explicit (`SLOT_WITHOUT_POOL`, `resolvable: false`) — no
  default pool is invented. Unserved/unresolved dates expand zero slots.
- **Pools** (Stage 5): reuses `resolvePoolMembershipAsOf` (joinedOn
  inclusive, leftOn exclusive — defined once in Phase 3). Diagnostics:
  `EMPTY_POOL`, `NO_ACTIVE_MEMBERS`. Tenant/region mismatches CANNOT
  reach the engine — the loader fails the whole load first; they are
  never membership exclusions.
- **Candidates** (Stage 6): one per relevant membership row — active
  members AND snapshot-excluded rows, so every exclusion is explainable.
  Facts only (membership status, unavailability on date, blocking
  request type, prefer flag, historical aggregates, balance total,
  period assignments ≤ date, last duty date, days since) — no
  eligibility decision. Deterministic key `{slotKey}#{membershipId}`.
  Only APPROVED requests have effects (V1 rule); SWAP_REQUEST has none.

## Constraints and eligibility

`domain/constraint.ts` defines severities HARD / SOFT / ADVISORY and the
structured result (code, severity, candidate, date, slot, passed,
observed/expected values, explanation code). Compatibility constraints
implemented (all HARD): `PHARMACY_ACTIVE`, `MEMBER_AS_OF_DATE`,
`NOT_UNAVAILABLE`, `NO_BLOCKING_DUTY_REQUEST`,
`MIN_DAYS_BETWEEN_DUTIES` (never-served passes — V1 rule),
`SAME_SLOT_DUPLICATE`, and `DAILY_ASSIGNMENT_LIMIT` only when the
explicit policy disallows same-day seconds. No chamber-specific,
geographic, or tradition rules.

Eligibility (Stage 7b) derives verdicts FROM constraint results (single
source, no duplicated rules): `eligible` = all HARD passed; failed
constraints map to stable reasons (`PHARMACY_INACTIVE`, `NOT_A_MEMBER`,
`UNAVAILABLE`, `CANNOT_DUTY_REQUEST`, `EMERGENCY_EXCUSE`,
`MIN_DAYS_INTERVAL`, `DUPLICATE_SLOT_ASSIGNMENT`,
`SAME_DAY_ASSIGNMENT_CONFLICT`); ALL reasons are retained. Interval
failure is a reason here — relaxation happens only in Stage 10.
PREFER_DUTY is a fairness fact, never eligibility.

## Minimum-day relaxation (V1's exact limited semantics)

`applyEligibilityRelaxation`: strict first; only when
`strictEligible < requiredCount` AND the policy allows, candidates whose
ONLY hard failure is `MIN_DAYS_INTERVAL` become `relaxedEligible` —
inactive/non-member/unavailable/blocking/duplicate exclusions are never
relaxed, and nothing is generalized to arbitrary constraint relaxation.
Diagnostics: `INSUFFICIENT_STRICT_CANDIDATES`, `MIN_INTERVAL_RELAXED`,
`INSUFFICIENT_CANDIDATES_AFTER_RELAXATION`. Mirrors
`generate-duty-schedule.ts:266-269` exactly.

## Fairness facts (immutable, per candidate)

`dateWeight` = policy day-type weight × shift `defaultWeight`. Sources
documented per field: historical load/count/weekend aggregate from
persisted history; balance from adjustments; current-period load from
existing assignments; `totalWeightedLoad` = history + balance + period
(V1's `totalLoadScore` seeding expressed as facts);
`projectedLoadIfAssigned`; weekend count = history aggregate + period;
Sunday/holiday counts = period only (V1 starts holiday counts at zero
and tracks no separate Sunday counter — mirrored exactly); last duty
date and interval; `prefersThisDate`; `nameTieBreakValue` (the pharmacy
name V1's final `localeCompare(name, "tr")` tie-break uses). No winner
selection, no running-state mutation.

## Rotation facts (per candidate, no mutation)

State scope: exact day-type-key match wins, else `"ALL"`, else null.
Facts: `currentRound`, cursor membership + `isCursor`, `sortIndex`,
`manualOrderPosition` (position in the snapshot's deterministic active
ordering), `distanceFromCursor` (wrap-around steps after the cursor;
cursor itself = pool size), carried-forward entries for the membership
(persisted queue order). Supports SEQUENTIAL / FAIRNESS_SCORE /
WEIGHTED / MANUAL_ORDER; strategy-specific FINAL comparison is
deliberately deferred to Phase 5 — the facts are complete. Nothing
advances the cursor or touches `RotationState`/`carriedForward`.

## SelectionInput and snapshot provenance (mandatory)

Per date/slot: slot, requiredCount, strategy, candidates + eligibility +
fairness + rotation facts (all sorted by candidateKey), relaxation
result, diagnostics, and `SelectionProvenance`:

- `configurationFingerprint` (loader),
- `membershipSnapshotHash` — sha256 over the resolved as-of snapshot
  INCLUDING pharmacy active flags and exclusion reasons (the
  runtime-sensitive complement; the configuration fingerprint alone is
  explicitly NOT sufficient because active state is excluded from it),
- `effectiveDate`, run-level `runtimeInputHash` (canonical hash of all
  runtime arrays, order-insensitive, + policy + period + mode),
- `loaderVersion`, `engineVersion`.

## Draft result

`DutyEngineDraftResult`: per-day contexts (calendar, day type, shifts,
slots), all SelectionInputs, counts (dates, resolved, served, slots,
resolvable, candidates, strict/relaxed eligible), explicit
`unresolvedSlots` (`SLOT_WITHOUT_POOL`,
`INSUFFICIENT_CANDIDATES_AFTER_RELAXATION`), sorted warnings, run
provenance, and `resultFingerprint` = sha256 over the canonical
serialization of everything else. Results may be incomplete —
incompleteness is explicit, never hidden. No DutySchedule/DutyAssignment
models appear anywhere.

## Determinism

Every array is explicitly sorted (dates ascending; holidays by
type/name; shifts by sortOrder/name/id; slots by sortOrder/shiftKey/id;
candidates and all per-candidate arrays by candidateKey; diagnostics by
date/code/subject; runtime arrays canonicalized order-insensitively
inside the input hash). No insertion-order, row-order, clock, locale,
random, timezone, or filesystem dependence; identifiers use code-point
comparison only — Turkish locale comparison appears solely as the
PRESERVED V1 tie-break VALUE (`nameTieBreakValue`), for Phase 5 to use.
Proven: shuffled equivalent input → byte-identical output ×3; input
objects never mutated; audit-only differences don't change the result
fingerprint.

## Phase 4 / Phase 5 boundary

Phase 4 ends at `SelectionInput` + draft context. Phase 5 implements
selection strategies: consuming eligible/relaxed candidate sets in
strategy order (FAIRNESS_SCORE reproducing V1's 7-step tie-break from
the provided fairness facts; SEQUENTIAL/MANUAL_ORDER from rotation
facts; WEIGHTED from both), producing draft assignments, advancing
rotation state THROUGH the future write service (optimistic
`lockVersion`), and recording run provenance with committed schedules.
Compatibility-mode weight resolution for eve dates (see above) also
lands there, alongside the golden V1-parity harness (V1 engine vs. V2
selection, byte-equality).

## Current limitations

- No selection, no writes, no activation — by scope.
- Eve-date weight parity in compatibility mode is a documented Phase 5
  item (facts are preserved for it).
- Policy (weights/interval) is runtime input, not persisted
  configuration, until a dedicated schema phase.
- Historical Sunday/holiday per-date detail is aggregated exactly as V1
  aggregates it (weekend count only) — no invented richer history.

## Backlog isolation

The twelve known backlog items (XLSX "22" cells, import/edit address
mismatch, browser freeze, DutyAssignment index redundancy, membership
cascade tightening, requiredCount CHECK, DB cross-tenant enforcement,
EMERGENCY_EXCUSE fixture promotion, canonicalSerialize undefined guard,
UNKNOWN_DAY_TYPE loader code, loader no-write field coverage,
UTC-midnight write-service requirement) are all untouched here.

## Confirmations

No chamber/city/province/district hardcoded (all fixtures synthetic);
V1 remains the production source of truth; zero production call sites;
zero database access in `engine/` (test-support fixtures are test-only);
the single integration test only READS a persisted plan through the
Phase 3 loader and asserts no row changed.

## Phase 5 pointer

The configurable Rule Engine
(`docs/architecture/DUTY_RULES_V2_CONFIGURABLE_RULE_ENGINE.md`) plugs
into this pipeline between candidate facts and eligibility: configured
catalogue rules produce normalized `CONFIGURED_RULE` constraint results,
`SelectionInput` gains `ruleEvaluations`, and provenance gains
`ruleSetFingerprint`. An empty rule set leaves this pipeline's behavior
byte-identical.

## Phase 6 pointer

The configurable Selection Strategy Engine
(`docs/architecture/DUTY_RULES_V2_SELECTION_STRATEGY_ENGINE.md`) plugs
in after Phase 5, ordering the already-resolved strict/relaxed candidate
set: `DutyEngineInput` gains `configuredSelectionStrategies`,
`DutyEngineDraftResult` gains `provisionalSelections` /
`strategyConflicts` / `selectionExplanations` / `selectionCounts`, and
provenance gains `strategySetFingerprint` + `selectionEngineVersion`. An
empty or omitted strategy set leaves this pipeline's behavior
byte-identical — selection remains in-memory-only, with no
schedule/assignment writes and no `RotationState` mutation.
