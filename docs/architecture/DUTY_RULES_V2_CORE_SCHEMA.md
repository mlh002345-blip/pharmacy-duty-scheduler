# Duty Rules V2 — Core Schema (Phase 1)

Branch `feature/duty-rules-v2-core-schema`, migration
`20260714150838_duty_rules_v2_core`. Purely additive: **no engine, no
lifecycle actions, no UI, no behavior change**. V1 (`DutyRule` +
`src/lib/scheduling/generate-duty-schedule.ts`) remains the only
production scheduling behavior and is byte-for-byte untouched.

## Scope of this phase

Representable (as data only): versioned duty plans; multiple shifts on
one date; multiple slot requirements per day type; multiple rotation
pools; temporal pool membership; persistent rotation state.

**Deliberately deferred** (later phases): rule evaluation engine,
custom/tradition rules, ServiceArea/ServicePoint, simulation execution,
`ScheduleGenerationRun`, `RuleOverrideGrant`, wizard UI, V2 generation,
geographic distance, approval capabilities, multi-province organizations.

## Entities and responsibilities

| Entity | Responsibility | Tenant ownership path |
|---|---|---|
| `DutyPlan` | Named container for how one duty region is scheduled | own `organizationId` (+ `regionId`) |
| `DutyPlanVersion` | The immutable configuration boundary (statuses DRAFT→…→ARCHIVED, `versionNumber`, `validFrom/To`, lifecycle timestamps) | via `plan.organizationId` |
| `DayTypeRule` | Per (version, day type): served or not; `customDayCategory` extension point | via version → plan |
| `ShiftDefinition` | Shift shape (minutes-from-midnight, `spansMidnight`, weight, order), **owned by its version** | via version → plan |
| `SlotRequirement` | "Day type D, shift S needs N pharmacies (from pool P)" with deterministic `sortOrder` | via dayTypeRule → version → plan |
| `RotationPool` | Named pool with strategy (SEQUENTIAL / FAIRNESS_SCORE / WEIGHTED / MANUAL_ORDER), optionally region-scoped | own `organizationId` |
| `RotationPoolMembership` | Temporal membership (`joinedAt`/`leftAt`, `sortIndex`); transfers close+reopen, never overwrite | via pool |
| `RotationState` | Persistent progression per (pool, `dayTypeScope`): round, cursor, validated carry-forward, `lockVersion` | via pool |

Key architecture decisions carried from the approved plan:

- **Region is currently used as the V2 DutyRegion** (compatibility).
  `AdministrativeDistrict` and `DutyRegion` may be separated later; no V2
  table copies `Region.district` or otherwise depends on Region's dual
  role, so that separation stays open.
- **A region may have multiple DutyPlans** — no unique on
  `DutyPlan.regionId`. The business rule "only one ACTIVE version per
  region per overlapping effective period" is a **documented service-layer
  requirement for the future activation action** (advisory lock + range
  check inside one transaction). Date-range exclusivity cannot and must
  not be faked with a Prisma unique constraint.
- **ShiftDefinition belongs to DutyPlanVersion, never the organization**:
  the same shift name may mean different hours per region/version, and
  historical versions must preserve their exact shift definitions.
- **DutyPlanVersion immutability once ACTIVE** is a service-layer rule
  for the future lifecycle actions (none exist yet); the database
  protects the harder invariant: a version referenced by any
  `DutySchedule` can never be deleted (Restrict), even through the
  plan→version cascade.
- **`customDayCategory`** on DayTypeRule is the forward-compatible
  extension point for chamber-defined repeated local categories without
  enum changes; custom-calendar evaluation is not implemented.

## Existing-table extensions (all nullable, V1 never writes them)

- `DutySchedule.planVersionId` (FK Restrict). NULL = V1 schedule.
- `DutyAssignment.shiftDefinitionId` (FK Restrict) and
  `DutyAssignment.slotKey`. NULL shift = legacy whole-day assignment.
- `generationRunId` is **deliberately absent** — `ScheduleGenerationRun`
  is a later phase.

## Partial unique indexes (raw SQL — Prisma cannot express these)

Defined at the end of the migration file and mirrored in schema comments:

```sql
CREATE UNIQUE INDEX "DutyAssignment_legacy_unique"
  ON "DutyAssignment" ("dutyScheduleId","pharmacyId","date")
  WHERE "shiftDefinitionId" IS NULL;

CREATE UNIQUE INDEX "DutyAssignment_v2_shift_unique"
  ON "DutyAssignment" ("dutyScheduleId","pharmacyId","date","shiftDefinitionId")
  WHERE "shiftDefinitionId" IS NOT NULL;

CREATE UNIQUE INDEX "DayTypeRule_plain_unique"
  ON "DayTypeRule" ("planVersionId","dayType")
  WHERE "customDayCategory" IS NULL;

CREATE UNIQUE INDEX "DayTypeRule_custom_unique"
  ON "DayTypeRule" ("planVersionId","dayType","customDayCategory")
  WHERE "customDayCategory" IS NOT NULL;
```

Why: a plain composite unique containing a nullable column silently
loses the guarantee for NULL rows (PostgreSQL treats NULLs as distinct).
The legacy index preserves the **exact** V1 protection (one pharmacy per
schedule+date, including the concurrent manual-edit race it exists to
catch); the V2 index scopes uniqueness to the shift, deliberately
allowing the same pharmacy to hold two *different* shifts on one date —
that behavior belongs to a future configurable `SHIFT_MUTUAL_EXCLUSION`
rule, never to the database.

## Rotation-pool and temporal-membership design

Pool names unique per organization (identical names across
organizations are allowed and tested). Membership is temporal: "active
as of D" = `joinedAt <= D AND (leftAt IS NULL OR leftAt > D)`; a
transfer closes the old row and opens a new one — history is never
overwritten, and `Pharmacy` is Restrict from memberships so temporal
history is never silently lost. `RotationState` is unique per
(pool, `dayTypeScope`) with `currentRound`, a SetNull cursor to the
last-served membership, a `lockVersion` for future optimistic
concurrency, and `carriedForward` — the only JSON column in this phase,
a small validated ledger (see `src/lib/duty-rules-v2/rotation-state.ts`),
never a generic blob. Nothing advances rotation state yet.

## Deletion behavior summary

- Draft configuration cascades: plan → versions → dayTypeRules/shifts →
  slotRequirements.
- History is protected by Restrict: version ← DutySchedule; shift ←
  DutyAssignment; pool ← SlotRequirement; pharmacy ← membership.
- `RotationState.lastServedMembership` is SetNull (round/carry survive a
  lost cursor).

## Tenant ownership

No entity below `DutyPlan`/`RotationPool` carries its own
`organizationId` — ownership always derives through the parent chain
(the same convention as `PharmacyImportRegionCandidate`), so there is
nothing client-suppliable to tamper with. No Server Actions exist in
this phase, so no client input path exists at all. A structural note for
the future service layer: the database does not forbid a
`SlotRequirement` pointing at another organization's pool — org-equality
between slot's plan and pool is a **mandatory service-layer validation**
when the first write action is built (recorded here deliberately;
cross-org FK reachability was exercised in rehearsal scenario C).

## V1 compatibility

`DutyRule` is unchanged and remains the source of truth for V1.
`generate-duty-schedule.ts`, the V1 actions, `/kurallar`, and schedule
routes are untouched. All new columns are nullable and unwritten by V1
code; the full existing test suite passes unchanged.

## Migration rehearsal evidence

One additive migration, no backfill, no destructive enum change, no
table rewrite (nullable column adds + index create/drop only). Rehearsed
on disposable PostgreSQL:

- **A — fresh database**: all migrations apply; all 4 partial indexes
  present.
- **B — representative data** (organization, user, region, duty rule,
  pharmacies, historical record, DRAFT + PUBLISHED schedules, NULL-shift
  assignments): row counts identical before/after
  (DutyRule 1, DutySchedule 2, DutyAssignment 3, Pharmacy 2); every
  assignment has NULL `shiftDefinitionId`/`slotKey`; every schedule has
  NULL `planVersionId`.
- **C — deliberate collisions**: duplicate legacy assignment →
  `DutyAssignment_legacy_unique` violation; same pharmacy, same date,
  two different shifts → allowed; duplicate same-shift row →
  `DutyAssignment_v2_shift_unique` violation; identical pool names in two
  organizations → allowed; same-organization duplicate →
  `RotationPool_organizationId_name_key` violation.

Rollback posture: additive-only, so application rollback alone is safe
(old code ignores the new tables/columns); dropping the schema would be
a forward-fix migration if ever needed, per the existing rollback
conventions.

## Why no chamber or city is hardcoded

Every capacity, shift, pool, and day-type behavior in this schema is a
*row created by an organization*, keyed only by tenant-owned ids. No
model, column, enum value, default, index, or test fixture references
any province, city, district, or chamber name; the observed real-world
models (separate rotation types, multi-shift days, mixed regional
models) are expressible purely as configuration data — the integration
suite constructs such shapes with synthetic names only.

## Future extension points

`customDayCategory` (custom repeated day categories), `dayTypeScope` as
string (custom rotation scopes), `slotKey` (engine explanations),
`lockVersion` (optimistic engine writes), `SlotRequirement` ready to
gain `serviceAreaId`/min–max in the ServiceArea phase, and
`DutySchedule` ready to gain `generationRunId` in the simulation phase.

## Architectural backlog — known unrelated defects (recorded, NOT fixed here)

1. Schedule XLSX export writes "22" into blank Address and Note cells.
2. Pharmacy import allows a blank Address while the pharmacy edit form
   requires it — the two validation surfaces disagree.
3. The reported browser freeze has no proven application root cause and
   appears partly environment/extension related
   (`docs/testing/TAB_FOCUS_FREEZE_INVESTIGATION.md`).
4. Existing single-rule (V1) generation must remain functional until V2
   is proven — nothing in this phase or later phases may remove it
   before the roadmap's retirement step.
