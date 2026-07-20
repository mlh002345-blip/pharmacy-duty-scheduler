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

export default function GizlilikPolitikasiPage() {
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
          <h1 className="text-2xl font-semibold tracking-tight">
            KVKK Aydınlatma Metni ve Gizlilik Politikası
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            6698 sayılı Kişisel Verilerin Korunması Kanunu (&quot;KVKK&quot;) kapsamında, veri
            sorumlusu sıfatıyla ilgili kişileri bilgilendirme yükümlülüğümüz gereği hazırlanmıştır.
          </p>
        </div>

        <Section title="1. Veri Sorumlusu">
          <P>
            Bu sistem, kayıt sırasında oluşturulan her oda (eczacı odası) için o odayı yöneten
            eczacı odası tarafından işletilir. Sistemin teknik altyapısını sağlayan taraf, veri
            işleyen sıfatıyla hareket eder; kişisel verilerin işlenme amacını ve araçlarını
            belirleyen veri sorumlusu, kayıt olan odanın kendisidir.
          </P>
        </Section>

        <Section title="2. İşlenen Kişisel Veri Kategorileri">
          <P>Sistem üzerinde aşağıdaki kişisel veri kategorileri işlenmektedir:</P>
          <ul className="list-disc pl-5">
            <li>
              <strong>Kullanıcı hesap bilgileri:</strong> ad soyad, e-posta adresi, rol bilgisi,
              şifre (geri döndürülemez biçimde hashlenerek saklanır).
            </li>
            <li>
              <strong>Eczane/eczacı iletişim bilgileri:</strong> eczane adı, eczacı adı, telefon,
              adres, konum bilgisi.
            </li>
            <li>
              <strong>İşlem kayıtları (denetim kaydı):</strong> hangi kullanıcının hangi
              değişikliği ne zaman yaptığı bilgisi — nöbet ataması değişiklikleri, kullanıcı/oda
              yönetimi işlemleri.
            </li>
            <li>
              <strong>Teknik kayıtlar:</strong> oturum bilgisi, giriş denemesi zaman damgaları
              (kötüye kullanımı önlemek amacıyla).
            </li>
          </ul>
        </Section>

        <Section title="3. İşleme Amaçları">
          <ul className="list-disc pl-5">
            <li>Nöbet çizelgesi oluşturma, yönetme ve yayınlama hizmetinin sunulması.</li>
            <li>Kullanıcı hesabı oluşturma, kimlik doğrulama ve yetkilendirme.</li>
            <li>Nöbetçi eczane bilgisinin vatandaşlara halka açık ekranda gösterilmesi.</li>
            <li>Değişikliklerin denetlenebilirliğinin sağlanması (audit log).</li>
            <li>Hizmetin güvenliğinin ve kötüye kullanıma karşı korunmasının sağlanması.</li>
          </ul>
        </Section>

        <Section title="4. Hukuki Sebep">
          <P>
            Kişisel veriler, KVKK m.5/2 kapsamında sözleşmenin kurulması/ifası (hizmetin
            sunulabilmesi için gerekli olması) ve veri sorumlusunun meşru menfaati (denetim
            kaydı, güvenlik) hukuki sebeplerine dayanılarak işlenmektedir.
          </P>
        </Section>

        <Section title="5. Aktarım">
          <P>
            Nöbetçi eczane bilgisi (eczane adı, adres, konum), hizmetin doğası gereği
            <code className="mx-1 rounded bg-muted px-1 py-0.5">/vatandas</code>
            herkese açık sayfasında görüntülenir. Kullanıcı hesap bilgileri ve iç işlem kayıtları
            yalnızca ilgili odanın yetkili kullanıcıları tarafından görülür; başka bir odayla
            paylaşılmaz (bkz. sistemin çok kiracılı mimarisi).
          </P>
        </Section>

        <Section title="6. Saklama Süresi">
          <P>
            Kişisel veriler, hesabın/odanın aktif olduğu süre boyunca ve ilgili mevzuatta
            öngörülen zamanaşımı süreleri saklı kalmak kaydıyla saklanır. Bir kullanıcı hesabı
            silindiğinde veya bir oda pasif hale getirildiğinde, veriler ilgili odanın yetkilisi
            tarafından silinene veya hizmet sağlayıcıyla yapılan sözleşme kapsamında belirlenen
            süre sonunda silinir/anonimleştirilir.
          </P>
        </Section>

        <Section title="7. İlgili Kişinin Hakları">
          <P>
            KVKK m.11 uyarınca; kişisel verinizin işlenip işlenmediğini öğrenme, işlenmişse buna
            ilişkin bilgi talep etme, işlenme amacını ve amacına uygun kullanılıp
            kullanılmadığını öğrenme, yurt içinde/yurt dışında aktarıldığı üçüncü kişileri
            bilme, eksik/yanlış işlenmişse düzeltilmesini isteme, silinmesini/yok edilmesini
            isteme, işlenen verilerin münhasıran otomatik sistemler vasıtasıyla analiz edilmesi
            suretiyle aleyhinize bir sonucun ortaya çıkmasına itiraz etme ve kanuna aykırı
            işleme sebebiyle zarara uğramanız hâlinde zararın giderilmesini talep etme
            haklarına sahipsiniz. Bu haklarınızı kullanmak için, verilerinizi işleyen odanın
            yetkilisiyle iletişime geçebilirsiniz.
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
