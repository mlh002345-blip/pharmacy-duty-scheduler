import type { UserRole } from "@prisma/client";

export const ROLE_LABELS: Record<UserRole, string> = {
  PLATFORM_ADMIN: "Platform Yöneticisi",
  ADMIN: "Yönetici",
  STAFF: "Oda Yetkilisi",
  VIEWER: "Görüntüleyici",
};

export type Permission =
  | "manageSetupData"
  // Region mutation is deliberately narrower than general setup data:
  // regions define scheduling boundaries and (since region discovery)
  // can be created during pharmacy import — ADMIN only.
  | "manageRegions"
  | "deleteSetupData"
  | "generateSchedule"
  | "editAssignment"
  | "publishSchedule"
  | "deleteSchedule"
  | "exportSchedule"
  | "manageUsers"
  | "importPharmacies";

// PLATFORM_ADMIN intentionally holds none of these organization-scoped
// permissions — it manages Organizations themselves (see
// src/lib/auth/platform.ts), never an organization's own data. Granting
// it any of these would let a platform operator silently act inside a
// tenant, which docs/architecture/MULTI_TENANCY.md explicitly forbids.
const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  PLATFORM_ADMIN: [],
  ADMIN: [
    "manageSetupData",
    "manageRegions",
    "deleteSetupData",
    "generateSchedule",
    "editAssignment",
    "publishSchedule",
    "deleteSchedule",
    "exportSchedule",
    "manageUsers",
    "importPharmacies",
  ],
  STAFF: [
    "manageSetupData",
    "generateSchedule",
    "editAssignment",
    "publishSchedule",
    "exportSchedule",
  ],
  VIEWER: ["exportSchedule"],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
