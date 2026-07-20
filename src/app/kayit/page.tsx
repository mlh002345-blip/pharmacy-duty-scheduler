import { Cross } from "lucide-react";

import { SelfServiceSignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

export default function KayitPage() {
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

        <h1 className="text-2xl font-semibold tracking-tight">Odanız İçin Hesap Oluşturun</h1>
        <p className="text-muted-foreground mt-1.5 text-sm">
          Odanızın bilgilerini ve ilk Yönetici hesabınızı oluşturun. Kayıt ücretsizdir; faturalama
          süreci ekibimizle ayrıca görüşülür.
        </p>

        <div className="mt-8">
          <SelfServiceSignupForm />
        </div>
      </div>
    </div>
  );
}
