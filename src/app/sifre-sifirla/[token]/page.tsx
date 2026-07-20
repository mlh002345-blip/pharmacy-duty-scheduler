import { AlertTriangle, Cross } from "lucide-react";

import { checkPasswordResetToken } from "@/lib/auth/password-reset";
import { ResetPasswordForm } from "./reset-form";

export const dynamic = "force-dynamic";

function InvalidTokenView() {
  return (
    <div className="bg-background flex min-h-screen flex-col items-center justify-center px-4 py-10 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
        <AlertTriangle className="size-7" />
      </div>
      <h1 className="mt-4 text-xl font-semibold tracking-tight">Bağlantı Geçersiz</h1>
      <p className="text-muted-foreground mt-1.5 max-w-sm text-sm">
        Bu şifre sıfırlama bağlantısı geçersiz, süresi dolmuş veya zaten kullanılmış.
        Lütfen yeni bir bağlantı talep edin.
      </p>
      <a
        href="/sifremi-unuttum"
        className="text-primary mt-4 text-sm font-medium underline-offset-2 hover:underline"
      >
        Yeni bağlantı talep et
      </a>
    </div>
  );
}

export default async function SifreSifirlaPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const status = await checkPasswordResetToken(token);
  if (!status.valid) return <InvalidTokenView />;

  return (
    <div className="bg-background flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <div className="bg-primary flex size-11 items-center justify-center rounded-2xl shadow-lg shadow-primary/25">
            <Cross className="size-5 text-white" strokeWidth={2.5} />
          </div>
          <div className="leading-tight">
            <p className="font-semibold tracking-tight">Nöbet Yönetimi</p>
            <p className="text-muted-foreground text-xs">Eczacı Odası Nöbet Çizelgeleme Sistemi</p>
          </div>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight">Yeni Şifre Belirle</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          Yeni şifrenizi girin. Kaydettikten sonra tüm cihazlardaki mevcut oturumlarınız
          sonlandırılacak.
        </p>

        <div className="mt-8">
          <ResetPasswordForm token={token} />
        </div>
      </div>
    </div>
  );
}
