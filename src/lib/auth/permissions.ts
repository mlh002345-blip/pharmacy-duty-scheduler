import type { UserRole } from "@prisma/client";

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Yönetici",
  STAFF: "Oda Yetkilisi",
  VIEWER: "Görüntüleyici",
};

export type Permission =
  | "manageSetupData"
  | "deleteSetupData"
  | "generateSchedule"
  | "editAssignment"
  | "publishSchedule"
  | "deleteSchedule"
  | "exportSchedule"
  | "manageUsers";

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  ADMIN: [
    "manageSetupData",
    "deleteSetupData",
    "generateSchedule",
    "editAssignment",
    "publishSchedule",
    "deleteSchedule",
    "exportSchedule",
    "manageUsers",
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
