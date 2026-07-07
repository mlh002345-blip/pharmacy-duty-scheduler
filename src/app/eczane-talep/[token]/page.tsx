import { AlertTriangle, Cross, MapPin } from "lucide-react";

import { prisma } from "@/lib/prisma";
import { createPublicDutyRequestAction } from "./actions";
import { PublicRequestForm } from "./public-request-form";

export const dynamic = "force-dynamic";

function InvalidTokenPage() {
  return (
    <div className="bg-background flex min-h-screen flex-col items-center justify-center px-4 py-10 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
        <AlertTriangle className="size-7" />
      </div>
      <h1 className="mt-4 text-xl font-semibold tracking-tight">Bağlantı Geçersiz</h1>
      <p className="text-muted-foreground mt-1.5 max-w-sm text-sm">
        Bu nöbet talep bağlantısı geçersiz, süresi dolmuş veya artık kullanılamıyor.
        Lütfen eczacı odası ile iletişime geçerek güncel bağlantıyı isteyin.
      </p>
    </div>
  );
}

// Eczaneye özel, token korumalı nöbet talep formu. Giriş gerektirmez;
// yalnızca bağlantıdaki token'a sahip eczanenin adını gösterir ve talep
// oluşturur. Yönetim verisi veya diğer talepler bu sayfadan görüntülenemez.
export default async function EczaneTalepPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const pharmacy = await prisma.pharmacy.findUnique({
    where: { requestToken: token },
    select: {
      name: true,
      isActive: true,
      region: { select: { name: true } },
    },
  });
  if (!pharmacy || !pharmacy.isActive) return <InvalidTokenPage />;

  return (
    <div className="bg-background flex min-h-screen flex-col items-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-lg">
        <div className="flex flex-col items-center text-center">
          <div className="bg-primary flex size-12 items-center justify-center rounded-2xl shadow-lg shadow-primary/25">
            <Cross className="size-6 text-white" strokeWidth={2.5} />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            Nöbet Talep Formu
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            Nöbet tutamama, tercih ve değişiklik taleplerinizi eczacı odasına buradan
            iletebilirsiniz.
          </p>
        </div>

        <div className="mt-6 rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
              <Cross className="size-4" strokeWidth={2.5} />
            </span>
            <div>
              <p className="font-semibold">{pharmacy.name}</p>
              <p className="text-muted-foreground flex items-center gap-1 text-xs">
                <MapPin className="size-3" />
                {pharmacy.region.name} bölgesi
              </p>
            </div>
          </div>

          <PublicRequestForm action={createPublicDutyRequestAction.bind(null, token)} />
        </div>

        <p className="text-muted-foreground mt-6 text-center text-xs">
          Bu bağlantı eczanenize özeldir; lütfen üçüncü kişilerle paylaşmayın. Talepler
          eczacı odası tarafından incelendikten sonra çizelgeye yansıtılır.
        </p>
      </div>
    </div>
  );
}
