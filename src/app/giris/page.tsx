import { redirect } from "next/navigation";
import { CalendarRange, Cross, MapPin, ShieldCheck } from "lucide-react";

import { getCurrentUser } from "@/lib/auth/session";
import { LoginIllustration } from "@/components/visuals/login-illustration";
import { LoginForm } from "./login-form";

const FEATURES = [
  {
    icon: CalendarRange,
    text: "Kural tabanlı otomatik aylık nöbet çizelgesi",
  },
  {
    icon: MapPin,
    text: "Vatandaşlar için herkese açık nöbetçi eczane ekranı",
  },
  {
    icon: ShieldCheck,
    text: "Denetim kaydı ve rol tabanlı yetkilendirme",
  },
];

export default async function GirisPage() {
  const user = await getCurrentUser();
  // An already-logged-in organization member goes to the dashboard;
  // PLATFORM_ADMIN (organizationId: null by design) goes to its own
  // separately-guarded /platform area instead — never to "/", which
  // requires organization membership (requireOrganizationMember) and
  // would redirect PLATFORM_ADMIN straight back here, looping.
  if (user?.organizationId) redirect("/");
  if (user?.role === "PLATFORM_ADMIN") redirect("/platform");

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Sol: giriş formu */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-20">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-10 flex items-center gap-3">
            <div className="bg-primary flex size-11 items-center justify-center rounded-2xl shadow-lg shadow-primary/25">
              <Cross className="size-5 text-white" strokeWidth={2.5} />
            </div>
            <div className="leading-tight">
              <p className="font-semibold tracking-tight">Nöbet Yönetimi</p>
              <p className="text-muted-foreground text-xs">Eczacı Odası Nöbet Çizelgeleme Sistemi</p>
            </div>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">Giriş Yap</h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            Nöbet yönetim panelinize erişmek için hesabınızla giriş yapın.
          </p>

          <div className="mt-8">
            <LoginForm />
          </div>

          <p className="text-muted-foreground mt-10 text-center text-xs">
            Bu sistem eczacı odası yetkilileri içindir. Nöbetçi eczaneler için{" "}
            <a href="/vatandas" className="text-primary font-medium underline-offset-2 hover:underline">
              vatandaş ekranını
            </a>{" "}
            ziyaret edebilirsiniz.
          </p>
        </div>
      </div>

      {/* Sağ: illüstrasyon paneli */}
      <div className="relative hidden overflow-hidden bg-navy lg:flex lg:flex-col lg:justify-center">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(80% 60% at 70% 20%, oklch(0.42 0.08 200 / 0.55) 0%, transparent 60%), radial-gradient(70% 50% at 20% 90%, oklch(0.5 0.1 163 / 0.35) 0%, transparent 60%)",
          }}
        />
        <div className="relative z-10 flex flex-col items-center gap-10 px-12 py-16">
          <LoginIllustration />
          <div className="max-w-md text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-white">
              Nöbet çizelgeleri artık tek merkezden
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-white/65">
              Eczane, bölge ve kural yönetiminden otomatik çizelgelemeye; nöbet yükü
              analizinden vatandaş ekranına kadar tüm nöbet süreci tek sistemde.
            </p>
          </div>
          <ul className="flex flex-col gap-3">
            {FEATURES.map((feature) => (
              <li key={feature.text} className="flex items-center gap-3 text-sm text-white/80">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <feature.icon className="size-4 text-emerald-300" />
                </span>
                {feature.text}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
