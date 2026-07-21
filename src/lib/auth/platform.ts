import { redirect } from "next/navigation";
import type { User } from "@prisma/client";

import { logger } from "@/lib/observability/logger";
import { getRequestId } from "@/lib/observability/request-id";
import { getCurrentUser } from "./session";

// Separately protected from every organization-scoped guard in
// src/lib/auth/tenant.ts — a PLATFORM_ADMIN can create/(de)activate
// Organizations, but this guard grants nothing else, and no
// organization-scoped guard ever accepts PLATFORM_ADMIN as a substitute
// role. See docs/architecture/MULTI_TENANCY.md.
export async function requirePlatformAdmin(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/giris");
  }
  if (user.role !== "PLATFORM_ADMIN") {
    logger.warn("tenant_access_denied", {
      requestId: await getRequestId(),
      userId: user.id,
      reason: "not_platform_admin",
    });
    redirect("/panel");
  }
  return user;
}
