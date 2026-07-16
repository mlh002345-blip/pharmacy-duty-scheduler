# Duty Rules V2 — Phase 6: Configurable Selection Strategy Engine

Branch `feature/duty-rules-v2-selection-strategy-engine`. A **safe,
versioned, deterministic, chamber-configurable** selection-strategy
engine (`src/lib/duty-rules-v2/selection/`) that turns candidates already
narrowed by Phase 4 (eligibility) and Phase 5 (configured rules) into a
**provisional, in-memory-only, per-slot ranking and winner selection**,
integrated ADDITIVELY into the Phase 4 pipeline. **No schedule/assignment
writes, no RotationState advancement, no strategy persistence, no UI, no
plan activation, no production runtime switch.** V1 remains the
production source of truth, byte-untouched; no chamber, city, province,
district, or local tradition is hardcoded.

## Product responsibility boundary

The Rule Engine (Phase 5) answers: *"May this candidate be selected, and
what rule findings apply?"* The Selection Strategy Engine (this phase)
answers: *"Among the remaining candidates, which candidate or candidates
should be selected, in what order, and why?"* This module never
re-evaluates eligibility or rule outcomes — it only reshapes and orders
facts Phase 4/5 already computed.

**The chamber configures** (data only): which platform strategy type,
its bounded typed parameters, priority, scope, an ordered tie-breaker
chain from a closed catalogue, an ordered fallback-strategy-id chain,
effective dates.

**The platform defines** (code only): the strategy-type catalogue,
strict parameter schemas, the ranking-criterion catalogue, the single
comparator registry, validation, conflict detection, fallback semantics,
diagnostics, explanation codes, and every security boundary.

**Chambers can never configure**: a callback, an arbitrary comparator
function, an expression, SQL, JavaScript, a dynamic import, or an
external plugin. Every definition is a strict Zod shape. The strategy
type is resolved through `resolveCriterionSequence(parameters,
candidates, matchContext) => RankingCriterion[] | null` — an ORDERED
LIST of platform-defined criterion codes, never a function value —
which the single `compareByCriterion` registry then executes. **RANDOMIZED
is explicitly prohibited**: it is never registered in the catalogue, and
any definition referencing it (or its known aliases `RANDOM`,
`RANDOM_ORDER`) is rejected with a dedicated `RANDOM_STRATEGY_REJECTED`
code before generic unknown-type handling.

## Architecture (staged pure-function pipeline)

SelectionInput (Phase 4/5) → Strategy Set Validation/Conflict Gating →
Candidate Set Resolution → Candidate Ranking Facts (incl. bounded SOFT
projection) → Applicable-Strategy/Primary Resolution → Comparator Chain
→ Fallback Chain → Provisional Selection → Explanation → Provenance.

| Module | Role |
|---|---|
| `domain/strategy-definition.ts` | `ConfiguredSelectionStrategy` (sources incl. `COMPATIBILITY_V1`) |
| `domain/strategy-context.ts` | `StrategyScope` (13 dimensions, AND semantics) + `StrategyMatchContext` |
| `domain/ranking-fact.ts` | `RANKING_CRITERIA` (18 codes), `TIE_BREAKER_CODES` (13), `CandidateRankingFacts` |
| `domain/strategy-catalogue.ts` | `StrategyCatalogueEntry` contract, incl. `resolveCriterionSequence` + optional `computeWeightedScore` |
| `domain/strategy-conflict.ts` | typed conflicts, ERROR/WARNING/INFO |
| `domain/selection-diagnostic.ts` / `domain/selection-result.ts` | diagnostics, `ComparatorStep`, `CandidateRanking`, `ProvisionalSlotSelection` |
| `domain/strategy-parameters.ts` | bounded primitives (`STRATEGY_LIMITS`) |
| `catalogue/*` | the 6 initial strategy types + `V1_COMPATIBILITY_CHAIN` |
| `validate-strategy-definition.ts` | per-definition validation |
| `match-strategy-scope.ts` | scope/effective-period matchers |
| `build-strategy-context.ts` | Phase 4/5 facts → `CandidateRankingFacts` + `StrategyMatchContext` |
| `resolve-candidate-set.ts` | strict∪relaxed candidate-set policy (from Phase 4's `EligibilityRelaxationResult` only) |
| `compare-candidates.ts` | the single comparator registry (`compareByCriterion`) |
| `rank-candidates.ts` | comparator-chain composition + deterministic ranking + trace |
| `apply-fallback-chain.ts` | primary resolution + controlled fallback walk (cycle-guarded) |
| `select-provisional-winners.ts` | the per-slot entry point |
| `analyze-strategy-conflicts.ts` | static conflict analysis |
| `canonicalize-strategy-set.ts` | canonical form + `strategySetFingerprint` |
| `build-selection-explanations.ts` | code-based explanations + `provisionalSelectionFingerprint` |
| `build-v1-compatibility-strategy.ts` | opt-in V1-compatibility strategy projection (mirrors Phase 5's `buildCompatibilityRules`) |
| `strategy-errors.ts` | `SelectionEngineError` |

## Initial strategy catalogue (6 + 1 compatibility entry)

| Strategy | Summary |
|---|---|
| `FAIRNESS_LEAST_LOAD` | Always starts `TOTAL_WEIGHTED_LOAD_ASC`; optional boolean-gated projected load / assignment count / weekend / holiday / last-duty-date steps. Never returns null. |
| `WEIGHTED_FAIRNESS` | Bounded chamber weights (`[-1000,1000]`) over always-present facts, linearly combined into `WEIGHTED_SCORE_ASC`. Never-served candidates use a fixed sentinel (100000 "days"), never random/clock-derived. Per-rule-type SOFT penalty via a bounded `softRulePenaltyWeights` map (≤50 entries) multiplying the flat `softFailuresByRuleType` fact — a controlled mapping, never an arbitrary formula. |
| `SEQUENTIAL_ROTATION` | Rotation-cursor ordering (`ROTATION_DISTANCE_ASC`, `CURRENT_ROUND_ASC`, `MEMBERSHIP_SORT_INDEX_ASC`, `MANUAL_ORDER_ASC`, optional carried-forward priority). Returns null (triggers fallback) only when a NON-EMPTY candidate set has no rotation facts anywhere. |
| `MANUAL_ORDER` | Pure `MEMBERSHIP_SORT_INDEX_ASC, MANUAL_ORDER_ASC`. Returns null when no candidate carries manual/sort data. |
| `LEXICOGRAPHIC_CHAIN` | Chamber-ordered chain from a restricted 14-item allowed subset of `RANKING_CRITERIA` (excludes `WEIGHTED_SCORE_ASC`, `CANDIDATE_KEY_ASC`, and rotation-cursor-only codes). |
| `HYBRID_ROTATION_FAIRNESS` | Two-stage: rotation stage (skipped, not degraded, when no rotation facts exist) then fairness stage; at least one stage must be enabled. |
| `V1_COMPATIBILITY_CHAIN` | Platform-owned, NOT chamber-invented; reproduces V1's exact 7-step chain including its date-CONDITIONAL weekend/holiday inclusion (see below). Opt-in only via `build-v1-compatibility-strategy.ts`; never auto-injected. |
| **RANDOMIZED** | **Explicitly prohibited. Never implemented, never registered, rejected with a dedicated code.** |

## Ranking-criterion catalogue and null ordering

18 platform-defined `RANKING_CRITERIA` codes. Deterministic null ordering
per criterion (never left ambiguous):

- `LAST_DUTY_DATE_ASC`, `DAYS_SINCE_LAST_DUTY_DESC`: **null-first**
  (never-served ranks best — matches V1's `if (!lastDutyDate) return
  -1`).
- `ROTATION_DISTANCE_ASC`, `CURRENT_ROUND_ASC`,
  `MEMBERSHIP_SORT_INDEX_ASC`, `MANUAL_ORDER_ASC`: **null-last** (matches
  Phase 3/4's "sortIndex asc, nulls last" convention).

Only `PHARMACY_NAME_TR_ASC` uses `localeCompare(name, "tr")`; every other
criterion uses numeric or code-point comparison — no other locale
dependency exists anywhere in the comparator registry.

`CANDIDATE_KEY_ASC` is the **mandatory, non-configurable final fallback**
unconditionally appended by the platform to every comparator chain
(`rank-candidates.ts`). Since `candidateKey` is `${slotKey}#${membershipId}`
(globally unique), this guarantees a strict total order, so the resulting
selection is fully deterministic regardless of input array order or JS
engine sort stability — no configuration can ever leave a genuine tie
unresolved. (`MISSING_DETERMINISTIC_FINAL_FALLBACK_UNREACHABLE` is
defined in the conflict-code catalogue for documentation completeness but
is structurally unreachable and never emitted.)

## Candidate-set resolution policy

Sourced **exclusively** from Phase 4's already-computed
`EligibilityRelaxationResult`: `strictEligible` alone when it already
meets `requiredCount`, otherwise `strictEligible ∪ relaxedEligible` when
Phase 4 applied relaxation. This module never re-evaluates eligibility
and cannot resurrect a hard-excluded candidate by construction — there is
no code path that adds a candidate outside those two arrays.

## SOFT-rule treatment

A bounded, flat fact projection — never an automatic uniform penalty and
never an arbitrary formula: `softFailureCount`, `softPrioritySum`,
`highestSoftPriority`, `softPenaltyScore` (platform default = failure
count), and `softFailuresByRuleType: Record<string, number>` (per
closed-catalogue rule type). `WEIGHTED_FAIRNESS` is the only strategy
that turns this into a score, via its bounded, chamber-configured
`softRulePenaltyWeights` map.

## Conflict analysis

Mirrors Phase 5's `analyze-rule-conflicts.ts` exactly: per-definition
validation issues mapped to conflict codes; `DUPLICATE_STRATEGY_DEFINITION`
(identical type+scope); `EQUAL_PRECEDENCE_OVERLAPPING_SCOPE`
(conservative: identical priority AND identical canonical scope — no
general partial-overlap solving); fallback-graph
`FALLBACK_TO_UNKNOWN_STRATEGY` / `FALLBACK_TO_DISABLED_STRATEGY` /
`CYCLIC_FALLBACK_GRAPH` (single-edge-per-node DFS, safety-bounded);
`ALL_ZERO_WEIGHTS` for `WEIGHTED_FAIRNESS`; `EMPTY_LEXICOGRAPHIC_CHAIN`;
`TENANT_INCONSISTENT_ID`; `STRATEGY_SET_TOO_LARGE` short-circuit before
any pairwise work. `RANDOM_STRATEGY_REJECTED` is a dedicated ERROR code.
ERROR conflicts abort the whole run (`SelectionEngineError`,
`STRATEGY_SET_CONFLICTS`) before any ranking; WARNING/INFO surface in the
draft result.

## Provisional selection (this phase's scope)

`selectProvisionalWinners` is the single per-slot entry point:
resolve candidate set → build ranking facts → resolve applicable
strategies (enabled, in-scope, in-period, sorted priority-then-id) →
resolve the single lowest-priority primary (an `EQUAL_PRECEDENCE_CONFLICT`
diagnostic when two definitions tie at the minimum priority) → attempt
ranking, walking the fallback chain (cycle-guarded) until one produces a
total order → select `min(requiredCount, rankings.length)` candidates.
**Pure, in-memory only: no database access, no `RotationState` mutation,
no mutation of its input.** Each slot is selected **independently** —
there is explicitly **no multi-slot global optimization, backtracking, or
cross-slot constraint propagation** in this phase (documented backlog
item).

## Fallback-chain safety

A fallback is attempted only when the primary (or an earlier fallback)
returns `null` from `resolveCriterionSequence` — i.e. cannot produce an
order from available facts — **never** to bypass a HARD exclusion, since
the candidate SET itself is resolved once, upstream, before any strategy
runs, and is identical across every attempt in the chain. A `visited` set
guards against cycles; an unknown or disabled fallback target is recorded
in the trace and skipped, never silently ignored.

## V1 compatibility strategy and the holiday-eve boundary

`V1_COMPATIBILITY_CHAIN` is a fixed, platform-owned catalogue entry (not
chamber-invented) reproducing V1's exact chain
(`generate-duty-schedule.ts:271-299`): totalWeightedLoad asc →
prefersThisDate desc → totalAssignmentCount asc → **weekendCount asc,
only when the date is actually a weekend** → **holidayCount asc, only
when the date actually carries a holiday** → lastDutyDate asc
(never-served first) → pharmacy name (Turkish locale).

The two date-conditional steps are the reason
`StrategyCatalogueEntry.resolveCriterionSequence` takes a third
`matchContext: StrategyMatchContext` parameter (a Phase 6 architectural
addition): the booleans are derived from `matchContext.weekday` /
`matchContext.holidayTypes`, which are the calendar's **underlying**
facts (weekday number, actual holiday matches) — not the *resolved*
day-type key. This is deliberate and is what makes exact ORDERING parity
achievable on a `HOLIDAY_EVE` date: an eve date is evaluated by what its
underlying weekday and holiday status actually are (e.g. a plain
Wednesday with no holiday of its own), exactly as V1's literal date
arithmetic would, rather than by its resolved `HOLIDAY_EVE` label. This
is verified in
`v1-compatibility-chain-equivalence.test.ts` ("HOLIDAY-EVE ORDERING
PARITY").

**Holiday-eve parity — RESOLVED (Phase 6 corrective).** The two
sub-problems are separable and BOTH are now solved:

1. **Tie-break ORDERING parity: SOLVED** (unchanged from the original
   delivery, proven above).
2. **Fairness WEIGHT/load parity on eve dates: SOLVED.** Root cause: V1
   has NO holiday-eve concept at all — `resolveDutyWeight`
   (`generate-duty-schedule.ts:112-125`) only ever branches on
   holiday/Saturday/Sunday/weekday, so an eve date is weighted exactly
   as whatever its actual calendar weekday is. Phase 4's
   `dayTypeWeights` model, by contrast, requires exactly ONE fixed
   weight value keyed by the resolved day-type string
   ("HOLIDAY_EVE") — it cannot express "this day type's weight equals
   whatever its underlying weekday's weight is" on its own.
   **Fix:** `CalendarDayContext` gained a new, always-computed, pure
   calendar fact — `compatibilityWeightDayType: "WEEKDAY" | "SATURDAY" |
   "SUNDAY"` (`resolve-calendar-context.ts`) — the day type this date
   would resolve to with holiday/eve classification ignored entirely.
   `EngineSchedulingPolicy` gained an explicit, optional, typed field —
   `holidayEveWeightSource?: "CONFIGURED" | "UNDERLYING_WEEKDAY"`
   (`engine-input.ts`) — defaulting to `"CONFIGURED"` (native V2
   semantics: HOLIDAY_EVE is weighted by its own configured
   `dayTypeWeights` entry, completely unaffected by this change). When a
   caller explicitly sets `"UNDERLYING_WEEKDAY"` (as the V1 compatibility
   fixture in the golden harness does), `buildDutyEngineContext`
   substitutes `compatibilityWeightDayType` for `slot.dayTypeKey` ONLY
   when the resolved day type is `HOLIDAY_EVE`, before calling
   `calculateFairnessFacts` — every other resolved day type is
   unaffected. Nothing is inferred through string parsing; the field is
   explicit, typed, and never a hidden default. Native V2 HOLIDAY_EVE
   semantics are NOT globally redefined — a chamber that never sets
   `holidayEveWeightSource` sees byte-identical Phase 4/5/6 behavior to
   before this corrective. No chamber, city, or tradition is hardcoded —
   the mechanism is purely calendar-arithmetic. Proven in
   `v1-golden-equivalence.test.ts` (holiday-eve-before-a-weekday-holiday,
   holiday-eve-before-a-weekend-holiday, the cross-run
   weight/hash-changes-with-weekday test, the native-V2-still-uses-
   configured-weight test, and the 3x determinism test) and exercised
   end-to-end through the real, unmodified `buildDutyEngineContext`.

## Sequential provisional-selection state (Phase 6 corrective)

**Root cause of the original independent-slot divergence:** V1
(`generate-duty-schedule.ts:248-326`) processes a period's dates in ONE
chronological loop and mutates its `metrics` map after each date's
selection, so date N+1's fairness comparison AND its
`MIN_DAYS_BETWEEN_DUTIES` eligibility check already reflect every
candidate selected on date N, N-1, … in the SAME run. The original Phase
6 delivery selected each slot independently from Phase 4/5's
pre-computed facts (history + persisted assignments only) — correct for
a single date, but diverging from V1 on any multi-date period where an
earlier date's provisional winner should have affected a later date's
comparison.

**Determination: sequential state IS required** — verified directly by
golden-harness scenarios #20 (interval relaxation) and #24 (mixed
strict/relaxed across a multi-day period), which fail without it.

**Fix (the minimum pure in-memory state — not global optimization or
backtracking):** a new module,
`selection/apply-sequential-selection-state.ts`, plus a new period-level
orchestrator, `selectProvisionalWinnersSequential`. It walks the
already-Phase-4/5-resolved `SelectionInput`s in chronological order
(their natural order, since `slotKey` is date-prefixed) while carrying a
pure, immutable, per-pharmacyId accumulator: `{ addedWeight,
addedAssignmentCount, addedWeekendCount, addedHolidayCount,
newestLastDutyDate }`. Before ranking each date:
`applyAccumulatorToFacts` folds the accumulator into that date's
`CandidateRankingFacts` (weight/count/weekend/holiday/last-duty), and
`resolveSequentialCandidateSet` recomputes strict-vs-relaxed candidate
membership using V1's exact policy (strict first; relax the interval
only when insufficient) against the accumulator's up-to-date
`lastDutyDate` — sourced entirely from Phase 4's already-computed
`strictEligible ∪ relaxedEligible` union, so every non-interval HARD
exclusion (inactive, unavailable, blocking request, configured HARD
rule) is untouched, since those never depend on within-run sequencing.
After selecting, `updateAccumulatorWithSelection` folds the winners back
in. Every function is pure (returns new Maps, never mutates its input);
`buildDutyEngineContext` now collects all of a period's slots and runs
this single sequential pass instead of per-slot independent calls — an
empty/omitted strategy set is entirely unaffected, and a single-date
period behaves identically to the original independent design (proven:
none of the original single-date Phase 6 integration tests changed
behavior). **No database access, no `RotationState` mutation — this is
the same loop-local `metrics` map V1 already has, made explicit, typed,
and pure instead of hidden mutable state.** The original
single-slot-independent entry point (`selectProvisionalWinners`) is
retained for callers that legitimately want per-slot independence (e.g.
a native V2 plan with no V1 compatibility requirement).

## Explainability

No Turkish prose anywhere in engine logic — only stable codes
(`SELECTION_CANDIDATE_SELECTED` / `SELECTION_CANDIDATE_NOT_SELECTED` /
`SELECTION_NO_STRATEGY_APPLICABLE`). Each `SelectionExplanation` carries
the decisive criterion, the full comparator trace up to the first
decisive step (cascading-comparator short-circuit semantics — the trace
for the rank-0 winner is empty by construction, since there is no
predecessor to compare against), the fairness/rotation/soft facts used,
and whether a fallback (or the final stable fallback) decided the
outcome.

## Provenance

The full provenance package is now **seven** values:
`configurationFingerprint`, `membershipSnapshotHash`, `runtimeInputHash`,
`ruleSetFingerprint`, **`strategySetFingerprint`**, `loaderVersion`,
`engineVersion` (plus the new `selectionEngineVersion` and the draft
result's own `resultFingerprint`).

`strategySetFingerprint` covers **STRATEGY CONFIGURATION only** and
deliberately **excludes pharmacy names** — renaming a pharmacy does not
change what a strategy is configured to do. Pharmacy-name tie-break
*effects* (a `PHARMACY_NAME_TR_ASC` decision) are runtime candidate data,
captured instead in the per-slot `provisionalSelectionFingerprint` (which
embeds the full `CandidateRankingFacts`, including `pharmacyName`), and
in the draft result's own `resultFingerprint`. **Consequence for a future
persistence layer:** a committed schedule must persist
`provisionalSelectionFingerprint` (or `resultFingerprint`) alongside
`strategySetFingerprint`, since the latter alone cannot prove which
specific name-based tie-break decided an order.

`fallbackStrategyIds` and `tieBreakers` are **never sorted** in canonical
form — their order is behavior-relevant (first-match / first-tried
semantics) — the one deliberate divergence from Phase 5's
canonicalization pattern, which sorts every set-like array.

## Phase 4/5 integration (additive only)

`DutyEngineInput` gains an optional `configuredSelectionStrategies?:
ConfiguredSelectionStrategy[]` field. `buildDutyEngineContext`
validates/conflict-gates the set exactly like Phase 5's rules (ERROR →
`SelectionEngineError`), computes `strategySetFingerprint`, and — only
when at least one strategy is configured — collects every slot's
`SelectionInput` in chronological order and runs
`selectProvisionalWinnersSequential` (see "Sequential provisional-
selection state" above) once for the whole period, collecting results
into `DutyEngineDraftResult.provisionalSelections`,
`.strategyConflicts`, `.strategyDiagnostics`, `.selectionExplanations`,
and `.selectionCounts`. **An empty or omitted strategy set produces empty
arrays and zero counts, leaving every Phase 4/5 field byte-identical**
(proven by `selection-engine-integration.test.ts`'s first test, which
diffs the full canonical serialization).

## V1 golden equivalence harness (Phase 6 corrective)

`v1-golden-equivalence.test.ts` is the required end-to-end proof: it
never re-implements V1's algorithm. Path A calls the actual, unmodified
`src/lib/scheduling/generate-duty-schedule.ts` directly. Path B calls
`adaptV1RuleToV2Config` (Phase 2, unmodified) to project the same V1
region/duty-rule/pharmacy input into an `AdaptedV1PlanConfig`, maps that
into a `LoadedDutyPlanVersion` fixture shaped exactly like the Phase 3
loader's output, and then calls the real, unmodified
`buildDutyEngineContext` with `buildCompatibilityRules(policy)` (Phase
5) and `buildV1CompatibilitySelectionStrategy` (Phase 6) — the same
production entry point every other caller uses, with
`holidayEveWeightSource: "UNDERLYING_WEEKDAY"` set explicitly. Both
paths run against identical synthetic, chamber-independent scenario
data. 29 tests cover dailyDutyCount 1 and 3; weekday/Saturday/Sunday/
official/religious/OTHER holidays; both eve sub-cases; overlapping
holiday metadata (documented achievable case); unavailability;
CANNOT_DUTY; EMERGENCY_EXCUSE; PREFER_DUTY; historical load; historical
interval carry-over; balance adjustment; inactive-pharmacy exclusion;
interval relaxation; quota-exceeds-candidates underfill; Turkish-name
tie; a fully-tied deterministic case; a multi-day mixed strict/relaxed
period; 3x repeated-execution determinism; and fingerprint-changes-
with-selection provenance. All 29 pass, run twice consecutively.

**One documented, honest non-equivalence** (not silently glossed over):
a same-date RELIGIOUS+OFFICIAL holiday overlap is genuinely
ARRAY-ORDER-DEPENDENT in V1 (`holidayByDateKey` is a `Map`, so whichever
holiday record appears LAST in the caller's input array wins — an
implementation artifact, not a specified rule), while V2's day-type
precedence deterministically prefers RELIGIOUS_HOLIDAY regardless of
input order. The golden harness's overlapping-holiday scenario is
therefore constructed with two holidays sharing the same effective
weight bucket (OFFICIAL + OTHER) to prove the achievable case; a
RELIGIOUS+OFFICIAL overlap would require the input array to already list
the RELIGIOUS holiday last to agree with V2's stable rule — this is a
V1 non-determinism V2 deliberately replaces with a documented,
deterministic one, not a Phase 6 defect.

## Test coverage (this phase)

- `v1-compatibility-chain-equivalence.test.ts` (11 tests): step-by-step
  order equivalence with V1's literal chain, incl. the date-conditional
  weekend/holiday inclusion and the holiday-eve ordering-parity case.
- `strategy-catalogue-validation-conflicts.test.ts` (27 tests): all 6
  chamber-facing strategy types, RANDOMIZED/unknown-type rejection,
  bounded-limit enforcement, tenant-safety, fingerprint determinism.
- `selection-engine-integration.test.ts` (8 tests): end-to-end
  `buildDutyEngineContext` wiring — byte-identical empty-set behavior, no
  DB writes / no RotationState mutation, correct winner selection,
  fingerprint behavior, ERROR-conflict rejection, RANDOMIZED rejection,
  fallback-chain success, cross-run determinism.
- `rules-engine-integration.test.ts`'s pre-existing "no winner selection
  exists anywhere in the draft result" test was updated (not weakened) to
  assert the Phase 6 no-op contract by field/value rather than by string
  matching, since Phase 6 additively introduces the (empty-when-unused)
  selection fields that string match could no longer distinguish.
- `apply-sequential-selection-state.test.ts` (7 tests, corrective): the
  accumulator's fold/update functions in isolation — purity, weight/
  count/weekend/holiday folding, lastDutyDate max-of-two-sources logic.
- `v1-golden-equivalence.test.ts` (29 tests, corrective): see "V1 golden
  equivalence harness" below.

**Deferred** (explicitly out of scope, not silently dropped): a
DB-fixture golden harness (the corrective harness builds its
`LoadedDutyPlanVersion` fixture in-memory via the same shape the Phase 3
loader produces, rather than round-tripping through a live database —
this is a deliberate, honest scope boundary: the loader itself is
Phase 3's already-tested responsibility, not Phase 6's); strategy
persistence and admin UI; multi-slot GLOBAL optimization/backtracking
(the sequential accumulator added in this corrective is local
carry-forward state, not optimization — no candidate set is ever
re-opened once ranked); committed-schedule generation; external strategy
plugins; AI-generated strategies. The holiday-eve weight/load boundary
and the independent-vs-sequential selection boundary — the two items
this corrective was scoped to resolve — are both now resolved, not
deferred.
