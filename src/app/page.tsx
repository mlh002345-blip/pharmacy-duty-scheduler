import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  CalendarRange,
  ClipboardCheck,
  Cross,
  FileSpreadsheet,
  MapPin,
  ShieldCheck,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginIllustration } from "@/components/visuals/login-illustration";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    icon: CalendarRange,
    title: "Otomatik Nöbet Çizelgesi",
    description:
      "Asgari nöbet aralığı, mazeretler ve gün ağırlıkları (hafta içi/Cumartesi/Pazar/resmi ve dini bayram) dikkate alınarak kural tabanlı, adil bir çizelge tek tıkla oluşturulur.",
  },
  {
    icon: MapPin,
    title: "Vatandaşa Açık Nöbetçi Eczane Ekranı",
    description:
      "Yayınlanan çizelgeler, giriş gerektirmeyen herkese açık bir sayfada — haritalı, adres ve telefon bilgisiyle — anında görüntülenebilir.",
  },
  {
    icon: ClipboardCheck,
    title: "Manuel Düzenleme ve Denetim Kaydı",
    description:
      "Otomatik atamayı beğenmediğiniz bir günü elle değiştirebilirsiniz; kim, ne zaman, neyi değiştirdi bilgisi silinemez şekilde kayıt altına alınır.",
  },
  {
    icon: FileSpreadsheet,
    title: "Excel / PDF Dışa Aktarma",
    description:
      "Çizelgeler tek tıkla Excel veya PDF olarak indirilip yönetim kurulu toplantılarında veya resmi yazışmalarda kullanılabilir.",
  },
  {
    icon: Users,
    title: "Nöbet Dengesi Raporu",
    description:
      "Hangi eczanenin ne kadar nöbet tuttuğu, geçmiş nöbetler dahil, tek bakışta görülür — adaletli dağılım için.",
  },
  {
    icon: ShieldCheck,
    title: "KVKK Uyumlu, Çok Kiracılı Mimari",
    description:
      "Her oda kendi verisini görür; başka bir odanın verisine hiçbir şekilde erişilemez. KVKK Aydınlatma Metni ve Kullanım Şartları açıkça sunulur.",
  },
];

const STEPS = [
  {
    number: "1",
    title: "Odanız için ücretsiz hesap oluşturun",
    description: "Oda adı, il/bölge ve ilk Yönetici hesabınızın bilgilerini girin — anında kullanmaya başlayın.",
  },
  {
    number: "2",
    title: "Eczaneleri ve nöbet kurallarını tanımlayın",
    description: "Eczane listenizi elle veya Excel ile içe aktarın, bölge ve asgari nöbet aralığı gibi kuralları belirleyin.",
  },
  {
    number: "3",
    title: "Çizelgeyi oluşturun ve yayınlayın",
    description: "Sistem otomatik taslağı hazırlar; gözden geçirip yayınladığınız anda vatandaşlar görebilir.",
  },
];

export default async function AnaSayfaPage() {
  const user = await getCurrentUser();
  if (user?.organizationId) redirect("/panel");
  if (user?.role === "PLATFORM_ADMIN") redirect("/platform");

  return (
    <div className="bg-background min-h-screen">
      <header className="border-border/60 border-b">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="bg-primary flex size-9 items-center justify-center rounded-xl shadow-md shadow-primary/25">
              <Cross className="size-4 text-white" strokeWidth={2.5} />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight">Nöbet Yönetimi</p>
              <p className="text-muted-foreground text-[11px]">Eczacı Odası Nöbet Çizelgeleme Sistemi</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link href="/giris">Giriş Yap</Link>
            </Button>
            <Button asChild>
              <Link href="/kayit">Ücretsiz Başlayın</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:items-center lg:py-20">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
            Nöbetçi eczane çizelgesini, Excel yerine sistem hazırlasın
          </h1>
          <p className="text-muted-foreground mt-4 text-base leading-relaxed sm:text-lg">
            Eczacı odaları için hazırlanmış, kural tabanlı otomatik nöbet çizelgeleme sistemi.
            Manuel Excel takibi yerine; adil dağılım, denetlenebilir değişiklikler ve
            vatandaşlara açık bir nöbetçi eczane ekranı sunar.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <Link href="/kayit">Odanız İçin Ücretsiz Hesap Oluşturun</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/vatandas">Vatandaş Ekranını Görün</Link>
            </Button>
          </div>
          <p className="text-muted-foreground mt-3 text-xs">
            Kayıt ücretsizdir, ödeme bilgisi istenmez. Faturalama süreci ayrıca konuşulur.
          </p>
        </div>
        <div className="flex justify-center lg:justify-end">
          <LoginIllustration />
        </div>
      </section>

      <section className="border-border/60 bg-muted/30 border-y">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">
            Bir eczacı odasının nöbet sürecinde ihtiyaç duyduğu her şey
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <Card key={feature.title} className="border-border/60">
                <CardHeader className="flex flex-row items-start gap-3 space-y-0">
                  <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
                    <feature.icon className="size-5" />
                  </div>
                  <CardTitle className="text-base leading-tight">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground text-sm leading-relaxed">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
        <h2 className="text-center text-2xl font-semibold tracking-tight sm:text-3xl">Nasıl çalışır?</h2>
        <div className="mt-10 grid gap-8 sm:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.number} className="flex flex-col items-start gap-3">
              <div className="bg-primary flex size-9 items-center justify-center rounded-full text-sm font-semibold text-white">
                {step.number}
              </div>
              <h3 className="font-semibold">{step.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-border/60 border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-3 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-muted-foreground mt-0.5 size-5 shrink-0" />
            <p className="text-muted-foreground text-sm">
              Bu sistem yalnızca eczacı odaları için bir nöbet çizelgeleme aracıdır — ilaç
              stok yönetimi, ilaç satışı veya rezervasyon hizmeti sunmaz.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-border/60 border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-3 px-4 py-8 text-center sm:px-6">
          <p className="text-muted-foreground text-sm">
            Odanız için hemen{" "}
            <Link href="/kayit" className="text-primary font-medium underline-offset-2 hover:underline">
              ücretsiz hesap oluşturun
            </Link>{" "}
            veya zaten hesabınız varsa{" "}
            <Link href="/giris" className="text-primary font-medium underline-offset-2 hover:underline">
              giriş yapın
            </Link>
            .
          </p>
          <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
            <Link href="/gizlilik-politikasi" className="hover:underline">
              KVKK Aydınlatma Metni
            </Link>
            <Link href="/kullanim-sartlari" className="hover:underline">
              Kullanım Şartları
            </Link>
            <Link href="/vatandas" className="hover:underline">
              Vatandaş Ekranı
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
