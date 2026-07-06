"use server";

import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { type ActionState, zodErrorState } from "@/lib/action-state";
import { loginSchema } from "@/lib/validations/auth";
import { verifyPassword } from "./password";
import { createSession, destroySession } from "./session";

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
    return { success: false, message: "Hatalı e-posta veya şifre." };
  }

  const validPassword = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!validPassword) {
    return { success: false, message: "Hatalı e-posta veya şifre." };
  }

  if (!user.isActive) {
    return { success: false, message: "Kullanıcı hesabı pasif durumdadır." };
  }

  await createSession(user.id);
  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/giris");
}
