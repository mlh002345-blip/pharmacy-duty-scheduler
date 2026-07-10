"use server";

import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { type ActionState, zodErrorState } from "@/lib/action-state";
import { loginSchema } from "@/lib/validations/auth";
import { logger } from "@/lib/observability/logger";
import { getRequestId } from "@/lib/observability/request-id";
import { verifyPassword } from "./password";
import { createSession, destroySession } from "./session";

// Reason categories are for server-side operational logs only (e.g. spotting
// a credential-stuffing pattern) — never surfaced to the client, which
// always sees the same generic message regardless of reason, unchanged
// from before this logging was added.
async function logLoginFailure(reason: "unknown_account" | "invalid_password" | "inactive_account") {
  logger.warn("auth_login_failed", {
    requestId: await getRequestId(),
    reason,
  });
}

export async function loginAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
  });
  if (!user) {
    await logLoginFailure("unknown_account");
    return { success: false, message: "Hatalı e-posta veya şifre." };
  }

  const validPassword = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!validPassword) {
    await logLoginFailure("invalid_password");
    return { success: false, message: "Hatalı e-posta veya şifre." };
  }

  if (!user.isActive) {
    // Kasıtlı olarak diğer giriş hatalarıyla aynı genel mesaj kullanılır;
    // aksi halde bir e-postanın var olup olmadığı veya pasif bir hesaba ait
    // olduğu, kimlik doğrulaması yapılmadan dışarıdan anlaşılabilir. Sunucu
    // taraflı log kaydı bu genel mesajı etkilemez, yalnızca operasyonel
    // teşhis içindir.
    await logLoginFailure("inactive_account");
    return { success: false, message: "Hatalı e-posta veya şifre." };
  }

  logger.info("auth_login_succeeded", { requestId: await getRequestId(), userId: user.id });

  await createSession(user.id);
  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/giris");
}
