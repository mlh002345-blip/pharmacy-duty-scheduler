import Link from "next/link";
import { BookOpen } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireUser } from "@/lib/auth/session";

const SECTIONS = [
  { id: "giris-ve-roller", label: "1. Giriş ve Roller" },
  { id: "ilk-kurulum", label: "2. İlk Kurulum" },
  { id: "cizelge-olusturma", label: "3. Aylık Nöbet Çizelgesi Oluşturma" },
  { id: "manuel-duzenleme", label: "4. Manuel Düzenleme" },
  { id: "onay-yayin", label: "5. Onaylama ve Yayınlama" },
  { id: "disa-aktarma", label: "6. Dışa Aktarma ve Vatandaş Ekranı" },
  { id: "diger-ekranlar", label: "7. Sık Kullanılan Diğer Ekranlar" },
  { id: "v2", label: "8. Gelişmiş Nöbet Planları (V2)" },
  { id: "konum-bazli", label: "9. Konum Bazlı Nöbet" },
  { id: "hatirlatma", label: "10. Nöbet Hatırlatma E-postası" },
  { id: "sorun-giderme", label: "11. Sorun Giderme" },
  { id: "sozluk", label: "12. Sözlük" },
  { id: "sss", label: "13. Sık Sorulan Sorular" },
];

const QUICK_SUMMARY: { task: string; where: string }[] = [
  { task: "Sisteme ilk kez giriş yapmak", where: "/giris" },
  { task: "Nöbet çizelgesi oluşturmak", where: "Nöbet Çizelgeleri → Yeni Nöbet Çizelgesi Oluştur" },
  { task: "Bir eczanenin nöbetini değiştirmek", where: "Çizelge detayı → ilgili günün satırında Düzenle" },
  { task: "Çizelgeyi vatandaşa açmak", where: "Çizelge detayı → Yayınla" },
  { task: "Çizelgeyi Excel/PDF olarak almak", where: "Çizelge detayı → Excel'e Aktar / PDF İndir" },
  { task: "Eczanenin nöbet tutamayacağı tarihi kaydetmek", where: "Mazeretler → Yeni Mazeret" },
  { task: "Yeni bir oda çalışanı eklemek", where: "Kullanıcılar → Yeni Ekle (yalnızca Yönetici)" },
  { task: "Kurulumda eksik bir şey var mı kontrol etmek", where: "Veri Kontrol" },
];

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-20">
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

function Steps({ children }: { children: React.ReactNode }) {
  return <ul className="flex flex-col gap-1.5 pl-1">{children}</ul>;
}

function Step({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="text-muted-foreground select-none">–</span>
      <span>{children}</span>
    </li>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
      {children}
    </p>
  );
}

export default async function KilavuzPage() {
  await requireUser();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3">
        <div className="bg-primary/10 text-primary mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl">
          <BookOpen className="size-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Kullanım Kılavuzu</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Sistemi sıfırdan kurup ilk nöbet çizelgenizi oluşturana kadar geçen adımlar.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Hızlı Özet</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Yapmak istediğiniz</TableHead>
                <TableHead>Nereye gidin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {QUICK_SUMMARY.map((row) => (
                <TableRow key={row.task}>
                  <TableCell>{row.task}</TableCell>
                  <TableCell className="font-medium">{row.where}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap gap-2 py-4">
          {SECTIONS.map((section) => (
            <Link key={section.id} href={`#${section.id}`}>
              <Badge variant="outline" className="cursor-pointer hover:bg-muted">
                {section.label}
              </Badge>
            </Link>
          ))}
        </CardContent>
      </Card>

      <Section id="giris-ve-roller" title="1. Giriş ve Roller">
        <P>
          <code>/giris</code> adresinden e-posta ve şifre ile giriş yapılır. Sistemde üç
          kullanıcı rolü vardır:
        </P>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rol</TableHead>
              <TableHead>Yetkisi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium">Yönetici</TableCell>
              <TableCell>
                Her şeyi yapabilir: kullanıcı ekleme/çıkarma, silme işlemleri, yayınlama.
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Oda Yetkilisi</TableCell>
              <TableCell>
                Günlük işleri yürütür: çizelge oluşturma, düzenleme, yayınlama. Kullanıcı
                yönetemez, bazı silme işlemlerini yapamaz.
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Görüntüleyici</TableCell>
              <TableCell>Yalnızca görüntüleme ve dışa aktarma (Excel/PDF).</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <P>
          Yeni bir kullanıcı eklemek için: <strong>Kullanıcılar</strong> →{" "}
          <strong>Yeni Ekle</strong> (yalnızca Yönetici görebilir).
        </P>
        <P>
          <strong>Şifremi unuttum, ne yapmalıyım?</strong> Giriş ekranındaki{" "}
          <strong>&quot;Şifremi unuttum&quot;</strong> bağlantısına tıklayıp e-posta
          adresinizi girin — sistem kayıtlıysa bir sıfırlama bağlantısı gönderir (1 saat
          geçerlidir). Bu, sunucuda bir e-posta yapılandırması gerektirir;
          yapılandırılmadıysa bir <strong>Yönetici</strong>, <strong>Kullanıcılar</strong>{" "}
          → ilgili kullanıcının <strong>Düzenle</strong> butonu →{" "}
          <strong>Yeni Şifre</strong> alanına girip kaydederek şifreyi sıfırlayabilir.
          Odanızda hiçbir Yönetici giriş yapamıyorsa, sistem sağlayıcınızla iletişime
          geçin.
        </P>
        <P>
          <strong>Oturum ne kadar açık kalır?</strong> Giriş yaptıktan sonra
          oturumunuz günler mertebesinde açık kalır; tarayıcıyı kapatıp tekrar
          açtığınızda yeniden giriş yapmanız gerekmez. Şifrenizi değiştirirseniz
          diğer tüm oturumlar (başka cihazlar dahil) otomatik sonlandırılır.
        </P>
      </Section>

      <Section id="ilk-kurulum" title="2. İlk Kurulum">
        <P>Kurulum sırası önemlidir — her adım bir öncekine bağlıdır.</P>

        <h3 className="mt-2 font-semibold">2.1 Nöbet Bölgesi Oluşturma</h3>
        <P>
          <strong>Nöbet Bölgeleri</strong> → <strong>Yeni Bölge</strong>
        </P>
        <Steps>
          <Step>
            <strong>Bölge Adı</strong>: ör. &quot;Merkez&quot;, &quot;Dodurga&quot;
          </Step>
          <Step>
            <strong>İlçe</strong>
          </Step>
          <Step>
            <strong>Günlük Nöbetçi Sayısı</strong>: o bölgede aynı gün kaç eczanenin nöbet
            tutacağı (çoğu oda için 1)
          </Step>
        </Steps>
        <Note>
          Bir eczane odasının birden fazla bölgesi olabilir (örneğin ilçe bazlı ayrı nöbet
          listeleri tutan odalar için). Her bölge kendi eczane listesine, kuralına ve
          çizelgesine sahiptir.
        </Note>

        <h3 className="mt-2 font-semibold">2.2 Eczane Ekleme</h3>
        <P>
          <strong>Eczaneler</strong> → <strong>Yeni Eczane</strong>
        </P>
        <Steps>
          <Step>
            <strong>Eczane Adı</strong>, <strong>Eczacı Adı</strong>, <strong>Telefon</strong>,{" "}
            <strong>Nöbet Bölgesi</strong> (2.1&apos;de oluşturduğunuz bölge),{" "}
            <strong>İl</strong>, <strong>İlçe</strong>, <strong>Adres</strong>
          </Step>
          <Step>
            <strong>Harita Bağlantısı</strong> (opsiyonel) — vatandaş ekranında &quot;Yol
            Tarifi&quot; bağlantısı olarak kullanılır.
          </Step>
        </Steps>
        <P>
          Çok sayıda eczane varsa tek tek girmek yerine <strong>Eczaneler</strong> →{" "}
          <strong>Excel ile İçe Aktar</strong> ile toplu yükleme yapılabilir (yalnızca
          Yönetici görebilir). Şablon dosyayı indirip doldurduktan sonra yükleyin; sistem
          içe aktarmadan önce bir önizleme gösterir, hiçbir satır önizlemeyi onaylamadan
          kaydedilmez.
        </P>

        <h3 className="mt-2 font-semibold">2.3 Nöbet Kuralı Tanımlama</h3>
        <P>
          <strong>Nöbet Kuralları</strong> → ilgili bölgenin <strong>Düzenle</strong> butonu
        </P>
        <Steps>
          <Step>
            <strong>Asgari Nöbet Aralığı</strong>: aynı eczanenin iki nöbeti arasında geçmesi
            gereken en az gün sayısı.
          </Step>
          <Step>
            <strong>Hafta İçi / Cumartesi / Pazar / Resmi Tatil / Dini Bayram Ağırlığı</strong>:
            her gün türünün &quot;yük puanı&quot;. Örneğin Pazar günü nöbeti hafta içi
            nöbetinden daha yorucu kabul edilip daha yüksek bir ağırlık verilebilir — sistem,
            çizelge oluştururken toplam yükü en düşük olan eczaneyi önceliklendirir.
          </Step>
        </Steps>
        <P>
          Her bölgenin <strong>tam olarak bir</strong> nöbet kuralı olur; kural olmadan o
          bölge için çizelge oluşturulamaz.
        </P>
        <Note>
          <strong>Örnek:</strong> &quot;Merkez&quot; bölgesinde asgari nöbet aralığı 5
          gün, Pazar ağırlığı 1.5, hafta içi ağırlığı 1 olarak girildi. A eczanesi bu ay
          zaten 2 hafta içi nöbeti tuttu (toplam yük: 2), B eczanesi 1 Pazar nöbeti
          tuttu (toplam yük: 1.5). Sistem bir sonraki günü atarken, asgari aralık
          kuralını ihlal etmeyen eczaneler arasından toplam yükü en düşük olanı (bu
          örnekte B&apos;yi) önceliklendirir — böylece zamanla tüm eczanelerin toplam
          yükü birbirine yaklaşır.
        </Note>

        <h3 className="mt-2 font-semibold">2.4 Tatil Günleri (opsiyonel ama önerilir)</h3>
        <P>
          <strong>Tatil Günleri</strong> → <strong>Yeni Tatil Günü</strong>
        </P>
        <P>
          Resmi ve dini tatilleri burada tek tek tanımlarsınız (tarih + tür). Bir kez
          girilen tatil, sistemin bildiği tüm bölgeler için geçerlidir — her bölgede ayrı
          ayrı girmenize gerek yoktur.
        </P>

        <h3 className="mt-2 font-semibold">2.5 Mazeretler (opsiyonel, ihtiyaç oldukça)</h3>
        <P>
          <strong>Mazeretler</strong> → <strong>Yeni Mazeret</strong>
        </P>
        <P>
          Bir eczanenin belirli bir tarih aralığında nöbet tutamayacağını (izin, tadilat
          vb.) buradan kaydedersiniz. Çizelge oluşturulurken bu tarihler otomatik olarak
          dışlanır.
        </P>

        <h3 className="mt-2 font-semibold">2.6 Kurulumu Doğrulama</h3>
        <P>
          <strong>Veri Kontrol</strong> sayfası, çizelge oluşturmadan önce eksik/hatalı
          verileri (kuralı olmayan bölge, aktif eczanesi olmayan bölge vb.) listeler.
          Çizelge oluşturmadan önce bu sayfayı kontrol etmek, oluşturma sırasında
          karşılaşabileceğiniz hataları önceden görmenizi sağlar.
        </P>
      </Section>

      <Section id="cizelge-olusturma" title="3. Aylık Nöbet Çizelgesi Oluşturma">
        <P>
          <strong>Nöbet Çizelgeleri</strong> →{" "}
          <strong>Yeni Nöbet Çizelgesi Oluştur</strong>
        </P>
        <Steps>
          <Step>
            Bölge, ay ve yıl seçip <strong>Nöbet Çizelgesi Oluştur</strong>&apos;a basın.
          </Step>
          <Step>
            Sistem otomatik olarak, aktif eczaneleri, mazeretleri, asgari nöbet aralığını ve
            gün ağırlıklarını dikkate alarak günlük atamaları hesaplar.
          </Step>
          <Step>
            Oluşan çizelge <strong>Taslak</strong> durumunda gelir — henüz vatandaşlara
            görünmez, istediğiniz kadar düzenleyebilirsiniz.
          </Step>
          <Step>
            Bir günde yeterli uygun eczane bulunamazsa sistem çökmez, o gün için bir{" "}
            <strong>uyarı</strong> bırakır; çizelge detay sayfasında bu uyarılar listelenir.
          </Step>
        </Steps>
        <P>
          Aynı bölge + ay + yıl için ikinci bir çizelge oluşturulamaz — önce mevcut taslağı
          silmeniz ya da yayından kaldırmanız gerekir.
        </P>
        <h3 className="mt-2 font-semibold">Taslağı Silme</h3>
        <P>
          Bir taslak çizelgeyi yanlışlıkla oluşturduysanız veya baştan almak istiyorsanız,
          çizelge detay sayfasındaki (veya listedeki) <strong>Sil</strong> butonuyla
          kaldırabilirsiniz. Yalnızca <strong>Yönetici</strong> rolü silme yapabilir;{" "}
          <strong>yayınlanmış</strong> bir çizelge asla silinemez — önce yayından
          kaldırılması gerekir.
        </P>
      </Section>

      <Section id="manuel-duzenleme" title="4. Manuel Düzenleme">
        <P>
          Bir eczanenin son anda nöbetini değiştirmesi gerekebilir. Çizelge detay sayfasında
          ilgili günün satırındaki <strong>Düzenle</strong>&apos;ye basın:
        </P>
        <Steps>
          <Step>Yeni eczaneyi seçin.</Step>
          <Step>
            <strong>Değişiklik Nedeni</strong> girmek zorunludur (ör. &quot;eczacı
            izinde&quot;).
          </Step>
          <Step>
            Sistem; seçilen eczanenin aynı gün başka bir yerde atanmış olup olmadığını ve
            mazeretli olup olmadığını kontrol eder.
          </Step>
          <Step>
            Asgari nöbet aralığı ihlal edilirse bir uyarı gösterilir, ama isterseniz yine de
            devam edebilirsiniz.
          </Step>
        </Steps>
        <P>
          Değişiklik sonrası tabloda o satırda <strong>Manuel</strong> rozeti görünür ve
          girdiğiniz not saklanır. Her manuel değişiklik <strong>Denetim Kayıtları</strong>{" "}
          sayfasında kim/ne zaman/ne değiştirdi bilgisiyle otomatik kayıt altına alınır.
        </P>
      </Section>

      <Section id="onay-yayin" title="5. Onaylama ve Yayınlama">
        <Steps>
          <Step>
            <strong>Taslak</strong> durumundaki bir çizelge yalnızca odanın kendi içinde
            görünür.
          </Step>
          <Step>
            Hazır olduğunda <strong>Yayınla</strong> butonuna basarsınız — bu andan itibaren
            çizelge <code>/vatandas</code> genel sayfasında görünür olur.
          </Step>
          <Step>
            Bir hata fark ederseniz <strong>Yayından Kaldır</strong> ile geri taslak
            durumuna alabilirsiniz (yalnızca standart nöbet çizelgeleri için; gelişmiş V2
            planlarında yayınlama geri alınamaz — bkz.{" "}
            <Link href="#v2" className="text-primary underline">
              Bölüm 8
            </Link>
            ).
          </Step>
        </Steps>
      </Section>

      <Section id="disa-aktarma" title="6. Dışa Aktarma ve Vatandaş Ekranı">
        <P>
          Çizelge detay sayfasında <strong>Excel&apos;e Aktar</strong> ve{" "}
          <strong>PDF İndir</strong> butonları bulunur — oda arşivi veya eczanelerle
          paylaşım için.
        </P>
        <P>
          Yayınlanan çizelgeler <code>/vatandas</code> adresinde, giriş gerektirmeden, bölge
          seçilerek görüntülenebilir. Bu bağlantıyı odanızın web sitesine veya sosyal
          medyasına ekleyebilirsiniz.
        </P>
      </Section>

      <Section id="diger-ekranlar" title="7. Sık Kullanılan Diğer Ekranlar">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ekran</TableHead>
              <TableHead>Ne İşe Yarar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium">Nöbet Talepleri</TableCell>
              <TableCell>
                Eczanelerin nöbet tutamama/erteleme taleplerini inceleyip
                onaylama/reddetme. Eczaneler kendilerine özel bir bağlantıyla giriş
                yapmadan talep gönderebilir.
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Geçmiş Nöbetler</TableCell>
              <TableCell>
                Sisteme geçmeden önceki nöbet geçmişini (Excel&apos;den) içe aktarıp nöbet
                dengesi hesabına dahil etme.
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Nöbet Dengesi</TableCell>
              <TableCell>
                Her eczanenin toplam nöbet yükünü (geçmiş + yeni sistem + manuel
                düzeltme) karşılaştırmalı gösterir.
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Denetim Kayıtları</TableCell>
              <TableCell>Sistemde yapılan her değişikliğin kim/ne zaman/ne yaptığı kaydı.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Veri Kontrol</TableCell>
              <TableCell>Eksik/hatalı kurulum verilerini proaktif olarak listeler.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Kullanıcılar</TableCell>
              <TableCell>
                Oda çalışanlarını ekleme, rol atama, pasif yapma, şifre sıfırlama
                (yalnızca Yönetici).
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Kullanım Kılavuzu</TableCell>
              <TableCell>Bu sayfa — sol menüden her zaman erişilebilir.</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Section>

      <Section id="v2" title="8. Gelişmiş Nöbet Planları (V2) — Ne Zaman Gerekir?">
        <P>
          Yukarıdaki akış (&quot;V1&quot;) çoğu oda için yeterlidir: tek bir kural, her gün
          aynı sayıda eczane. Ama bazı odaların nöbet düzeni daha karmaşıktır — örneğin:
        </P>
        <Steps>
          <Step>
            Yalnızca hafta sonu/bayram nöbeti tutan, geri kalan günlerde nöbet tutulmayan
            bir bölge,
          </Step>
          <Step>Aynı gün birden fazla eczanenin aynı anda nöbetçi olduğu bir düzen,</Step>
          <Step>
            Bayram günleri için tamamen ayrı bir eczane havuzunun kullanıldığı bir düzen.
          </Step>
        </Steps>
        <P>
          Bu durumlarda <strong>V2 Plan Yapılandırma</strong> ekranı kullanılır. Zaten V1 ile
          çalışan bir bölgeniz varsa, sıfırdan yapılandırmak yerine aynı ekrandaki{" "}
          <strong>V1&apos;den Taşı</strong> butonuyla mevcut kuralınızın birebir aynısını
          tek tıkla bir V2 planına dönüştürebilir, ardından yalnızca farklılaşan kısımları
          (örn. ayrı bir bayram havuzu) elle özelleştirebilirsiniz.
        </P>
        <P>
          V2 planları da <strong>Taslak</strong> olarak başlar, yapılandırma tamamlanınca{" "}
          <strong>Etkinleştir</strong> ile devreye alınır. Bir V2 çizelgesi{" "}
          <strong>Taslak</strong> → <strong>Onaylandı</strong> → <strong>Yayınlandı</strong>{" "}
          üç aşamasından geçer (V1&apos;in iki aşamasından farklı olarak).{" "}
          <strong>Onaylandı</strong> durumundaki bir çizelge de silinebilir; ama{" "}
          <strong>yayınlama geri alınamaz</strong> — yayınlama anında ilgili eczanelerin
          nöbet sırası kalıcı olarak ilerler, bu yüzden yayınlamadan önce dikkatli kontrol
          edin.
        </P>
      </Section>

      <Section id="konum-bazli" title="9. Konum Bazlı Nöbet">
        <P>
          Bazı odalarda nöbet, bölge içinde de konuma göre ayrışır — ör.
          &quot;üniversite hastanesi yakınındaki eczaneler kendi aralarında ayrı bir
          nöbet listesi tutsun&quot;. Bunu sağlamanın iki yolu vardır.
        </P>

        <h3 className="mt-2 font-semibold">
          9.1 Ayrı Bölge (tamamen bağımsız nöbet listesi gerekiyorsa)
        </h3>
        <P>
          Konuma özgü grup kendi kuralına, kendi çizelgesine ve kendi nöbet dengesine
          sahip <strong>tamamen bağımsız</strong> bir nöbet listesi olacaksa, en basit
          çözüm o konum için ayrı bir <strong>Nöbet Bölgesi</strong> açmaktır (bkz.{" "}
          <Link href="#ilk-kurulum" className="text-primary underline">
            2.1 Nöbet Bölgesi Oluşturma
          </Link>
          ). O bölgedeki eczaneleri oraya taşıyın, bölgeye kendi nöbet kuralını
          tanımlayın — sistem zaten her bölgeyi birbirinden bağımsız çizelgeler. Ek bir
          yapılandırma gerekmez, mevcut akışın aynısıdır.
        </P>

        <h3 className="mt-2 font-semibold">
          9.2 Hizmet Alanı (aynı bölge içinde etiketleme, hızlı gruplama için)
        </h3>
        <P>
          Konuma özgü grup <strong>aynı bölgenin</strong> bir parçası kalacaksa (aynı
          kural, aynı nöbet dengesi hesabı) ama yalnızca eczaneleri konuma göre
          etiketlemek ve bu etiketle hızlıca gruplamak istiyorsanız,{" "}
          <strong>Hizmet Alanı</strong> kullanılır:
        </P>
        <Steps>
          <Step>
            <strong>Nöbet Bölgeleri</strong> → ilgili bölgenin <strong>Düzenle</strong>{" "}
            butonu → <strong>Hizmet Alanları</strong> bölümünden yeni bir hizmet alanı
            adı girip <strong>Ekle</strong>&apos;ye basın (ör. &quot;Üniversite
            Yakını&quot;).
          </Step>
          <Step>
            <strong>Eczaneler</strong> → eczaneyi <strong>Düzenle</strong> →{" "}
            <strong>Hizmet Alanı</strong> açılır menüsünden ilgili etiketi seçin. Menü
            yalnızca eczanenin bağlı olduğu bölgenin hizmet alanlarını listeler; etiket
            tamamen opsiyoneldir.
          </Step>
          <Step>Eczane listesinde her satırda hangi hizmet alanına etiketli olduğu görünür.</Step>
          <Step>
            Bir hizmet alanı silindiğinde etiketli eczaneler <strong>silinmez</strong>,
            yalnızca etiketleri kalkar.
          </Step>
        </Steps>
        <P>
          Hizmet Alanı tek başına çizelge oluşturmayı etkilemez — nöbet sırasını veya
          ağırlıkları değiştirmez, salt bir etiketleme katmanıdır. Asıl işe yaradığı yer{" "}
          <strong>V2 Plan Yapılandırma</strong>&apos;daki rotasyon havuzlarıdır (bkz.{" "}
          <Link href="#v2" className="text-primary underline">
            Bölüm 8
          </Link>
          ): bir rotasyon havuzunu tek tek eczane seçerek doldurmak yerine, havuzun
          düzenleme ekranındaki <strong>&quot;Hizmet Alanına Göre Ekle&quot;</strong> ile
          o etikete sahip tüm aktif eczaneleri tek tıkla havuza ekleyebilirsiniz (zaten
          havuzda olanlar ve pasif eczaneler otomatik atlanır).
        </P>
      </Section>

      <Section id="hatirlatma" title="10. Nöbet Hatırlatma E-postası">
        <P>
          Yarın nöbetçi olan eczanelere, eczane kaydında bir e-posta adresi tanımlıysa
          hatırlatma gönderebilirsiniz.
        </P>
        <Steps>
          <Step>
            <strong>Eczaneler</strong> → eczaneyi <strong>Düzenle</strong> →{" "}
            <strong>E-posta (opsiyonel)</strong> alanına eczanenin e-posta adresini
            girin. Boş bırakılabilir; boşsa o eczaneye hatırlatma gönderilmez, hata da
            üretmez.
          </Step>
          <Step>
            Panelin ana sayfasındaki <strong>Nöbet Hatırlatmaları</strong> kartındaki{" "}
            <strong>&quot;Yarının Nöbet Hatırlatmalarını Gönder&quot;</strong> butonuna
            basın. Sistem; yarın <strong>yayınlanmış</strong> bir çizelgede nöbetçi
            olan ve e-postası tanımlı her eczaneye bir hatırlatma e-postası gönderir.
          </Step>
          <Step>
            Aynı nöbet ataması için ikinci kez gönderilmez — buton birden fazla kez
            tıklansa da tekrar e-posta gitmez.
          </Step>
        </Steps>
        <Note>
          Bu gönderim <strong>manuel</strong>dir — sistemde otomatik/günlük bir
          zamanlayıcı yoktur, butona her gün elle basılması gerekir. E-postanın fiilen
          iletilebilmesi için sunucuda bir SMTP yapılandırması gereklidir;
          yapılandırılmamışsa buton yine çalışır ve &quot;gönderildi&quot; sayısını
          raporlar, ama gerçekte e-posta kutusuna hiçbir şey ulaşmaz.
        </Note>
        <P>Bu bölüm yalnızca Yönetici ve Oda Yetkilisi rollerine görünür.</P>
      </Section>

      <Section id="sorun-giderme" title="11. Sorun Giderme">
        <P>
          <strong>&quot;Bu bölge için tanımlı bir nöbet kuralı bulunmuyor&quot; hatası</strong>{" "}
          — 2.3 adımını tamamlamadan çizelge oluşturmaya çalıştınız. Önce{" "}
          <strong>Nöbet Kuralları</strong>&apos;ndan bölgeye bir kural tanımlayın.
        </P>
        <P>
          <strong>&quot;Bu bölgede aktif eczane bulunmuyor&quot; hatası</strong> — bölgede
          hiç eczane yok veya hepsi pasif durumda. <strong>Eczaneler</strong> sayfasından
          bölgeyi filtreleyip durum kontrolü yapın.
        </P>
        <P>
          <strong>Çizelge oluşturamıyorum, &quot;zaten bir çizelge mevcut&quot; diyor</strong>{" "}
          — aynı bölge + ay + yıl için daha önce bir taslak oluşturulmuş. Mevcut taslağı
          açıp düzenleyin ya da silip yeniden oluşturun.
        </P>
        <P>
          <strong>Sil butonunu göremiyorum</strong> — silme işlemleri yalnızca{" "}
          <strong>Yönetici</strong> rolüne açıktır (istisna: V2 plan yapılandırma
          taslakları, Oda Yetkilisi de silebilir). Ayrıca yayınlanmış bir çizelge hiçbir rol
          tarafından silinemez — önce yayından kaldırılmalıdır.
        </P>
        <P>
          <strong>Giriş yapamıyorum, &quot;e-posta veya şifre hatalı&quot; diyor</strong> —
          e-posta ve şifreyi tekrar kontrol edin (büyük/küçük harf duyarlıdır). Hesabınız
          pasif yapılmışsa da aynı genel hata görünür; emin değilseniz odanızdaki bir
          Yönetici&apos;ye sorun.
        </P>
        <P>
          <strong>Art arda birkaç kez yanlış şifre girdim, artık giriş yapamıyorum</strong>{" "}
          — sistem, kısa süreli çok sayıda başarısız girişten sonra o hesap/ağ için
          girişleri geçici olarak yavaşlatır. Birkaç dakika bekleyip tekrar deneyin.
        </P>
        <P>
          <strong>Excel içe aktarımda satırlar &quot;geçersiz&quot; olarak işaretlendi</strong>{" "}
          — önizleme ekranındaki hata kodunu kontrol edin; genellikle zorunlu bir sütunun
          boş bırakılmasından kaynaklanır. Yalnızca geçerli satırlar içe aktarılır,
          geçersiz olanlar atlanır.
        </P>
        <P>
          <strong>Nöbet hatırlatma e-postası gitmiyor</strong> — panel &quot;gönderildi&quot;
          diyor ama eczaneye ulaşmıyorsa, sunucuda SMTP ayarları yapılandırılmamış
          olabilir (bkz.{" "}
          <Link href="#hatirlatma" className="text-primary underline">
            Bölüm 10
          </Link>
          ). Sistem hata vermez, sadece gerçekte iletim yapmaz.
        </P>
        <P>
          <strong>Bir şey beklediğim gibi çalışmıyor</strong> — karşılaştığınız her sorunu,
          hangi sayfada olduğunuzu ve ne yapmaya çalıştığınızı belirterek iletin; hızlıca
          inceleyip düzeltiyoruz.
        </P>
      </Section>

      <Section id="sozluk" title="12. Sözlük">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Terim</TableHead>
              <TableHead>Anlamı</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium">Taslak</TableCell>
              <TableCell>
                Henüz yayınlanmamış, yalnızca oda içinde görünen çizelge/plan durumu.
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Yayınlandı</TableCell>
              <TableCell>Çizelgenin /vatandas genel sayfasında görünür olduğu durum.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Onaylandı</TableCell>
              <TableCell>
                Yalnızca V2 planlarında: taslak tamamlanıp yayınlanmadan önceki ara durum.
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Ağırlık</TableCell>
              <TableCell>
                Bir gün türünün ne kadar &quot;yorucu&quot; sayıldığını belirten sayı.
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Asgari Nöbet Aralığı</TableCell>
              <TableCell>
                Aynı eczanenin iki nöbeti arasında geçmesi gereken en az gün sayısı.
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Nöbet Dengesi</TableCell>
              <TableCell>
                Her eczanenin toplam nöbet yükünün karşılaştırmalı görünümü.
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Hizmet Alanı</TableCell>
              <TableCell>
                Bir bölge içinde eczaneleri konuma göre etiketlemek için kullanılan
                opsiyonel gruplama.
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Rotasyon Havuzu</TableCell>
              <TableCell>Yalnızca V2 planlarında: sırayla nöbete girecek eczane listesi.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Manuel Atama</TableCell>
              <TableCell>
                Otomatik hesaplanan bir nöbetin elle değiştirilmiş hâli.
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Denetim Kaydı</TableCell>
              <TableCell>
                Sistemde yapılan her değişikliğin otomatik tutulan, silinemeyen kaydı.
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Section>

      <Section id="sss" title="13. Sık Sorulan Sorular">
        <P>
          <strong>Birden fazla oda çalışanı aynı anda sisteme girip çalışabilir mi?</strong>{" "}
          Evet, her kullanıcının kendi hesabı ve oturumu vardır. Aynı nöbet gününü aynı
          anda iki kişi düzenlemeye çalışırsa son kaydeden geçerli olur — büyük
          değişiklikleri tek kişinin yapması önerilir.
        </P>
        <P>
          <strong>Verilerim güvende mi, yedekleme var mı?</strong> Veritabanı yedekleme
          politikası, sistemi barındıran altyapıya bağlıdır — odanızın barındırma
          sağlayıcısıyla yedekleme sıklığını teyit edin.
        </P>
        <P>
          <strong>Sistemi telefondan/tablet üzerinden kullanabilir miyim?</strong> Yönetim
          paneli öncelikle masaüstü için tasarlanmıştır ama mobil tarayıcıda da açılır.
          Eczanelerin nöbet talebi gönderdiği bağlantı ise özellikle mobil uyumlu, giriş
          gerektirmeyen bir formdur.
        </P>
        <P>
          <strong>Bir eczaneyi sistemden tamamen silebilir miyim?</strong> Yalnızca o
          eczaneye ait hiçbir nöbet ataması yoksa. Geçmişte nöbet tutmuş bir eczane
          silinemez — bunun yerine <strong>Pasif</strong> yapılır; pasif eczaneler yeni
          çizelgelere dahil edilmez ama geçmiş kayıtları korunur.
        </P>
        <P>
          <strong>Aynı bölgeye birden fazla nöbet kuralı tanımlayabilir miyim?</strong>{" "}
          Hayır, her bölgenin tam olarak bir nöbet kuralı vardır. Farklı kombinasyonlar
          gerekiyorsa ayrı bir bölge açın veya karmaşık senaryolar için V2 plan
          yapılandırmasını kullanın (bkz.{" "}
          <Link href="#v2" className="text-primary underline">
            Bölüm 8
          </Link>
          ).
        </P>
        <P>
          <strong>Yayınlanmış bir çizelgede hata fark ettim, ne yapmalıyım?</strong>{" "}
          Standart (V1) çizelgelerde <strong>Yayından Kaldır</strong> ile geri taslağa
          alıp düzeltip tekrar yayınlayabilirsiniz. V2 planlarında yayınlama geri
          alınamaz — hatalı günü{" "}
          <Link href="#manuel-duzenleme" className="text-primary underline">
            Manuel Düzenleme
          </Link>{" "}
          ile doğrudan düzeltin.
        </P>
      </Section>
    </div>
  );
}
