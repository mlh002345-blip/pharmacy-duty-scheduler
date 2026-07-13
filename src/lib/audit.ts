import type { AuditAction, Prisma, PrismaClient } from "@prisma/client";

// Kritik işlemler için: iş mutasyonu ile denetim kaydı aynı veritabanı
// işlemi (transaction) içinde yazılmalıdır. Bu sayede denetim kaydı
// başarısız olursa mutasyon da geri alınır — kısmen uygulanmış, denetimsiz
// bir değişiklik asla kalıcı olmaz. Bu yüzden çağıran taraf ya global
// `prisma` istemcisini (kritik olmayan, bağımsız bir yazım için) ya da açık
// bir `tx` (transaction) istemcisini vermelidir; varsayılan bir istemciye
// sessizce düşülmez.
type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

export async function writeAuditLog(
  client: PrismaClientOrTx,
  params: {
    // Required, never optional/inferred — every audit entry must record
    // which tenant the action happened in. Always the acting user's own
    // session-derived organizationId (see src/lib/auth/tenant.ts), never
    // a client-supplied value.
    organizationId: string;
    userId: string;
    action: AuditAction;
    entity: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
    dutyAssignmentId?: string;
  }
) {
  await client.auditLog.create({
    data: {
      organizationId: params.organizationId,
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
