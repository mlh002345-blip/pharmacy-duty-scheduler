// Duty Rules V2 — Phase 3: pure version-status policy helpers.
//
// The LOADER reads any structurally valid version when explicitly
// requested (previewing an ARCHIVED version's exact historical
// configuration is a legitimate audit operation). WHAT a caller may do
// with the loaded version is a separate, pure policy decision — kept out
// of the loader so future phases (simulation, committed generation,
// activation) share one authority instead of re-deriving status rules.
//
// Status matrix (DutyPlanVersionStatus, see prisma/schema.prisma):
//
//   status        loadable  preview  simulate  commit   meaning
//   DRAFT         yes       yes      yes       no       editable working copy
//   UNDER_REVIEW  yes       yes      yes       no       submitted, edit-frozen by service layer
//   APPROVED      yes       yes      yes       no       accepted, awaiting activation
//   ACTIVE        yes       yes      yes       yes      the only status committed generation may use
//   RETIRED       yes       yes      no        no       superseded; kept for history/audit
//   ARCHIVED      yes       yes      no        no       shelved; kept for history/audit
//
// NOTHING here activates a version, selects a "current" version, or
// mutates state — these are pure functions over a status value.

import type { DutyPlanVersionStatusValue } from "./domain/loaded-plan";

/** Every status may be previewed: reading a version's configuration is
 *  always allowed once the tenant-scoped loader has produced it. */
export function canPreviewPlanVersion(status: DutyPlanVersionStatusValue): boolean {
  switch (status) {
    case "DRAFT":
    case "UNDER_REVIEW":
    case "APPROVED":
    case "ACTIVE":
    case "RETIRED":
    case "ARCHIVED":
      return true;
  }
}

/** Simulation (trial generation with NO persisted output) is meaningful
 *  only for versions that could still shape the future. */
export function canSimulatePlanVersion(status: DutyPlanVersionStatusValue): boolean {
  switch (status) {
    case "DRAFT":
    case "UNDER_REVIEW":
    case "APPROVED":
    case "ACTIVE":
      return true;
    case "RETIRED":
    case "ARCHIVED":
      return false;
  }
}

/** Committed schedule generation may only ever run from ACTIVE. */
export function canCommitFromPlanVersion(status: DutyPlanVersionStatusValue): boolean {
  return status === "ACTIVE";
}
