// Duty Rules V2 — Phase 3: the tenant-safe, read-only plan loader.
//
// loadDutyPlanVersion(input) is the single entry point: it fetches ONE
// persisted DutyPlanVersion graph through the organization+region-scoped
// repository, rejects any cross-tenant reference or structural defect
// wholesale, and returns a plain, deterministic, engine-ready
// LoadedDutyPlanVersion. It answers "can this persisted V2 plan version
// be loaded safely, completely, and deterministically?" — and nothing
// else: no generation, no activation, no version selection, no writes.
//
// DETERMINISTIC ORDERING (canonical normalization):
//   - day-type rules: built-in enum order (WEEKDAY … HOLIDAY_EVE), then
//     customDayCategory (null first, then code-point order)
//   - shifts:      sortOrder, then name (code points), then id
//   - slots:       owning rule's canonical position, then sortOrder,
//                  then shift name, then id
//   - pools:       name (code points), then id
//   - memberships: pharmacyId, then joinedOn, then id
//   - states:      dayTypeScope (code points)
//   - diagnostics: code, then subjectId
//   - carriedForward entries keep their PERSISTED order — the ledger is
//     a queue whose order is itself state, not presentation.
// Comparisons are plain code-point comparisons, never locale-dependent:
// Turkish characters in names cannot change ordering between runs.
//
// FINGERPRINT (sha256 over canonical JSON) participates: organizationId,
// regionId, validFrom, validTo, day-type rules (dayType, isServed,
// customDayCategory), shifts (name, startMinute, endMinute,
// spansMidnight, defaultWeight, sortOrder), slots (owning day type +
// category, shift NAME, pool NAME or null, requiredCount, sortOrder,
// name), pools (name, strategy, regionId, memberships as pharmacyId,
// joinedOn, leftOn, sortIndex).
// Deliberately EXCLUDED: createdAt/updatedAt (audit), status,
// versionNumber, planId/planVersionId and all child row ids (two
// identical configurations fingerprint identically), rotation-state
// progression (cursor advances are runtime state, not configuration),
// pharmacy names/active flags (tenant state), diagnostics, loader
// version, query/current time.

import { createHash } from "node:crypto";

import { z } from "zod";

import type { PrismaClient } from "@prisma/client";

import {
  BUILTIN_DAY_TYPES,
  DUTY_PLAN_VERSION_STATUSES,
  ROTATION_STRATEGIES,
  type LoadedDutyPlanVersion,
  type LoadedRotationPool,
  type LoaderDiagnostic,
  type ResolvedPoolMembershipSnapshot,
} from "./domain/loaded-plan";
import { DutyPlanLoaderError, throwForIssues } from "./errors";
import { fetchDutyPlanVersionRecord } from "./plan-version-repository";
import { parseCarriedForward } from "./rotation-state";
import { toIsoDate, type PlanVersionRecord } from "./plan-version-record";
import { isIsoDateString, resolvePoolMembershipAsOf } from "./resolve-pool-membership";
import { canonicalSerialize } from "./v1-adapter";
import { validateStructure, validateTenantIntegrity } from "./validate-loaded-plan";

export const DUTY_PLAN_LOADER_VERSION = 1;

export type LoadDutyPlanVersionInput = {
  organizationId: string;
  regionId: string;
  planVersionId: string;
  /** Optional "YYYY-MM-DD": when present, per-pool membership snapshots
   *  are resolved as of this date. Omitting it loads configuration only. */
  effectiveDate?: string;
};

const inputSchema = z.object({
  organizationId: z.string().min(1),
  regionId: z.string().min(1),
  planVersionId: z.string().min(1),
  effectiveDate: z
    .string()
    .refine(isIsoDateString, { message: "effectiveDate must be YYYY-MM-DD" })
    .optional(),
});

const NOT_FOUND_MESSAGE = "Nöbet planı sürümü bulunamadı.";

/**
 * Load one persisted plan version for one organization and one region.
 * Throws DutyPlanLoaderError:
 *   - PLAN_VERSION_NOT_FOUND for unknown ids AND for versions belonging
 *     to another organization or region (indistinguishable by design —
 *     no tenant-existence disclosure),
 *   - TENANT_INTEGRITY_VIOLATION / PLAN_CONFIGURATION_INVALID with the
 *     full deterministic issue list otherwise,
 *   - INVALID_INPUT for malformed input.
 */
export async function loadDutyPlanVersion(
  rawInput: LoadDutyPlanVersionInput,
  db: PrismaClient | undefined = undefined
): Promise<LoadedDutyPlanVersion> {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new DutyPlanLoaderError("INVALID_INPUT", "Geçersiz yükleyici girdisi.");
  }
  const input = parsed.data;

  const record = await fetchDutyPlanVersionRecord(
    {
      organizationId: input.organizationId,
      regionId: input.regionId,
      planVersionId: input.planVersionId,
    },
    db
  );
  if (record === null) {
    throw new DutyPlanLoaderError("PLAN_VERSION_NOT_FOUND", NOT_FOUND_MESSAGE);
  }

  const issues = [
    ...validateTenantIntegrity(record, {
      organizationId: input.organizationId,
      regionId: input.regionId,
    }),
    ...validateStructure(record),
  ];
  if (issues.length > 0) {
    throwForIssues(issues);
  }

  return buildLoadedDutyPlanVersion(record, { effectiveDate: input.effectiveDate ?? null });
}

// ---------------------------------------------------------------------------
// Pure transformation: persistence DTO -> validated domain model.
// PRECONDITION: the record has passed validateTenantIntegrity and
// validateStructure (loadDutyPlanVersion guarantees this; unit tests that
// call this directly must construct valid records).
// ---------------------------------------------------------------------------

export type BuildContext = {
  effectiveDate: string | null;
};

export function buildLoadedDutyPlanVersion(
  record: PlanVersionRecord,
  context: BuildContext
): LoadedDutyPlanVersion {
  const status = parseEnumValue(DUTY_PLAN_VERSION_STATUSES, record.status, record.id);

  const dayTypeRules = record.dayTypeRules
    .map((rule) => ({
      id: rule.id,
      dayType: parseEnumValue(BUILTIN_DAY_TYPES, rule.dayType, rule.id),
      isServed: rule.isServed,
      customDayCategory: rule.customDayCategory,
    }))
    .sort((a, b) => {
      const orderA = BUILTIN_DAY_TYPES.indexOf(a.dayType);
      const orderB = BUILTIN_DAY_TYPES.indexOf(b.dayType);
      if (orderA !== orderB) return orderA - orderB;
      if (a.customDayCategory === b.customDayCategory) return compare(a.id, b.id);
      if (a.customDayCategory === null) return -1;
      if (b.customDayCategory === null) return 1;
      return compare(a.customDayCategory, b.customDayCategory);
    });

  const shiftDefinitions = record.shiftDefinitions
    .map((shift) => ({ ...shift }))
    .sort(
      (a, b) => a.sortOrder - b.sortOrder || compare(a.name, b.name) || compare(a.id, b.id)
    );
  const shiftNameById = new Map(shiftDefinitions.map((s) => [s.id, s.name]));

  const rulePositionById = new Map(dayTypeRules.map((rule, index) => [rule.id, index]));
  const slotRequirements = record.dayTypeRules
    .flatMap((rule) => rule.slotRequirements)
    .map((slot) => ({
      id: slot.id,
      name: slot.name,
      requiredCount: slot.requiredCount,
      sortOrder: slot.sortOrder,
      dayTypeRuleId: slot.dayTypeRuleId,
      shiftDefinitionId: slot.shiftDefinitionId,
      rotationPoolId: slot.rotationPoolId,
    }))
    .sort(
      (a, b) =>
        (rulePositionById.get(a.dayTypeRuleId) ?? 0) -
          (rulePositionById.get(b.dayTypeRuleId) ?? 0) ||
        a.sortOrder - b.sortOrder ||
        compare(shiftNameById.get(a.shiftDefinitionId) ?? "", shiftNameById.get(b.shiftDefinitionId) ?? "") ||
        compare(a.id, b.id)
    );

  const rotationPools: LoadedRotationPool[] = record.rotationPools
    .map((pool) => ({
      id: pool.id,
      name: pool.name,
      strategy: parseEnumValue(ROTATION_STRATEGIES, pool.strategy, pool.id),
      regionId: pool.regionId,
      memberships: pool.memberships
        .map((membership) => ({
          id: membership.id,
          pharmacyId: membership.pharmacyId,
          pharmacyName: membership.pharmacy.name,
          pharmacyIsActive: membership.pharmacy.isActive,
          joinedOn: toIsoDate(membership.joinedAt),
          leftOn: membership.leftAt === null ? null : toIsoDate(membership.leftAt),
          sortIndex: membership.sortIndex,
        }))
        .sort(
          (a, b) =>
            compare(a.pharmacyId, b.pharmacyId) || compare(a.joinedOn, b.joinedOn) || compare(a.id, b.id)
        ),
      rotationStates: pool.rotationStates
        .map((state) => ({
          id: state.id,
          dayTypeScope: state.dayTypeScope,
          currentRound: state.currentRound,
          lockVersion: state.lockVersion,
          // Persisted order preserved: the carry-forward ledger is a queue.
          // Re-parsed through the validated schema (validateStructure has
          // already guaranteed this parses; parsing again keeps this
          // function safe when unit tests call it directly).
          carriedForward: parseCarriedForward(state.carriedForward),
          lastServedMembershipId: state.lastServedMembershipId,
        }))
        .sort((a, b) => compare(a.dayTypeScope, b.dayTypeScope)),
    }))
    .sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id));

  const validFrom = toIsoDate(record.validFrom);
  const validTo = record.validTo === null ? null : toIsoDate(record.validTo);

  const diagnostics: LoaderDiagnostic[] = [];
  if (!record.plan.region.isActive) {
    diagnostics.push({ code: "REGION_INACTIVE", subjectId: record.plan.region.id });
  }
  const servedByRuleId = new Map(record.dayTypeRules.map((r) => [r.id, r.isServed]));
  for (const rule of record.dayTypeRules) {
    if (rule.isServed && rule.slotRequirements.length === 0) {
      diagnostics.push({ code: "SERVED_DAY_TYPE_WITHOUT_SLOTS", subjectId: rule.id });
    }
  }
  for (const slot of slotRequirements) {
    if (servedByRuleId.get(slot.dayTypeRuleId) === false) {
      diagnostics.push({ code: "SLOT_ON_UNSERVED_DAY_TYPE", subjectId: slot.id });
    }
    if (slot.rotationPoolId === null) {
      diagnostics.push({ code: "SLOT_WITHOUT_POOL", subjectId: slot.id });
    }
  }

  let membershipSnapshots: ResolvedPoolMembershipSnapshot[] | null = null;
  if (context.effectiveDate !== null) {
    // Validity is checked with an INCLUSIVE end: validTo is the last
    // calendar day the version applies to (coarse plan applicability —
    // distinct from the exclusive leftOn of memberships).
    if (
      context.effectiveDate < validFrom ||
      (validTo !== null && context.effectiveDate > validTo)
    ) {
      diagnostics.push({ code: "EFFECTIVE_DATE_OUTSIDE_VALIDITY", subjectId: record.id });
    }
    membershipSnapshots = rotationPools.map((pool) =>
      resolvePoolMembershipAsOf(pool, context.effectiveDate as string)
    );
    for (const snapshot of membershipSnapshots) {
      if (snapshot.eligible.length === 0) {
        diagnostics.push({ code: "POOL_EMPTY_AS_OF_EFFECTIVE_DATE", subjectId: snapshot.poolId });
      }
    }
  }
  diagnostics.sort((a, b) => compare(a.code, b.code) || compare(a.subjectId, b.subjectId));

  const configurationFingerprint = computeConfigurationFingerprint({
    organizationId: record.plan.organizationId,
    regionId: record.plan.regionId,
    validFrom,
    validTo,
    dayTypeRules,
    shiftDefinitions,
    slotRequirements,
    rotationPools,
    record,
  });

  return {
    loaderVersion: DUTY_PLAN_LOADER_VERSION,
    organizationId: record.plan.organizationId,
    regionId: record.plan.regionId,
    planId: record.plan.id,
    planName: record.plan.name,
    planVersionId: record.id,
    versionNumber: record.versionNumber,
    status,
    validFrom,
    validTo,
    configurationFingerprint,
    dayTypeRules,
    shiftDefinitions,
    slotRequirements,
    rotationPools,
    membershipSnapshots,
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Fingerprint.
// ---------------------------------------------------------------------------

type FingerprintInput = {
  organizationId: string;
  regionId: string;
  validFrom: string;
  validTo: string | null;
  dayTypeRules: LoadedDutyPlanVersion["dayTypeRules"];
  shiftDefinitions: LoadedDutyPlanVersion["shiftDefinitions"];
  slotRequirements: LoadedDutyPlanVersion["slotRequirements"];
  rotationPools: LoadedRotationPool[];
  record: PlanVersionRecord;
};

function computeConfigurationFingerprint(input: FingerprintInput): string {
  // Slots and pools are referenced by NATURAL keys (shift name, pool
  // name, day type + category) instead of database row ids, so two
  // byte-identical configurations produce the same fingerprint even when
  // their generated cuids differ.
  const shiftNameById = new Map(input.shiftDefinitions.map((s) => [s.id, s.name]));
  const poolNameById = new Map(input.rotationPools.map((p) => [p.id, p.name]));
  const ruleKeyById = new Map(
    input.dayTypeRules.map((r) => [r.id, `${r.dayType}|${r.customDayCategory ?? ""}`])
  );

  const payload = {
    organizationId: input.organizationId,
    regionId: input.regionId,
    validFrom: input.validFrom,
    validTo: input.validTo,
    dayTypes: input.dayTypeRules.map((rule) => ({
      dayType: rule.dayType,
      isServed: rule.isServed,
      customDayCategory: rule.customDayCategory,
    })),
    shifts: input.shiftDefinitions.map((shift) => ({
      name: shift.name,
      startMinute: shift.startMinute,
      endMinute: shift.endMinute,
      spansMidnight: shift.spansMidnight,
      defaultWeight: shift.defaultWeight,
      sortOrder: shift.sortOrder,
    })),
    slots: input.slotRequirements.map((slot) => ({
      dayTypeKey: ruleKeyById.get(slot.dayTypeRuleId) ?? "",
      shiftName: shiftNameById.get(slot.shiftDefinitionId) ?? "",
      poolName: slot.rotationPoolId === null ? null : (poolNameById.get(slot.rotationPoolId) ?? ""),
      requiredCount: slot.requiredCount,
      sortOrder: slot.sortOrder,
      name: slot.name,
    })),
    pools: input.rotationPools.map((pool) => ({
      name: pool.name,
      strategy: pool.strategy,
      regionId: pool.regionId,
      memberships: pool.memberships.map((membership) => ({
        pharmacyId: membership.pharmacyId,
        joinedOn: membership.joinedOn,
        leftOn: membership.leftOn,
        sortIndex: membership.sortIndex,
      })),
    })),
  };

  return createHash("sha256").update(canonicalSerialize(payload)).digest("hex");
}

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function parseEnumValue<T extends string>(
  allowed: readonly T[],
  value: string,
  subjectId: string
): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new DutyPlanLoaderError(
    "INVALID_INPUT",
    `Beklenmeyen kalıcı değer (${subjectId}).`
  );
}
