import { redirect } from "next/navigation";
import type { User } from "@prisma/client";

import { redirectWithMessage } from "@/lib/flash-redirect";
import { logger } from "@/lib/observability/logger";
import { getRequestId } from "@/lib/observability/request-id";
import { getCurrentUser } from "./session";
import { hasPermission, type Permission } from "./permissions";

export const UNAUTHORIZED_MESSAGE = "Bu işlem için yetkiniz bulunmuyor.";

// Every ordinary (non-PLATFORM_ADMIN) authenticated user, narrowed so
// organizationId is known to be a real string, not `string | null`.
// organizationId is ALWAYS derived from the session here — never from a
// browser form, query parameter, hidden input, cookie value, or any
// other client-supplied source. See docs/architecture/MULTI_TENANCY.md.
export type OrganizationUser = User & { organizationId: string };

async function logTenantAccessDenied(context: {
  userId: string;
  reason: string;
  permission?: Permission;
}) {
  logger.warn("tenant_access_denied", {
    requestId: await getRequestId(),
    userId: context.userId,
    reason: context.reason,
    requiredPermission: context.permission,
  });
}

function isOrganizationUser(user: User): user is OrganizationUser {
  return user.organizationId !== null;
}

/**
 * For server actions returning an ActionState-shaped object on failure.
 * Redirects anonymous requests to /giris; rejects PLATFORM_ADMIN (which
 * has no organization) and any session somehow missing organizationId
 * with the same generic unauthorized state a permission failure would
 * get — never a distinct error that would let a caller distinguish
 * "wrong role" from "not part of an organization."
 */
export async function requireOrganizationUser(): Promise<
  { user: OrganizationUser } | { user: null; state: { success: false; message: string } }
> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/giris");
  }
  if (!isOrganizationUser(user)) {
    await logTenantAccessDenied({ userId: user.id, reason: "no_organization" });
    return { user: null, state: { success: false, message: UNAUTHORIZED_MESSAGE } };
  }
  return { user };
}

/**
 * Combines organization membership + a specific role permission — the
 * common case for every tenant-owned mutation/query in this app.
 */
export async function requireOrganizationRole(
  permission: Permission
): Promise<{ user: OrganizationUser } | { user: null; state: { success: false; message: string } }> {
  const result = await requireOrganizationUser();
  if (!result.user) return result;
  if (!hasPermission(result.user.role, permission)) {
    await logTenantAccessDenied({ userId: result.user.id, reason: "missing_permission", permission });
    return { user: null, state: { success: false, message: UNAUTHORIZED_MESSAGE } };
  }
  return { user: result.user };
}

/**
 * Redirect-on-failure variant (delete/toggle/publish-style actions, or
 * page-level guards), mirroring requirePermissionOrRedirect's shape but
 * additionally enforcing organization membership.
 */
export async function requireOrganizationRoleOrRedirect(
  permission: Permission,
  redirectPath: string,
  message: string = UNAUTHORIZED_MESSAGE
): Promise<OrganizationUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/giris");
  }
  if (!isOrganizationUser(user)) {
    await logTenantAccessDenied({ userId: user.id, reason: "no_organization" });
    redirectWithMessage(redirectPath, "error", message);
  }
  if (!hasPermission(user.role, permission)) {
    await logTenantAccessDenied({ userId: user.id, reason: "missing_permission", permission });
    redirectWithMessage(redirectPath, "error", message);
  }
  return user;
}

/**
 * Page-level guard: any authenticated organization member, regardless of
 * role (VIEWER included) — the equivalent of requireUser() but also
 * confirming the user belongs to an organization (never true for
 * PLATFORM_ADMIN, which has its own separate /platform area).
 */
export async function requireOrganizationMember(): Promise<OrganizationUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/giris");
  }
  if (!isOrganizationUser(user)) {
    redirect("/giris");
  }
  return user;
}
