"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { requirePermissionOrRedirect, requirePermissionOrState } from "@/lib/auth/guard";
import { hashPassword } from "@/lib/auth/password";
import { clearSessionCookie, invalidateUserSessions } from "@/lib/auth/session";
import { assertLastActiveAdminNotRemoved, LastActiveAdminError } from "@/lib/auth/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { createUserSchema, updateUserSchema } from "@/lib/validations/user";
import { type ActionState, zodErrorState } from "@/lib/action-state";

const DUPLICATE_EMAIL_STATE: ActionState = {
  success: false,
  message: "Bu e-posta adresi zaten kullanılıyor.",
  errors: { email: ["Bu e-posta adresi zaten kullanılıyor."] },
};

// User tablosunda değiştirilebilir tek benzersiz alan email olduğundan, bu
// işlemlerin yazdığı transaction'larda oluşabilecek herhangi bir P2002 bu
// alandan kaynaklanır — ayrıca meta.target ayrıştırmaya gerek yoktur.
function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function sanitize(user: { name: string; email: string; role: string; isActive: boolean }) {
  return {
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
  };
}

export async function createUserAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requirePermissionOrState("manageUsers");
  if (!guard.user) return guard.state;
  const { user: currentUser } = guard;

  const parsed = createUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    password: formData.get("password"),
    passwordConfirmation: formData.get("passwordConfirmation"),
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const existing = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });
  if (existing) {
    return {
      success: false,
      message: "Bu e-posta adresi zaten kullanılıyor.",
      errors: { email: ["Bu e-posta adresi zaten kullanılıyor."] },
    };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: parsed.data.name,
          email: parsed.data.email,
          role: parsed.data.role,
          isActive: parsed.data.isActive,
          passwordHash,
        },
      });
      await writeAuditLog(tx, {
        userId: currentUser.id,
        action: "CREATE",
        entity: "User",
        entityId: created.id,
        after: sanitize(created),
      });
    });
  } catch (error) {
    // İki eşzamanlı istek aynı e-postayla kullanıcı oluşturmaya çalışırsa,
    // yukarıdaki `existing` kontrolünü ikisi de geçebilir; ikinci yazma
    // DB'nin benzersizlik kısıtına çarpar. Sıralı durumla aynı mesaja
    // eşleyip ham bir hata sayfası yerine anlaşılır bir yanıt döndürüyoruz.
    if (isUniqueConstraintError(error)) {
      return DUPLICATE_EMAIL_STATE;
    }
    throw error;
  }

  revalidatePath("/kullanicilar");
  redirectWithMessage("/kullanicilar", "success", "Kullanıcı oluşturuldu.");
}

export async function updateUserAction(
  id: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const guard = await requirePermissionOrState("manageUsers");
  if (!guard.user) return guard.state;
  const { user: currentUser } = guard;

  const parsed = updateUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    isActive: formData.get("isActive") === "on",
    password: formData.get("password"),
    passwordConfirmation: formData.get("passwordConfirmation"),
  });
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const before = await prisma.user.findUnique({ where: { id } });
  if (!before) {
    return { success: false, message: "Kullanıcı bulunamadı." };
  }

  const duplicate = await prisma.user.findFirst({
    where: { email: parsed.data.email, NOT: { id } },
  });
  if (duplicate) {
    return DUPLICATE_EMAIL_STATE;
  }

  const isDeactivatingSelf =
    before.id === currentUser.id && before.isActive && !parsed.data.isActive;
  if (isDeactivatingSelf) {
    return {
      success: false,
      message: "Kendi kullanıcı hesabınızı pasife alamazsınız.",
      errors: { isActive: ["Kendi kullanıcı hesabınızı pasife alamazsınız."] },
    };
  }

  const isDeactivatingAdmin = before.role === "ADMIN" && before.isActive && !parsed.data.isActive;

  const password = parsed.data.password?.trim();
  const passwordChanged = !!password;
  const newPasswordHash = passwordChanged ? await hashPassword(password) : undefined;

  // Şifre değişikliği ve o kullanıcının oturumlarının geçersiz kılınması aynı
  // veritabanı işlemi (transaction) içinde yapılır: oturum silme adımı
  // başarısız olursa şifre güncellemesi de geri alınır. Aksi halde, ikisi
  // ayrı yazımlar olsaydı, şifre değişip oturum silme başarısız olduğunda
  // eski (artık geçersiz kılınması gereken) oturum jetonları sessizce
  // geçerli kalabilirdi — tam olarak bu değişikliğin önlemesi gereken durum.
  //
  // "Son aktif yönetici" kontrolü de aynı transaction içinde, yazımdan hemen
  // önce ve bir advisory lock ile yapılır (bkz. assertLastActiveAdminNotRemoved)
  // — böylece iki farklı yöneticiyi eşzamanlı pasife alan iki istek aynı
  // (bayat) sayıyı okuyup ikisi de geçemez.
  try {
    await prisma.$transaction(async (tx) => {
      if (isDeactivatingAdmin) {
        await assertLastActiveAdminNotRemoved(tx);
      }

      const updated = await tx.user.update({
        where: { id },
        data: {
          name: parsed.data.name,
          email: parsed.data.email,
          role: parsed.data.role,
          isActive: parsed.data.isActive,
          ...(passwordChanged ? { passwordHash: newPasswordHash } : {}),
        },
      });

      if (passwordChanged) {
        await invalidateUserSessions(id, tx);
      }

      await writeAuditLog(tx, {
        userId: currentUser.id,
        action: "UPDATE",
        entity: "User",
        entityId: updated.id,
        before: sanitize(before),
        after: { ...sanitize(updated), passwordChanged },
      });
    });
  } catch (error) {
    if (error instanceof LastActiveAdminError) {
      return {
        success: false,
        message: error.message,
        errors: { isActive: [error.message] },
      };
    }
    if (isUniqueConstraintError(error)) {
      return DUPLICATE_EMAIL_STATE;
    }
    throw error;
  }

  revalidatePath("/kullanicilar");

  const isSelfPasswordChange = passwordChanged && before.id === currentUser.id;
  if (isSelfPasswordChange) {
    // Kendi şifresini değiştiren yönetici için kendi oturumu da az önce
    // silindi; tarayıcıdaki artık geçersiz çerezi temizleyip doğrudan
    // giriş ekranına yönlendir. Bu adım işlem başarıyla tamamlandıktan
    // SONRA çalışır — cookie/redirect asla bir transaction içine konmaz.
    await clearSessionCookie();
    redirectWithMessage(
      "/giris",
      "success",
      "Şifreniz güncellendi. Lütfen yeni şifrenizle tekrar giriş yapın."
    );
  }

  redirectWithMessage("/kullanicilar", "success", "Kullanıcı güncellendi.");
}

// İstenen hedef durum çağrıdan doğrudan alınır (bkz. eczaneler/actions.ts
// setPharmacyStatusAction yorumu) — çift gönderimde amaçlanan değişikliği
// sessizce iptal eden bir "toggle" değildir. Son aktif yönetici koruması
// aynen korunur.
export async function setUserStatusAction(id: string, isActive: boolean) {
  const currentUser = await requirePermissionOrRedirect("manageUsers", "/kullanicilar");

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    redirectWithMessage("/kullanicilar", "error", "Kullanıcı bulunamadı.");
  }

  const isDeactivatingAdmin = isActive === false && user.role === "ADMIN";

  if (isActive === false && user.id === currentUser.id) {
    redirectWithMessage(
      "/kullanicilar",
      "error",
      "Kendi kullanıcı hesabınızı pasife alamazsınız."
    );
  }

  // "Son aktif yönetici" kontrolü, yazımdan hemen önce aynı transaction
  // içinde ve bir advisory lock ile yapılır — bkz. updateUserAction'daki
  // aynı yorum ve assertLastActiveAdminNotRemoved.
  let updated: typeof user;
  try {
    updated = await prisma.$transaction(async (tx) => {
      if (isDeactivatingAdmin) {
        await assertLastActiveAdminNotRemoved(tx);
      }
      const next = await tx.user.update({
        where: { id },
        data: { isActive },
      });
      await writeAuditLog(tx, {
        userId: currentUser.id,
        action: "UPDATE",
        entity: "User",
        entityId: id,
        before: sanitize(user),
        after: sanitize(next),
      });
      return next;
    });
  } catch (error) {
    if (error instanceof LastActiveAdminError) {
      redirectWithMessage("/kullanicilar", "error", error.message);
    }
    throw error;
  }

  revalidatePath("/kullanicilar");
  redirectWithMessage(
    "/kullanicilar",
    "success",
    updated.isActive ? "Kullanıcı aktif yapıldı." : "Kullanıcı pasif yapıldı."
  );
}
