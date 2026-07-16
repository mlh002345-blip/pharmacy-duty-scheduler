# Duty Rules V2 — Phase 5: Configurable Rule Engine

Branch `feature/duty-rules-v2-configurable-rule-engine`. A **safe,
versioned, deterministic, chamber-configurable** rule engine
(`src/lib/duty-rules-v2/rules/`) that turns versioned rule definitions +
explicit scope/parameters/effective dates/exceptions + Phase 4 candidate
facts into typed `RuleEvaluationResult`s, integrated ADDITIVELY into the
Phase 4 pipeline. **No winner selection, no schedule/assignment writes,
no rule persistence, no UI, no plan activation, no production call
site.** V1 remains the production source of truth, byte-untouched; no
chamber, city, province, district, or local tradition is hardcoded.

## Product responsibility boundary

**The chamber configures** (data only): enable/disable, severity where
the catalogue allows it, priority, scope, numeric limits and other typed
parameters, validity dates, exceptions (dates/weekdays/holiday types/
pharmacies/pools/slots/modes), pharmacy id lists, supported future
tags/groups references.

**The platform defines** (code only): the rule-type catalogue, strict
parameter schemas, validation, deterministic evaluators, conflict
detection, relaxation capability, diagnostics, explanation codes, and
every security boundary.

**Chambers can never configure**: evaluator implementations, arbitrary
code, JavaScript, SQL, expressions, regex, scripts, free-text rules,
dynamic module paths, file paths, HTTP calls, environment variables, or
tenant ids outside their own scope. Every definition object is a strict
Zod shape — unknown keys anywhere (top level, scope, exceptions,
parameters) are rejected wholesale, so executable content cannot even be
carried, let alone run. The catalogue map is the security boundary: only
platform-registered `ruleType`s evaluate, always through platform code.

## Architecture (small pure modules)

Rule Catalogue → Rule Definition → Parameter Validation → Scope Matching
→ Effective-Date Matching → Exception Matching → Rule Evaluation → Typed
Violation → Conflict Analysis → Explainability.

| Module | Role |
|---|---|
| `domain/rule-definition.ts` | `ConfiguredRuleDefinition` (severity HARD/SOFT/ADVISORY; sources PLATFORM_DEFAULT / ORGANIZATION_CONFIGURED / REGION_CONFIGURED / PLAN_VERSION_CONFIGURED / COMPATIBILITY_V1) |
| `domain/rule-scope.ts` | scope + exceptions contracts, 16 dimensions |
| `domain/rule-parameters.ts` | bounded primitives (max 1000 ids, 366 dates, finite numbers ≤ 100000, string caps) |
| `domain/rule-catalogue.ts` | catalogue-entry contract incl. `evaluatorVersion`, relaxation declaration, participation |
| `domain/rule-evaluation.ts` | `RuleEvaluationContext` + `RuleEvaluationResult` |
| `domain/rule-conflict.ts` | typed conflicts, ERROR/WARNING/INFO |
| `catalogue/*` | the 20 initial rule types |
| `validate-rule-definition.ts` | per-definition validation |
| `match-rule-scope.ts` / `match-rule-effective-period.ts` / `match-rule-exceptions.ts` | pure matchers |
| `evaluate-rule.ts` / `evaluate-rules.ts` | precedence + per-slot evaluation (incl. date overrides) |
| `analyze-rule-conflicts.ts` | static conflict analysis |
| `canonicalize-rule-set.ts` | canonical form + `ruleSetFingerprint` |
| `build-rule-explanation.ts` | code-based explanations |
| `build-rule-context.ts` | Phase 4 facts → evaluation context |
| `build-compatibility-rules.ts` | deterministic V1 policy → rules projection |
| `rule-errors.ts` | `RuleEngineError` |

## Scope model

AND semantics over present dimensions: organization, region, plan, plan
version, pools, day types, custom categories, shifts, slots, pharmacies,
date range, weekdays, holiday types (OFFICIAL/RELIGIOUS/OTHER/NONE),
generation modes — plus **stable future dimensions** `pharmacyGroupIds`
and `serviceAreaIds`, whose facts do not exist yet: referencing them is
a WARNING at validation and a controlled `UNSUPPORTED_FACT` outcome at
evaluation — never a silent ignore or pass.

## Effective periods and exceptions

`validFrom`/`validTo` both inclusive, null = unbounded. Exceptions:
excluded dates/weekdays/holiday types/pharmacies/pools/slots/modes, plus
`includedDates`, which pulls a date INTO applicability from outside the
validity window. Precedence (fixed, tested): **disabled → outside
effective period (includedDates may override this step only) → scope
mismatch → explicit exclusion exception → evaluate** — exclusions win
over inclusions. Exceptions can only suppress; tenant-inconsistent ids
in scope or exceptions are ERROR conflicts before evaluation.

## Initial catalogue (20 platform rule types)

Hard eligibility: `PHARMACY_MUST_BE_ACTIVE`, `MEMBER_OF_POOL_AS_OF_DATE`,
`PHARMACY_UNAVAILABLE_ON_DATE`, `BLOCK_APPROVED_CANNOT_DUTY_REQUEST`,
`BLOCK_APPROVED_EMERGENCY_EXCUSE` (HARD-only, exception-free safety
rules); `SAME_SLOT_DUPLICATE_FORBIDDEN`; `EXCLUDE_PHARMACY` /
`INCLUDE_ONLY_PHARMACIES` (id lists). Interval/load:
`MIN_DAYS_BETWEEN_ASSIGNMENTS` (minimumDays, relaxable, scopeMode),
`SAME_DAY_ASSIGNMENT_LIMIT` (ALL_SLOTS supported; SAME_SHIFT/SAME_POOL/
SAME_DAY_TYPE → `UNSUPPORTED_FACT` until assignments carry shift/pool
facts), `MAX_ASSIGNMENTS_IN_PERIOD` (GENERATION_PERIOD; ROLLING_DAYS
windows reaching before the period → `UNSUPPORTED_FACT`),
`MAX_WEIGHTED_LOAD_IN_PERIOD` (projected period load vs cap). Patterns/
preferences: `PREFER_REQUESTED_DATE` (SOFT/ADVISORY only, a positive
signal — never fails anyone), `AVOID_CONSECUTIVE_WEEKEND_ASSIGNMENTS`,
`AVOID_CONSECUTIVE_HOLIDAY_ASSIGNMENTS` (lookbackDays over period
facts), `MINIMUM_REST_AFTER_SHIFT` (NOT_APPLICABLE for null shift times;
UNSUPPORTED_FACT when adjacent assignments lack times). Structure:
`POOL_QUOTA` (slot-level quota diagnostic — not winner selection),
`TAG_COMBINATION_FORBIDDEN` / `GROUP_COMBINATION_FORBIDDEN`
(UNSUPPORTED_FACT until tag/group facts exist), `CUSTOM_DATE_OVERRIDE`
(meta rule: disable or re-severity EXPLICITLY referenced rules on listed
dates, within the target's allowed severities — no custom evaluator
logic possible). No chamber-specific rules (no named hospitals, malls,
or city rotations).

## Parameter validation

Per-type STRICT Zod schemas over bounded primitives; rejected: unknown
keys, missing required values, NaN/Infinity, non-positive counts, empty
or duplicate ids, invalid/inverted dates, arrays over limits, oversized
strings, unsupported severities/scopes/exceptions. Typed issues feed the
conflict analyzer; any ERROR rejects the whole rule set before
evaluation.

## Evaluation result and severity behavior

`RuleEvaluationResult`: rule id/type/version + `evaluatorVersion`,
severity, priority, applicability flags (scope/period/exception),
outcome PASS | FAIL | NOT_APPLICABLE | UNSUPPORTED_FACT |
INVALID_CONFIGURATION, observed/expected values, violation and
explanation codes, factsUsed, `relaxable`, decision effect EXCLUDED |
PENALIZED | INFORMATION_ONLY | NO_EFFECT | UNSUPPORTED. HARD failures
exclude (feed eligibility); SOFT failures are preserved for Phase 6
scoring (softConcerns + ruleEvaluations); ADVISORY results never touch
eligibility or scoring. Canonical result ordering by slot, candidate,
priority, ruleType, id.

## Relaxation policy

Catalogue entries declare `relaxable` + `relaxationMode`. ONLY
`MIN_DAYS_BETWEEN_ASSIGNMENTS` (mode `V1_MIN_INTERVAL`) may reproduce
V1's automatic relaxation, and only when the chamber's own `relaxable`
parameter opts in. Relax-admissibility in the Phase 4 relaxation stage:
every hard failure must be in the relaxable-reason set (built-in
`MIN_DAYS_INTERVAL` + declared relaxable rule violation codes) —
inactive, non-member, unavailable, blocking requests, tenant mismatch,
and explicit exclusions are never relaxed; future rules default to
non-relaxable.

## Conflict analysis

Static, deterministic, conservative (no NP-hard solving): unknown types,
invalid parameters, unsupported severity/scope/exceptions, duplicate
active definitions (type+scope), include/exclude contradictions
(WARNING) and provably impossible pharmacy sets (ERROR), min>max /
impossible quotas, validity fully excluded by exceptions, exceptions
outside validity (INFO), equal-priority HARD contradictions,
overlapping equal-precedence date overrides, tenant-inconsistent ids,
oversized rule sets. ERROR conflicts throw
`RuleEngineError("RULE_SET_CONFLICTS")` before evaluation;
WARNING/INFO conflicts are reported in the draft result.

## Canonicalization and fingerprint

Canonical form: display-only fields (name, metadata) dropped; set-like
arrays sorted; rules ordered by (priority, ruleType, canonical scope,
validFrom, id); each rule paired with its catalogue `evaluatorVersion`.
`ruleSetFingerprint` = sha256 over the canonical serialization — flips
on enabled/severity/priority/scope/parameters/validity/exceptions/
definition version/evaluator version; ignores rule order, array order,
key order, names, descriptions, and diagnostics. **The provenance
package is now FIVE values**: `configurationFingerprint`,
`membershipSnapshotHash`, `runtimeInputHash`, `ruleSetFingerprint`
(added to both SelectionInput and run provenance), and the draft
`resultFingerprint`.

## Phase 4 integration

Phase 4 facts → rule evaluation → normalized `ConstraintResult`s
(constraintCode `CONFIGURED_RULE`, explanation = the rule violation
code) → `evaluateEligibility` → relaxation → SelectionInput — one
evaluation path, no second source of truth. The built-in Phase 4
constraints REMAIN as the platform safety floor; configured rules add
to them. `DutyEngineInput.configuredRules` is optional in-memory input:
**empty/absent = Phase 4 behavior byte-identical** (asserted).
`buildCompatibilityRules(policy)` projects the explicit V1 policy into
COMPATIBILITY_V1 definitions deterministically; it is never
auto-injected, and client-supplied policy is not a trusted production
source (no production caller exists).

## Explainability

`buildRuleExplanations` emits a code-based payload for every non-PASS
result: rule code/source/severity, canonical scope and parameters used,
facts observed, expected condition, relaxability, applicability reason
(APPLICABLE / DISABLED / OUTSIDE_EFFECTIVE_PERIOD / SCOPE_MISMATCH /
EXCEPTION / UNSUPPORTED), matched exception, and decision effect. No
Turkish prose in the engine; ids and stable codes only (tested: no
tenant names leak).

## Unsupported future facts

Tags, pharmacy groups, and service areas are stable contract fields with
null facts: rules referencing them return `UNSUPPORTED_FACT` (and
validation warns), never silently pass — the catalogue entries become
effective the day the facts arrive, without contract changes.

## Deliberately deferred

Rule persistence schema and versioned storage, configuration UI, chamber
onboarding, free-text→rule conversion, winner-selection strategies,
soft-rule scoring weights, committed generation, schedule/assignment
writes, rotation advancement, external plugins/DSL, geographic rules,
group/service-area/tag persistence. Phase 6 selection consumes
SelectionInput: HARD outcomes already shape strict/relaxed sets; SOFT
failures arrive as PENALIZED rule evaluations ready for strategy
scoring; ADVISORY entries flow to reports.

## Confirmations

Chambers cannot execute arbitrary code (strict schemas + platform-only
catalogue map); no winner selection; nothing written to the database
(the integration test asserts unchanged counts/timestamps); no rule
persistence or UI; no V2 plan activated; V1 untouched; no chamber or
city hardcoded (all fixtures synthetic).
