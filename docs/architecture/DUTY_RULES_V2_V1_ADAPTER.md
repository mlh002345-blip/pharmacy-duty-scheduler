# Duty Rules V2 — Phase 2: V1 Compatibility Adapter

Branch `feature/duty-rules-v2-v1-adapter`. A **pure, deterministic,
tested library** (`src/lib/duty-rules-v2/v1-adapter.ts`) proving that
the current V1 configuration is exactly representable with the V2 core
building blocks. **Nothing in the application calls it**; V1 remains
the production source of truth; no database rows are read or written by
the adapter; no V2 plan exists or is activated; no chamber, city,
province, or district is encoded anywhere.

## V1 semantic inventory (verified against code, with citations)

| V1 field / behavior | Meaning & engine use | Maps to V2 |
|---|---|---|
| `Region.dailyDutyCount` (schema `Region`, default 1; validated ≥1 in `src/lib/validations/region.ts`) | Pharmacies selected per date (`generate-duty-schedule.ts:302` `sorted.slice(0, dailyDutyCount)`) | `SlotRequirement.requiredCount`, uniform across day types |
| `DutyRule.minDaysBetweenDuties` (schema:147, default 1) | Strict eligibility filter (`:260-264`), **relaxed** when fewer strictly-eligible pharmacies than the quota (`:266-269`) | `fairness.minDaysBetweenDuties` + `relaxMinIntervalWhenInsufficient: true` |
| `weekdayWeight` / `saturdayWeight` / `sundayWeight` (schema:148-150) | Per-date weight via `resolveDutyWeight` (`:112-125`): Saturday `:122`, Sunday `:123`, else weekday `:124` | `DayTypeRule.weight` for WEEKDAY / SATURDAY / SUNDAY |
| `officialHolidayWeight` / `religiousHolidayWeight` (schema:151-152) | RELIGIOUS at `:118`; **OFFICIAL and OTHER both** use the official weight (`:119-120`) | `DayTypeRule.weight` for the two holiday types + `compatibility.otherHolidayWeightSource: "OFFICIAL_HOLIDAY"` |
| Holiday eve | **No V1 distinction exists** (no eve branch in `resolveDutyWeight`) | `HOLIDAY_EVE` rule with `distinctInV1: false`, `weight: null` — no invented behavior |
| Active pharmacies only | Hard filter (`:177-179`) | pool membership = active in-region pharmacies; inactive ones preserved in `rotationPool.excluded` |
| `Unavailability` | Per-date block (`:254-257`), never permanent removal | `eligibility.unavailabilityBlocksDate` — explicitly NOT membership |
| Approved `CANNOT_DUTY` / `EMERGENCY_EXCUSE` | Per-date block (`:194-198`, `:207-215`) | `eligibility.approvedCannotDutyBlocksDate` / `…EmergencyExcuse…` |
| Approved `PREFER_DUTY` | Tie-preference at equal load (`:280-284`) | tie-breaker position 2 |
| Historical assignments | Seed metrics: count, load, weekend count, last date (`:227-236`) | `fairness.openingBalanceIncluded` + runtime pass-through |
| `openingBalance` (historical import + `DutyBalanceAdjustment`) | Seeds `totalLoadScore` only, never the interval (`:184-187`) | same semantics, recorded in fairness config |
| Selection order | load → prefer-request → total duties → weekend (on weekends) → holiday (on holidays) → oldest last duty → `localeCompare(name,"tr")` (`:271-300`) | `fairness.tieBreakers` (7 entries, in order) |
| Shift/time semantics | **None** — whole-day assignment | one synthetic shift with `startMinute/endMinute/spansMidnight = null` (no fabricated hours) |
| Warnings | "not enough pharmacies" per date (`:304-309`) | runtime behavior, unchanged (proven identical via the engine-equality tests) |
| Cannot yet be represented | nothing — every V1 configuration input maps; runtime inputs (month, holidays, unavailability, history, requests) are pass-through by design, not configuration |

## Adapter contract

`adaptV1RuleToV2Config(input: V1AdapterInput): AdaptedV1PlanConfig` —
plain typed input (deliberately not Prisma models), plain serializable
output. Companions: `projectAdaptedConfigToV1(config)` (reverse
projection to the exact V1 engine configuration),
`validateAdaptedConfig(config)` (output invariants), and
`canonicalSerialize(value)` (recursively key-sorted JSON for
byte-stable equality). Controlled errors are `V1AdapterError` with
stable codes; messages carry ids only, never pharmacy names or other
content.

## Synthetic identifier strategy (deterministic)

`v1-plan:{regionId}` · `v1-version:{dutyRuleId}:v{ADAPTER_VERSION}` ·
`v1-shift:{regionId}` · `v1-pool:{regionId}` ·
`v1-slot:{DAY_TYPE}:0`. No UUIDs, no cuid, no `Date.now()`, no
timestamps anywhere in the output (asserted by test), no dependence on
input array order (memberships sorted by id; day types in a fixed
list). `generatedAt` deliberately does not exist so nothing time-based
can leak into deterministic equality.

## Validation behavior

Input: zod shape validation (ids non-empty, `dailyDutyCount ≥ 1`,
`minDaysBetweenDuties ≥ 0`, all five weights finite and positive) plus
relational checks — region↔organization consistency, rule↔region
consistency, pharmacy↔region membership, duplicate pharmacies. Output:
`validateAdaptedConfig` catches missing day types, duplicate synthetic
keys, slot→shift / slot→pool dangling references, duplicate
memberships, sub-1 counts, invalid weights, negative intervals.

## Round-trip compatibility method and evidence

For 15 synthetic fixtures (`v1-adapter-equivalence.test.ts`):

1. **Config round-trip** — `canonicalSerialize(projectAdaptedConfigToV1(
   adapt(input)))` equals `canonicalSerialize(normalizeV1Config(input))`,
   where normalization is exactly the V1 engine's own view (active
   in-region pharmacies; `generate-duty-schedule.ts:177`).
2. **Engine equality** — the UNCHANGED V1 generator runs on the original
   input and on the reconstructed configuration; assignments, warnings,
   and info are byte-identical (`JSON.stringify` equality). No V2
   scheduler exists, is simulated, or is claimed — both runs use the
   same V1 engine, which is what makes this a compatibility proof
   rather than an engine-equivalence claim.

Fixture coverage: 15/30/100 pharmacies; `dailyDutyCount` 1 and 3;
quota exceeding eligible pharmacies (warning parity); OFFICIAL /
RELIGIOUS / OTHER holidays (incl. the OTHER→official-weight rule);
Saturday/Sunday weights; unavailability (membership vs. date
eligibility separation asserted); historical duties; balance
adjustments; inactive pharmacies; interval pressure with relaxation;
multiple same-date assignments; Turkish characters; all-tie
determinism; two organizations with identical region/rule names
(non-colliding keys). Determinism additionally proven by three
consecutive byte-identical adapter+engine runs, and the whole suite was
executed three times consecutively.

## Limitations and deliberately deferred work

- The adapter proves *representability*, not V2-engine equivalence —
  that proof belongs to the phase that builds the V2 engine, which will
  consume `AdaptedV1PlanConfig` as its compatibility-mode input.
- **Draft materialization (Phase 8 of the task) is deferred by the
  task's own default**: no operator script writes DRAFT
  DutyPlan/…/RotationState rows in this PR; nothing here needs the
  database at all. When built, it must be operator-invoked, DRAFT-only,
  idempotent, dry-runnable, tenant-validated, single-transaction, and
  must refuse to overwrite non-draft configuration.
- No loader layer exists yet (Phase 3 concern), so there are no
  integration tests — the adapter is fully unit-tested without a DB, by
  design.
- Known backlog items (XLSX "22" cells, import/edit address mismatch,
  environment-suspected freeze, DutyAssignment index redundancy,
  membership-cascade tightening, requiredCount CHECK, cross-tenant FK
  service enforcement) are intentionally untouched; the future
  materialization service depends on the last item's guard.

## How Phase 3 consumes this

The V2 engine's compatibility mode takes `AdaptedV1PlanConfig` directly
(no DB round-trip needed), letting the golden harness extend naturally:
same fixtures, V1 engine vs. V2 engine, byte-equality target.

## Confirmations

No chamber/city/province/district is hardcoded (fixtures are synthetic
and Turkish-character-bearing only); V1 remains the production source
of truth — this PR adds zero call sites, zero routes, zero flags, zero
schema changes, and zero writes.
