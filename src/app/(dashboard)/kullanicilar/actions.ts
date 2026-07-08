"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requirePermissionOrRedirect, requirePermissionOrState } from "@/lib/auth/guard";
import { hashPassword } from "@/lib/auth/password";
import { clearSessionCookie, invalidateUserSessions } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { createUserSchema, updateUserSchema } from "@/lib/validations/user";
import { type ActionState, zodErrorState } from "@/lib/action-state";

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
  const created = await prisma.user.create({
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      role: parsed.data.role,
      isActive: parsed.data.isActive,
      passwordHash,
    },
  });

  await writeAuditLog({
    userId: currentUser.id,
    action: "CREATE",
    entity: "User",
    entityId: created.id,
    after: sanitize(created),
  });

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
    return {
      success: false,
      message: "Bu e-posta adresi zaten kullanılıyor.",
      errors: { email: ["Bu e-posta adresi zaten kullanılıyor."] },
    };
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
  if (isDeactivatingAdmin) {
    const activeAdminCount = await prisma.user.count({
      where: { role: "ADMIN", isActive: true },
    });
    if (activeAdminCount <= 1) {
      return {
        success: false,
        message: "Sistemde en az bir aktif yönetici bulunmalıdır.",
        errors: { isActive: ["Sistemde en az bir aktif yönetici bulunmalıdır."] },
      };
    }
  }

  const password = parsed.data.password?.trim();
  const passwordChanged = !!password;

  const updated = await prisma.user.update({
    where: { id },
    data: {
      name: parsed.data.name,
      email: parsed.data.email,
      role: parsed.data.role,
      isActive: parsed.data.isActive,
      ...(passwordChanged ? { passwordHash: await hashPassword(password) } : {}),
    },
  });

  if (passwordChanged) {
    // Şifre değişikliği, o kullanıcının açık olan tüm oturumlarını
    // geçersiz kılar — eski şifreyle alınmış bir oturum jetonu artık
    // kullanılamaz.
    await invalidateUserSessions(id);
  }

  await writeAuditLog({
    userId: currentUser.id,
    action: "UPDATE",
    entity: "User",
    entityId: updated.id,
    before: sanitize(before),
    after: { ...sanitize(updated), passwordChanged },
  });

  revalidatePath("/kullanicilar");

  const isSelfPasswordChange = passwordChanged && before.id === currentUser.id;
  if (isSelfPasswordChange) {
    // Kendi şifresini değiştiren yönetici için kendi oturumu da az önce
    // silindi; tarayıcıdaki artık geçersiz çerezi temizleyip doğrudan
    // giriş ekranına yönlendir.
    await clearSessionCookie();
    redirectWithMessage(
      "/giris",
      "success",
      "Şifreniz güncellendi. Lütfen yeni şifrenizle tekrar giriş yapın."
    );
  }

  redirectWithMessage("/kullanicilar", "success", "Kullanıcı güncellendi.");
}

export async function toggleUserStatusAction(id: string) {
  const currentUser = await requirePermissionOrRedirect("manageUsers", "/kullanicilar");

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    redirectWithMessage("/kullanicilar", "error", "Kullanıcı bulunamadı.");
  }

  const nextIsActive = !user.isActive;

  if (nextIsActive === false) {
    if (user.id === currentUser.id) {
      redirectWithMessage(
        "/kullanicilar",
        "error",
        "Kendi kullanıcı hesabınızı pasife alamazsınız."
      );
    }
    if (user.role === "ADMIN") {
      const activeAdminCount = await prisma.user.count({
        where: { role: "ADMIN", isActive: true },
      });
      if (activeAdminCount <= 1) {
        redirectWithMessage(
          "/kullanicilar",
          "error",
          "Sistemde en az bir aktif yönetici bulunmalıdır."
        );
      }
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { isActive: nextIsActive },
  });

  await writeAuditLog({
    userId: currentUser.id,
    action: "UPDATE",
    entity: "User",
    entityId: id,
    before: sanitize(user),
    after: sanitize(updated),
  });

  revalidatePath("/kullanicilar");
  redirectWithMessage(
    "/kullanicilar",
    "success",
    updated.isActive ? "Kullanıcı aktif yapıldı." : "Kullanıcı pasif yapıldı."
  );
}
