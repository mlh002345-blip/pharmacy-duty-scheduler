"use server";

import { consumePasswordResetToken } from "@/lib/auth/password-reset";
import { redirectWithMessage } from "@/lib/flash-redirect";
import { resetPasswordSchema } from "@/lib/validations/user";
import { type ActionState, zodErrorState } from "@/lib/action-state";

const INVALID_TOKEN_STATE: ActionState = {
  success: false,
  message: "Bu bağlantı geçersiz, süresi dolmuş veya zaten kullanılmış.",
};

export async function resetPasswordAction(
  token: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    passwordConfirmation: formData.get("passwordConfirmation"),
  });
  if (!parsed.success) {
    return zodErrorState(parsed.error, "Lütfen formdaki hataları düzeltin.");
  }

  const result = await consumePasswordResetToken(token, parsed.data.password);
  if (!result.ok) {
    return INVALID_TOKEN_STATE;
  }

  redirectWithMessage(
    "/giris",
    "success",
    "Şifreniz güncellendi. Lütfen yeni şifrenizle giriş yapın."
  );
}
