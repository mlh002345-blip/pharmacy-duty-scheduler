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
  | "importPharmacies"
  // Yarının nöbetçi eczanelerine hatırlatma e-postası gönderme
  // (bkz. src/lib/reminders/send-duty-reminders.ts). manageSetupData ile
  // aynı roller — iletişim de günlük operasyonel bir iş, ayrı bir yetki
  // sınıfı olarak değil, aynı gruplamada tutuldu.
  | "sendReminders"
  // Duty Rules V2 — Phase 11: day-type/shift/slot/pool/membership CRUD on
  // DRAFT plan versions. Granted to ADMIN and STAFF, matching
  // manageSetupData's pattern. Activating a version (which retires any
  // other ACTIVE version for the region) is a separate, ADMIN-only check
  // performed directly against user.role in the activation server
  // action — never via hasPermission — mirroring how Phase 10 gates
  // approve/publish (see cizelgeler/[id]/v2-lifecycle-actions.ts).
  | "managePlanConfiguration";

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
    "managePlanConfiguration",
    "sendReminders",
  ],
  STAFF: [
    "manageSetupData",
    "generateSchedule",
    "editAssignment",
    "publishSchedule",
    "exportSchedule",
    "managePlanConfiguration",
    "sendReminders",
  ],
  VIEWER: ["exportSchedule"],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
