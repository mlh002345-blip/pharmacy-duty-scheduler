import { redirect } from "next/navigation";
import type { User } from "@prisma/client";

import { redirectWithMessage } from "@/lib/flash-redirect";
import { logger } from "@/lib/observability/logger";
import { getRequestId } from "@/lib/observability/request-id";
import { getCurrentUser } from "./session";
import { hasPermission, type Permission } from "./permissions";

export const UNAUTHORIZED_MESSAGE = "Bu işlem için yetkiniz bulunmuyor.";

// Logs an authenticated-but-under-privileged access attempt. Deliberately
// does NOT cover the "no session at all" redirect to /giris — that's just
// "not logged in" and would fire on every anonymous page view, which is
// the noisy-access-logging this app is avoiding (see
// docs/security/16-logging-observability-auditability.md).
async function logAuthorizationDenied(context: {
  userId: string;
  permission: Permission;
  redirectPath?: string;
}) {
  logger.warn("authorization_denied", {
    requestId: await getRequestId(),
    userId: context.userId,
    requiredPermission: context.permission,
    redirectPath: context.redirectPath,
  });
}

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
    await logAuthorizationDenied({ userId: user.id, permission });
    return { user: null, state: { success: false, message: UNAUTHORIZED_MESSAGE } };
  }
  return { user };
}

/**
 * For server actions that redirect on failure instead of returning state
 * (delete/toggle/publish-style actions bound to a row button), or for
 * guarding a page itself with a custom unauthorized message.
 */
export async function requirePermissionOrRedirectWithMessage(
  permission: Permission,
  redirectPath: string,
  message: string
): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/giris");
  }
  if (!hasPermission(user.role, permission)) {
    await logAuthorizationDenied({ userId: user.id, permission, redirectPath });
    redirectWithMessage(redirectPath, "error", message);
  }
  return user;
}

export async function requirePermissionOrRedirect(
  permission: Permission,
  redirectPath: string
): Promise<User> {
  return requirePermissionOrRedirectWithMessage(
    permission,
    redirectPath,
    UNAUTHORIZED_MESSAGE
  );
}
