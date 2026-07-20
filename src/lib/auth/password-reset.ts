import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { invalidateUserSessions } from "@/lib/auth/session";

// Token'ın kendisi (Session'daki gibi) tek başına gizli paylaşılan bir
// sırdır — 32 byte rastgele hex, DB'de düz metin saklanır (Session ile
// aynı yaklaşım, bkz. src/lib/auth/session.ts). Bir saldırganın veritabanı
// okuma erişimi zaten farklı bir tehdit sınıfıdır; burada önemli olan
// token'ın tahmin edilemez olmasıdır.
const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 1000 * 60 * 60; // 1 saat

// Bir kullanıcı için aynı anda en fazla bu kadar kullanılmamış/süresi
// dolmamış token bulunabilir — art arda çok sayıda "şifremi unuttum"
// isteği aynı kişinin gelen kutusunu e-posta ile doldurmasın diye basit
// bir üst sınır (bkz. requestSelfServicePasswordReset).
const MAX_ACTIVE_TOKENS_PER_USER = 3;

export type IssuePasswordResetTokenResult = {
  token: string;
  expiresAt: Date;
};

async function issueToken(
  userId: string,
  issuedByPlatformAdminId?: string
): Promise<IssuePasswordResetTokenResult> {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await prisma.passwordResetToken.create({
    data: { token, userId, expiresAt, issuedByPlatformAdminId },
  });
  return { token, expiresAt };
}

// Kendi kendine "şifremi unuttum" akışı için. E-posta sistemde kayıtlı
// olsun ya da olmasın DIŞARIYA aynı sonucu döner (enumeration'ı önlemek
// için) — bu fonksiyon yalnızca token üretimini/oran sınırlamasını yapar,
// e-posta gönderimi çağıran tarafın sorumluluğundadır.
export async function requestSelfServicePasswordReset(
  email: string
): Promise<IssuePasswordResetTokenResult | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: { email: { equals: normalizedEmail, mode: "insensitive" } },
    select: { id: true },
  });
  if (!user) return null;

  const activeCount = await prisma.passwordResetToken.count({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
  });
  if (activeCount >= MAX_ACTIVE_TOKENS_PER_USER) return null;

  return issueToken(user.id);
}

// Platform desteğinin, kilitlenmiş bir organizasyonun yöneticisi için
// SMTP'ye hiç ihtiyaç duymadan üretebildiği acil durum bağlantısı —
// platformAdminId, denetim izi için token'a issuedByPlatformAdminId olarak
// yazılır. Oran sınırlaması burada uygulanmaz (zaten dar yetkili,
// denetlenen bir rol tarafından bilinçli olarak tetiklenir).
export async function issueEmergencyPasswordResetToken(
  targetUserId: string,
  platformAdminId: string
): Promise<IssuePasswordResetTokenResult> {
  return issueToken(targetUserId, platformAdminId);
}

export type PasswordResetTokenStatus =
  | { valid: true }
  | { valid: false; reason: "not_found" | "used" | "expired" };

// Token'ı TÜKETMEDEN yalnızca geçerliliğini kontrol eder — sıfırlama
// sayfası bunu, formu göstermeden önce "bu bağlantı geçersiz/süresi
// dolmuş" durumunu erken tespit etmek için kullanır.
export async function checkPasswordResetToken(token: string): Promise<PasswordResetTokenStatus> {
  const row = await prisma.passwordResetToken.findUnique({
    where: { token },
    select: { usedAt: true, expiresAt: true },
  });
  if (!row) return { valid: false, reason: "not_found" };
  if (row.usedAt) return { valid: false, reason: "used" };
  if (row.expiresAt.getTime() < Date.now()) return { valid: false, reason: "expired" };
  return { valid: true };
}

export type ConsumePasswordResetTokenResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "not_found" | "used" | "expired" };

// Token'ı tüketir: şifreyi günceller, token'ı tek kullanımlık olarak
// işaretler, kullanıcının TÜM mevcut oturumlarını geçersiz kılar (şifre
// değişikliğinden sonraki standart davranış, bkz.
// src/lib/auth/session.ts'deki invalidateUserSessions). Hepsi tek bir
// transaction içinde — herhangi bir adım başarısız olursa hiçbiri kalıcı
// olmaz.
export async function consumePasswordResetToken(
  token: string,
  newPassword: string
): Promise<ConsumePasswordResetTokenResult> {
  const row = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!row) return { ok: false, reason: "not_found" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };

  const passwordHash = await hashPassword(newPassword);
  try {
    await prisma.$transaction(async (tx) => {
      // "usedAt: null" koşulu, aynı token'ın eşzamanlı iki isteğinden
      // yalnızca birinin bu satırı güncellemesini garanti eder (ikinci
      // istek count: 0 ile karşılaşır) — token'ın iki kez tüketilmesini
      // veritabanı seviyesinde engeller.
      const updated = await tx.passwordResetToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (updated.count === 0) {
        throw new Error("PASSWORD_RESET_TOKEN_ALREADY_CONSUMED");
      }
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
      await invalidateUserSessions(row.userId, tx);
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PASSWORD_RESET_TOKEN_ALREADY_CONSUMED") {
      return { ok: false, reason: "used" };
    }
    throw error;
  }

  return { ok: true, userId: row.userId };
}
