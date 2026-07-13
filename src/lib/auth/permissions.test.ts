import { describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";

import { hasPermission, type Permission } from "./permissions";

const ALL_ROLES: UserRole[] = ["PLATFORM_ADMIN", "ADMIN", "STAFF", "VIEWER"];

const ALL_PERMISSIONS: Permission[] = [
  "manageSetupData",
  "deleteSetupData",
  "generateSchedule",
  "editAssignment",
  "publishSchedule",
  "deleteSchedule",
  "exportSchedule",
  "manageUsers",
  "importPharmacies",
];

// The full role × permission matrix, as an explicit, reviewable table
// rather than a derived/programmatic list — a one-line change to
// ROLE_PERMISSIONS in permissions.ts that grants a role an extra
// permission (privilege escalation) or silently drops one (a broken
// feature) shows up as a failing cell here, not just an existence check.
const EXPECTED: Record<UserRole, Record<Permission, boolean>> = {
  // PLATFORM_ADMIN holds none of these organization-scoped permissions —
  // it manages Organizations themselves (src/lib/auth/platform.ts), not
  // any organization's data. See permissions.ts's own comment.
  PLATFORM_ADMIN: {
    manageSetupData: false,
    deleteSetupData: false,
    generateSchedule: false,
    editAssignment: false,
    publishSchedule: false,
    deleteSchedule: false,
    exportSchedule: false,
    manageUsers: false,
    importPharmacies: false,
  },
  ADMIN: {
    manageSetupData: true,
    deleteSetupData: true,
    generateSchedule: true,
    editAssignment: true,
    publishSchedule: true,
    deleteSchedule: true,
    exportSchedule: true,
    manageUsers: true,
    importPharmacies: true,
  },
  STAFF: {
    manageSetupData: true,
    deleteSetupData: false,
    generateSchedule: true,
    editAssignment: true,
    publishSchedule: true,
    deleteSchedule: false,
    exportSchedule: true,
    manageUsers: false,
    importPharmacies: false,
  },
  VIEWER: {
    manageSetupData: false,
    deleteSetupData: false,
    generateSchedule: false,
    editAssignment: false,
    publishSchedule: false,
    deleteSchedule: false,
    exportSchedule: true,
    manageUsers: false,
    importPharmacies: false,
  },
};

describe("hasPermission — full role × permission matrix", () => {
  for (const role of ALL_ROLES) {
    for (const permission of ALL_PERMISSIONS) {
      const expected = EXPECTED[role][permission];
      it(`${role} × ${permission} → ${expected}`, () => {
        expect(hasPermission(role, permission)).toBe(expected);
      });
    }
  }
});

describe("hasPermission — key security invariants stated explicitly", () => {
  it("ADMIN has every administrative permission that exists", () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(hasPermission("ADMIN", permission)).toBe(true);
    }
  });

  it("STAFF cannot manage users", () => {
    expect(hasPermission("STAFF", "manageUsers")).toBe(false);
  });

  it("STAFF cannot perform ADMIN-only destructive setup operations", () => {
    expect(hasPermission("STAFF", "deleteSetupData")).toBe(false);
  });

  it("STAFF cannot delete a published schedule", () => {
    expect(hasPermission("STAFF", "deleteSchedule")).toBe(false);
  });

  it("VIEWER cannot perform any mutation — only exportSchedule is granted", () => {
    const mutationPermissions = ALL_PERMISSIONS.filter((p) => p !== "exportSchedule");
    for (const permission of mutationPermissions) {
      expect(hasPermission("VIEWER", permission)).toBe(false);
    }
    expect(hasPermission("VIEWER", "exportSchedule")).toBe(true);
  });

  it("PLATFORM_ADMIN holds none of the organization-scoped permissions (it manages Organizations, never their data)", () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(hasPermission("PLATFORM_ADMIN", permission)).toBe(false);
    }
  });

  it("a permission not explicitly granted to a role is denied by default (fail-closed, not fail-open)", () => {
    // hasPermission's `?? false` fallback means an unrecognized role also
    // denies rather than throwing or defaulting to allow.
    expect(hasPermission("UNKNOWN_ROLE" as UserRole, "manageUsers")).toBe(false);
  });
});
