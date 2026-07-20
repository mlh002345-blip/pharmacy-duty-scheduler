import Link from "next/link";
import { Cross } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-static";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm leading-relaxed">{children}</CardContent>
    </Card>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-foreground/90">{children}</p>;
}

export default function KullanimSartlariPage() {
  return (
    <div className="bg-background min-h-screen px-4 py-12">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div className="flex items-center gap-3">
          <div className="bg-primary flex size-11 items-center justify-center rounded-2xl shadow-lg shadow-primary/25">
            <Cross className="size-5 text-white" strokeWidth={2.5} />
          </div>
          <div className="leading-tight">
            <p className="font-semibold tracking-tight">Nöbet Yönetimi</p>
            <p className="text-muted-foreground text-xs">Eczacı Odası Nöbet Çizelgeleme Sistemi</p>
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Kullanım Şartları</h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            Bu sistemi kullanarak aşağıdaki şartları kabul etmiş olursunuz.
          </p>
        </div>

        <Section title="1. Hizmetin Kapsamı">
          <P>
            Bu sistem, eczacı odalarının nöbetçi eczane çizelgesini oluşturması, düzenlemesi,
            yayınlaması ve vatandaşlara duyurması için bir çizelgeleme aracıdır. İlaç stok
            yönetimi, ilaç satışı, ilaç rezervasyonu veya benzeri bir hizmet sunmaz.
          </P>
        </Section>

        <Section title="2. Hesap Oluşturma ve Sorumluluk">
          <ul className="list-disc pl-5">
            <li>
              <code className="rounded bg-muted px-1 py-0.5">/kayit</code> üzerinden bir oda
              hesabı oluşturan kişi, o oda için ilk Yönetici (ADMIN) rolündeki hesabın
              sahibidir ve girilen bilgilerin doğruluğundan sorumludur.
            </li>
            <li>
              Hesap bilgilerinin (özellikle şifrenin) gizliliğinden ve hesap üzerinden yapılan
              tüm işlemlerden hesap sahibi sorumludur.
            </li>
            <li>
              Kayıt anında ödeme alınmaz; faturalama/ücretlendirme süreci ayrıca ve manuel
              olarak, hizmet sağlayıcıyla doğrudan iletişim yoluyla yürütülür.
            </li>
          </ul>
        </Section>

        <Section title="3. Veri Doğruluğu ve Kullanımı">
          <P>
            Oda, sisteme girdiği eczane/eczacı bilgilerinin (nöbet çizelgesi oluşturmak ve
            vatandaşlara doğru bilgi sunmak amacıyla) doğru ve güncel olmasını sağlamakla
            yükümlüdür. Kişisel verilerin işlenmesine ilişkin ayrıntılar için{" "}
            <Link href="/gizlilik-politikasi" className="text-primary underline-offset-2 hover:underline">
              KVKK Aydınlatma Metni
            </Link>
            &apos;ni inceleyiniz.
          </P>
        </Section>

        <Section title="4. Hizmetin Sürekliliği">
          <P>
            Hizmet sağlayıcı, sistemi makul özenle işletmeyi taahhüt eder; ancak planlı bakım,
            altyapı sağlayıcısından kaynaklanan kesintiler veya mücbir sebepler nedeniyle
            hizmette kesinti olabilir. Kritik nöbet kararları için oda, kendi yedek
            süreçlerini (ör. son onaylı çizelgenin dışa aktarılmış bir kopyası) bulundurmalıdır.
          </P>
        </Section>

        <Section title="5. Kabul Edilemez Kullanım">
          <ul className="list-disc pl-5">
            <li>Sistemi otomatik araçlarla aşırı yükleme veya kötüye kullanma girişimleri.</li>
            <li>Başka bir odaya ait verilere yetkisiz erişim girişimi.</li>
            <li>Sahte veya yanıltıcı oda/kullanıcı bilgisiyle kayıt oluşturma.</li>
          </ul>
          <P>
            Bu tür kullanım tespit edildiğinde ilgili hesap/oda askıya alınabilir.
          </P>
        </Section>

        <Section title="6. Değişiklikler">
          <P>
            Bu şartlar zaman zaman güncellenebilir; önemli değişiklikler oda yetkilisine
            bildirilmeye çalışılır. Sistemi kullanmaya devam etmek, güncel şartların kabulü
            anlamına gelir.
          </P>
        </Section>

        <p className="text-muted-foreground text-center text-xs">
          Son güncelleme: 20.07.2026
        </p>

        <Link
          href="/kayit"
          className="text-primary text-center text-sm font-medium underline-offset-2 hover:underline"
        >
          Kayıt sayfasına dön
        </Link>
      </div>
    </div>
  );
}
