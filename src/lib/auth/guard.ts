import { redirect } from "next/navigation";
import type { User } from "@prisma/client";

import { redirectWithMessage } from "@/lib/flash-redirect";
import { getCurrentUser } from "./session";
import { hasPermission, type Permission } from "./permissions";

export const UNAUTHORIZED_MESSAGE = "Bu işlem için yetkiniz bulunmuyor.";

/**
 * For server actions that return an ActionState-shaped object on failure
 * (create/update forms driven by useActionState).
 */
export async function requirePermissionOrState(
  permission: Permission
): Promise<{ user: User } | { user: null; state: { success: false; message: string } }> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/giris");
  }
  if (!hasPermission(user.role, permission)) {
    return { user: null, state: { success: false, message: UNAUTHORIZED_MESSAGE } };
  }
  return { user };
}

/**
 * For server actions that redirect on failure instead of returning state
 * (delete/toggle/publish-style actions bound to a row button).
 */
export async function requirePermissionOrRedirect(
  permission: Permission,
  redirectPath: string
): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/giris");
  }
  if (!hasPermission(user.role, permission)) {
    redirectWithMessage(redirectPath, "error", UNAUTHORIZED_MESSAGE);
  }
  return user;
}
