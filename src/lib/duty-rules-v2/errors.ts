// Duty Rules V2 — Phase 3: typed loader errors.
//
// Every failure the loader can produce is a DutyPlanLoaderError with a
// stable machine-readable code. Messages are Turkish, generic, and carry
// AT MOST record ids — never pharmacy names, organization names, or any
// other tenant content, and never any hint about whether a FOREIGN
// tenant's record exists (all cross-tenant lookups collapse into the
// same generic PLAN_VERSION_NOT_FOUND as a genuinely missing id).

/**
 * Tenant-integrity codes: the current database schema physically permits
 * these cross-tenant/cross-region references (see
 * docs/architecture/DUTY_RULES_V2_CORE_SCHEMA.md, backlog item on
 * cross-tenant FK consistency), so the loader must detect every one of
 * them in the service layer.
 */
export type LoaderTenantIssueCode =
  | "PLAN_REGION_ORGANIZATION_MISMATCH"
  | "POOL_ORGANIZATION_MISMATCH"
  | "POOL_REGION_MISMATCH"
  | "MEMBERSHIP_PHARMACY_ORGANIZATION_MISMATCH"
  | "MEMBERSHIP_PHARMACY_REGION_MISMATCH";

/** Structural codes: incomplete or contradictory persisted configuration. */
export type LoaderStructuralIssueCode =
  | "DUPLICATE_DAY_TYPE"
  | "MISSING_DAY_TYPE"
  | "AMBIGUOUS_CUSTOM_DAY_CATEGORY"
  | "DUPLICATE_SHIFT_NAME"
  | "DUPLICATE_SLOT"
  | "UNKNOWN_SHIFT_REFERENCE"
  | "UNKNOWN_POOL_REFERENCE"
  | "INVALID_REQUIRED_COUNT"
  | "INVALID_VALIDITY_PERIOD"
  | "DUPLICATE_POOL_NAME"
  | "DUPLICATE_MEMBERSHIP"
  | "OVERLAPPING_MEMBERSHIP"
  | "INVALID_MEMBERSHIP_PERIOD"
  | "INVALID_ROTATION_STATE"
  | "INVALID_CARRIED_FORWARD";

export type LoaderIssueCode = LoaderTenantIssueCode | LoaderStructuralIssueCode;

export type LoaderIssue = {
  code: LoaderIssueCode;
  /** The id (or stable key) of the offending record — ids only, never content. */
  subjectId: string;
};

export type DutyPlanLoaderErrorCode =
  | "PLAN_VERSION_NOT_FOUND"
  | "TENANT_INTEGRITY_VIOLATION"
  | "PLAN_CONFIGURATION_INVALID"
  | "INVALID_INPUT";

export class DutyPlanLoaderError extends Error {
  constructor(
    public readonly code: DutyPlanLoaderErrorCode,
    message: string,
    /** Every detected issue (tenant issues first), ids only. */
    public readonly issues: LoaderIssue[] = []
  ) {
    super(message);
    this.name = "DutyPlanLoaderError";
  }
}

const TENANT_ISSUE_CODES: ReadonlySet<string> = new Set([
  "PLAN_REGION_ORGANIZATION_MISMATCH",
  "POOL_ORGANIZATION_MISMATCH",
  "POOL_REGION_MISMATCH",
  "MEMBERSHIP_PHARMACY_ORGANIZATION_MISMATCH",
  "MEMBERSHIP_PHARMACY_REGION_MISMATCH",
] satisfies LoaderTenantIssueCode[]);

export function isTenantIssue(issue: LoaderIssue): boolean {
  return TENANT_ISSUE_CODES.has(issue.code);
}

/**
 * Collapse a validated issue list into the single error the loader
 * throws. Tenant-integrity issues dominate: a configuration that points
 * at another tenant's data must never be reported as a mere structural
 * problem. Issues are sorted deterministically (code, then subjectId) so
 * the same database state always produces byte-identical error payloads.
 */
export function throwForIssues(issues: LoaderIssue[]): never {
  const sorted = [...issues].sort((a, b) =>
    a.code < b.code ? -1 : a.code > b.code ? 1 : a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0
  );
  const tenant = sorted.filter(isTenantIssue);
  if (tenant.length > 0) {
    throw new DutyPlanLoaderError(
      "TENANT_INTEGRITY_VIOLATION",
      "Plan yapılandırması kiracı bütünlüğü doğrulamasından geçemedi.",
      [...tenant, ...sorted.filter((i) => !isTenantIssue(i))]
    );
  }
  throw new DutyPlanLoaderError(
    "PLAN_CONFIGURATION_INVALID",
    "Plan yapılandırması eksik veya çelişkili.",
    sorted
  );
}
