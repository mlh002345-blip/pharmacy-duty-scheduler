import { Cross } from "lucide-react";

import { RequestPasswordResetForm } from "./request-form";

export const dynamic = "force-dynamic";

export default function SifremiUnuttumPage() {
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

        <h1 className="text-2xl font-semibold tracking-tight">Şifremi Unuttum</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          Hesabınıza kayıtlı e-posta adresinizi girin, size bir şifre sıfırlama bağlantısı
          gönderelim.
        </p>

        <div className="mt-8">
          <RequestPasswordResetForm />
        </div>
      </div>
    </div>
  );
}
