import type { Prisma } from "@prisma/client";

// "Sistemde en az bir aktif yönetici bulunmalıdır" kuralı, tek bir
// istekte okuma-sonra-yazma (check-then-act) ile korunuyordu: sayım ve
// güncelleme ayrı adımlardı. İki farklı yöneticiyi aynı anda pasife alan
// iki eşzamanlı istek, ikisi de aynı (henüz güncellenmemiş) sayıyı okuyup
// ikisi de geçebilir ve sistemde sıfır aktif yönetici kalabilirdi.
//
// Bunu önlemek için sayım + güncelleme, aynı transaction içinde, bir
// Postgres advisory lock (pg_advisory_xact_lock) ile serileştirilir.
// Aynı anahtarla kilit isteyen ikinci transaction, birincisi commit/
// rollback olup kilidi (transaction sonunda otomatik) bırakana kadar
// bekler; böylece ikinci transaction'ın sayımı her zaman birincinin
// sonucunu görür.
const ADMIN_GUARD_LOCK_KEY = "pharmacy-duty-scheduler:last-active-admin";

export class LastActiveAdminError extends Error {}

// Kural her organizasyon için ayrı ayrı geçerlidir — bir organizasyonun tek
// aktif yöneticisi, başka bir organizasyonda aktif yönetici bulunduğu için
// pasife alınabilir hale gelmemelidir. advisory lock anahtarı da organizasyon
// bazında ayrıştırılır ki farklı organizasyonlardaki eşzamanlı pasife alma
// istekleri birbirini gereksiz yere bloklamasın.
export async function assertLastActiveAdminNotRemoved(
  tx: Prisma.TransactionClient,
  organizationId: string
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ADMIN_GUARD_LOCK_KEY} || ':' || ${organizationId}))`;

  const activeAdminCount = await tx.user.count({
    where: { role: "ADMIN", isActive: true, organizationId },
  });
  if (activeAdminCount <= 1) {
    throw new LastActiveAdminError("Sistemde en az bir aktif yönetici bulunmalıdır.");
  }
}
