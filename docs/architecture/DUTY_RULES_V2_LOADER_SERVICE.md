# Duty Rules V2 — Phase 3: Tenant-Safe Plan Loader and Read Service

Branch `feature/duty-rules-v2-loader-service`. A **read-only, tenant-safe,
version-specific, deterministic** loader that converts one persisted
`DutyPlanVersion` into a validated, engine-ready domain object
(`LoadedDutyPlanVersion`). It answers *"can a persisted V2 plan version be
loaded safely, completely, and deterministically for one organization and
one region?"* — and nothing more. **Nothing in the application calls it**;
V1 remains the production source of truth; no chamber, city, province, or
district is hardcoded anywhere (all tests use synthetic fixtures).

## Objective and boundaries

- Reads the Phase 1 schema (`20260714150838_duty_rules_v2_core`), writes
  **nothing**: the entire stack contains exactly one `findFirst` and zero
  create/update/delete/upsert/raw-SQL statements.
- No V2 generation, no activation, no "current active version" inference,
  no automatic version selection, no route/action/CLI/UI, no runtime
  switch, no migration.
- No Prisma model ever crosses the domain boundary; no hidden defaults;
  no partial configuration acceptance; no fallback to V1 values.

## Module layout (repository / domain separation)

| Module (`src/lib/duty-rules-v2/`) | Role | Prisma? |
|---|---|---|
| `plan-version-repository.ts` | `fetchDutyPlanVersionRecord` — the ONE scoped query; maps the raw row to a plain persistence DTO, deduplicates pools | **yes (only here)** |
| `plan-version-record.ts` | `PlanVersionRecord` DTO types + `toIsoDate` | no |
| `validate-loaded-plan.ts` | `validateTenantIntegrity`, `validateStructure` + reusable future-link validators | no |
| `resolve-pool-membership.ts` | pure `resolvePoolMembershipAsOf(pool, date)` | no |
| `plan-version-policy.ts` | `canPreviewPlanVersion` / `canSimulatePlanVersion` / `canCommitFromPlanVersion` | no |
| `load-duty-plan-version.ts` | `loadDutyPlanVersion` orchestrator + pure `buildLoadedDutyPlanVersion` + fingerprint | no (delegates) |
| `domain/loaded-plan.ts` | the plain domain contract | no |
| `errors.ts` | `DutyPlanLoaderError`, typed issue codes, `throwForIssues` | no |

Everything except the repository is pure, so 41 of the 47 tests run
without PostgreSQL. Server-only follows the codebase convention: the
repository imports `@/lib/prisma` (env-validated at module load), which no
client component can import without the build failing.

## Loader contract

```ts
loadDutyPlanVersion({
  organizationId,       // from the session, never client-supplied ids alone
  regionId,
  planVersionId,
  effectiveDate?,       // "YYYY-MM-DD"; when present, membership snapshots are resolved
}): Promise<LoadedDutyPlanVersion>
```

The Prisma query is organization-scoped **from the root**:
`dutyPlanVersion.findFirst({ where: { id, plan: { organizationId, regionId } } })`.
There is no unscoped `findUnique(planVersionId)`, no fallback query after
a miss, no first-matching-plan selection, no default organization or
region. Unknown version, foreign-organization version, foreign-region
version, and inaccessible plan are **indistinguishable**: the same
`PLAN_VERSION_NOT_FOUND` with the same message ("Nöbet planı sürümü
bulunamadı.") — no tenant-existence disclosure (asserted by unit and
integration tests comparing all three failure messages byte-for-byte).

## Tenant-integrity checks (service layer closes what the DB permits)

| # | Check | Issue code |
|---|---|---|
| 1–2 | plan.organizationId / plan.regionId match the request | enforced by the root query; re-asserted defensively |
| 3 | plan.region.organizationId == plan.organizationId | `PLAN_REGION_ORGANIZATION_MISMATCH` |
| 4 | every slot's pool belongs to the plan's organization | `POOL_ORGANIZATION_MISMATCH` |
| 5 | a region-scoped pool (regionId ≠ null) is scoped to the plan's region; null = org-wide, valid | `POOL_REGION_MISMATCH` |
| 6 | every membership pharmacy's region.organizationId == plan.organizationId | `MEMBERSHIP_PHARMACY_ORGANIZATION_MISMATCH` |
| 7 | in a region-scoped pool, every member pharmacy belongs to that region (org-wide pools deliberately accept same-org pharmacies from any region — that is what "shareable" means) | `MEMBERSHIP_PHARMACY_REGION_MISMATCH` |
| 8 | future DutySchedule links: `validateLinkedScheduleTenantConsistency` exported, not yet called | — |
| 9 | future DutyAssignment links: `validateLinkedAssignmentTenantConsistency` exported, not yet called | — |

Any tenant issue **fails the entire load** (`TENANT_INTEGRITY_VIOLATION`)
and always outranks structural issues; tenant mismatches are never
downgraded to membership exclusions. The repository never filters
cross-tenant rows away — it returns them verbatim so validation rejects
loudly instead of the reference silently vanishing. Integration tests
create the real forbidden references (foreign-org pool on a slot,
foreign-org pharmacy in a membership) and prove detection.

## Structural validation (no partial acceptance, no hidden defaults)

`PLAN_CONFIGURATION_INVALID` with the full deterministic issue list:

- all six built-in day types present exactly once (`MISSING_DAY_TYPE`,
  `DUPLICATE_DAY_TYPE`) — `isServed: false` is an explicit decision, an
  absent row is not; custom categories must be non-empty and unambiguous
  per (dayType, category) (`AMBIGUOUS_CUSTOM_DAY_CATEGORY`)
- shift names unique per version (`DUPLICATE_SHIFT_NAME`); pool ids/names
  unique in the loaded context (`DUPLICATE_POOL_NAME`)
- every slot references a shift **inside this version** (the schema
  permits cross-version references — `UNKNOWN_SHIFT_REFERENCE`) and a
  pool present in the loaded graph (`UNKNOWN_POOL_REFERENCE`); slot
  natural key (rule, shift, sortOrder) unique (`DUPLICATE_SLOT`);
  `requiredCount >= 1` (`INVALID_REQUIRED_COUNT`)
- `validFrom <= validTo` as calendar days (`INVALID_VALIDITY_PERIOD`)
- membership ids unique (`DUPLICATE_MEMBERSHIP`); periods non-empty
  (`INVALID_MEMBERSHIP_PERIOD`); no overlapping periods per (pool,
  pharmacy) under `[joinedOn, leftOn)` (`OVERLAPPING_MEMBERSHIP`)
- rotation state: unique dayTypeScope per pool, integer
  `lockVersion >= 0` and `currentRound >= 0`, cursor membership must
  belong to the pool (`INVALID_ROTATION_STATE`); `carriedForward` must
  pass the existing validated schema (`rotation-state.ts`) AND reference
  only this pool's memberships (`INVALID_CARRIED_FORWARD`)
- a slot with `rotationPoolId: null` stays null (persisted "default pool
  semantics") and is surfaced as a `SLOT_WITHOUT_POOL` diagnostic — never
  substituted

Non-fatal **diagnostics** (deterministic order): `REGION_INACTIVE`,
`SLOT_ON_UNSERVED_DAY_TYPE`, `SERVED_DAY_TYPE_WITHOUT_SLOTS`,
`SLOT_WITHOUT_POOL`, `EFFECTIVE_DATE_OUTSIDE_VALIDITY`,
`POOL_EMPTY_AS_OF_EFFECTIVE_DATE`.

## Effective-date membership semantics (documented decision)

Per the schema's own lifecycle comment, active membership as of D is
`joinedAt <= D AND (leftAt IS NULL OR leftAt > D)`:

- **joinedOn INCLUSIVE** — a membership starting on D is eligible on D;
- **leftOn EXCLUSIVE** — a membership ending on D is already gone on D.

A transfer on day D (close old row with leftAt=D, open new row with
joinedAt=D) therefore yields exactly one membership on D — no gap, no
double membership; back-to-back periods are NOT overlaps. All DateTimes
normalize to UTC calendar days ("YYYY-MM-DD"). Exclusion reasons:
`NOT_YET_JOINED`, `LEFT_BEFORE_EFFECTIVE_DATE`, `PHARMACY_INACTIVE`.
Tenant/region mismatches are whole-load failures, never exclusions.
`resolvePoolMembershipAsOf` is pure and never touches `RotationState` —
no cursor advances, no mutation. Version validity uses an INCLUSIVE
`validTo` (last applicable calendar day) — coarse plan applicability,
distinct from the exclusive membership boundary; an out-of-validity
effectiveDate is a diagnostic, not an error (preview stays possible).

## Status policy matrix (pure helpers, loader loads all statuses)

| status | loadable | preview | simulate | commit |
|---|---|---|---|---|
| DRAFT | yes | yes | yes | no |
| UNDER_REVIEW | yes | yes | yes | no |
| APPROVED | yes | yes | yes | no |
| ACTIVE | yes | yes | yes | **yes** |
| RETIRED | yes | yes | no | no |
| ARCHIVED | yes | yes | no | no |

The loader reads any structurally valid version when explicitly requested
(auditing an ARCHIVED version's exact configuration is legitimate); what
a caller may DO with it is the policy helpers' answer. Nothing activates,
selects, or advances anything.

## Deterministic ordering and fingerprint

Ordering (plain code-point comparisons — never locale-dependent, so
Turkish characters cannot reorder anything between runs): day types in
built-in enum order then category; shifts by (sortOrder, name, id); slots
by (owning rule position, sortOrder, shift name, id); pools by (name,
id); memberships by (pharmacyId, joinedOn, id); states by dayTypeScope;
diagnostics by (code, subjectId); carriedForward keeps persisted order
(the ledger is a queue — its order is state).

**Fingerprint** = sha256 over `canonicalSerialize` (recursively
key-sorted JSON) of exactly: organizationId, regionId, validFrom,
validTo; day types (dayType, isServed, customDayCategory); shifts (name,
startMinute, endMinute, spansMidnight, defaultWeight, sortOrder); slots
(day-type key, **shift name**, **pool name** or null, requiredCount,
sortOrder, name); pools (name, strategy, regionId, memberships as
(pharmacyId, joinedOn, leftOn, sortIndex)). Children are referenced by
natural keys, never generated row ids — proven by the integration test
where a second version with identical configuration inserted in reverse
order fingerprints identically. **Excluded**: createdAt/updatedAt, status,
versionNumber, plan/version/child row ids, rotation-state progression
(cursor/round/lock), pharmacy names and active flags (tenant state, not
plan configuration), diagnostics, loader version, query/current time.
Tests assert a requiredCount/shift/membership change flips it and an
updatedAt/status/cursor change does not.

## Error-code catalogue

`DutyPlanLoaderError.code`: `PLAN_VERSION_NOT_FOUND` ·
`TENANT_INTEGRITY_VIOLATION` · `PLAN_CONFIGURATION_INVALID` ·
`INVALID_INPUT`. `error.issues[]` carries every detected
`{ code, subjectId }` (tenant codes first, then sorted) — subjectIds are
record ids or enum names ONLY; messages are generic Turkish and never
contain pharmacy/organization/plan content (asserted by tests).

## Read-only and security guarantees

- one scoped `findFirst`; no writes, no raw SQL, no dynamic query
  construction from user input;
- integration test snapshots row counts + every `updatedAt` before and
  after a load and asserts byte-identical state;
- no full-record logging (the loader logs nothing);
- the static tenant-safety scanner now covers all eight V2 models
  (`dutyPlan` … `rotationState`), so any future unscoped `prisma.*` call
  on them in `src/` fails the scan.

## Known database-level cross-tenant gaps (unchanged, by design)

The schema still physically permits: cross-org slot→pool, cross-org
membership→pharmacy, plan.organizationId ≠ plan.region.organizationId,
cross-region region-scoped pools, cross-version slot→shift. This phase
closes them **in the read path only**. The future write service must
validate the same set on every mutation (backlog item; do not redesign
the schema now).

## Deferred to later phases

- Write service (create/edit/version/activate) with ACTIVE-exclusivity
  (advisory lock + range check) and the same tenant validations.
- V2 engine (Phase 4) — consumes `LoadedDutyPlanVersion` directly:
  slots expanded in canonical order, pools resolved per effective date
  via `resolvePoolMembershipAsOf`, `canCommitFromPlanVersion` gating
  committed generation, fingerprint recorded with generated schedules
  for auditability.
- Schedule/assignment link validation goes live when those links are
  first written (`validateLinkedScheduleTenantConsistency` /
  `validateLinkedAssignmentTenantConsistency` already exported).
- Custom day-category calendar evaluation.

## Confirmations

No V2 plan was created/updated/activated by production code (tests write
only their own tracked fixtures in test databases); V1
(`generate-duty-schedule.ts`, `DutyRule`, `/kurallar`) is untouched; no
chamber, city, province, or district is hardcoded; there is no production
call site.
