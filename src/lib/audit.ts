import { prisma } from "@/lib/prisma";
import type { AuditAction } from "@prisma/client";

export async function writeAuditLog(params: {
  userId: string;
  action: AuditAction;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  dutyAssignmentId?: string;
}) {
  await prisma.auditLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
      before: params.before !== undefined ? JSON.stringify(params.before) : null,
      after: params.after !== undefined ? JSON.stringify(params.after) : null,
      dutyAssignmentId: params.dutyAssignmentId,
    },
  });
}
