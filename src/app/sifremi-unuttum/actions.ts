"use server";

import { z } from "zod";

import { requestSelfServicePasswordReset } from "@/lib/auth/password-reset";
import { sendEmail } from "@/lib/email/send-email";
import { getAppBaseUrl } from "@/lib/http/base-url";
import { type ActionState } from "@/lib/action-state";

const emailSchema = z.string().trim().min(1).email();

// Bilinçli olarak enumeration'a kapalı: e-posta sistemde kayıtlı olsun ya
// da olmasın, format geçerliyse HER ZAMAN aynı genel mesaj döner. Kayıtlı
// bir e-postaysa arka planda bir token üretilip (SMTP yapılandırılmışsa)
// gönderilir; kayıtlı değilse hiçbir şey olmaz — ikisi de kullanıcıya
// aynı görünür.
const GENERIC_MESSAGE =
  "Bu e-posta adresi sistemde kayıtlıysa, şifre sıfırlama bağlantısı gönderildi. Gelen kutunuzu (ve spam klasörünü) kontrol edin.";

export async function requestPasswordResetAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return {
      success: false,
      message: "Lütfen geçerli bir e-posta adresi girin.",
      errors: { email: ["Lütfen geçerli bir e-posta adresi girin."] },
    };
  }

  const issued = await requestSelfServicePasswordReset(parsed.data);
  if (issued) {
    const baseUrl = await getAppBaseUrl();
    const link = `${baseUrl}/sifre-sifirla/${issued.token}`;
    await sendEmail({
      to: parsed.data,
      subject: "Şifre Sıfırlama Bağlantınız",
      text: `Şifrenizi sıfırlamak için şu bağlantıyı kullanın (1 saat geçerlidir): ${link}\n\nBu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz.`,
      html: `<p>Şifrenizi sıfırlamak için aşağıdaki bağlantıya tıklayın (1 saat geçerlidir):</p><p><a href="${link}">${link}</a></p><p>Bu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz.</p>`,
    });
  }

  return { success: true, message: GENERIC_MESSAGE };
}
