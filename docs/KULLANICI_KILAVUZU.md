# Kullanıcı Kılavuzu

Bu kılavuz, bir eczacı odası yetkilisinin sistemi sıfırdan kurup ilk
nöbet çizelgesini oluşturana kadar geçen adımları anlatır. Sistemin ne
işe yaradığını değil, "şimdi ne tıklıyorum" sorusunu cevaplar.

## İçindekiler

1. [Giriş ve Roller](#1-giriş-ve-roller)
2. [İlk Kurulum](#2-i̇lk-kurulum)
3. [Aylık Nöbet Çizelgesi Oluşturma](#3-aylık-nöbet-çizelgesi-oluşturma)
4. [Manuel Düzenleme](#4-manuel-düzenleme)
5. [Onaylama ve Yayınlama](#5-onaylama-ve-yayınlama)
6. [Dışa Aktarma ve Vatandaş Ekranı](#6-dışa-aktarma-ve-vatandaş-ekranı)
7. [Sık Kullanılan Diğer Ekranlar](#7-sık-kullanılan-diğer-ekranlar)
8. [V2: Gelişmiş Nöbet Planları — Ne Zaman Gerekir?](#8-v2-gelişmiş-nöbet-planları--ne-zaman-gerekir)
9. [Konum Bazlı Nöbet](#9-konum-bazlı-nöbet)
10. [Nöbet Hatırlatma E-postası](#10-nöbet-hatırlatma-e-postası)
11. [Sorun Giderme](#11-sorun-giderme)

---

## 1. Giriş ve Roller

`/giris` adresinden e-posta ve şifre ile giriş yapılır. Sistemde üç
kullanıcı rolü vardır:

| Rol | Türkçe Etiket | Yetkisi |
|---|---|---|
| ADMIN | Yönetici | Her şeyi yapabilir: kullanıcı ekleme/çıkarma, silme işlemleri, yayınlama. |
| STAFF | Oda Yetkilisi | Günlük işleri yürütür: çizelge oluşturma, düzenleme, yayınlama. Kullanıcı yönetemez, bazı silme işlemlerini yapamaz. |
| VIEWER | Görüntüleyici | Yalnızca görüntüleme ve dışa aktarma (Excel/PDF). |

Yeni bir kullanıcı eklemek için: **Kullanıcılar** → **Yeni Ekle**
(yalnızca Yönetici görebilir).

---

## 2. İlk Kurulum

Kurulum sırası önemlidir — her adım bir öncekine bağlıdır.

### 2.1 Nöbet Bölgesi Oluşturma

**Nöbet Bölgeleri** → **Yeni Bölge**

- **Bölge Adı**: ör. "Merkez", "Dodurga"
- **İlçe**
- **Günlük Nöbetçi Sayısı**: o bölgede aynı gün kaç eczanenin nöbet
  tutacağı (çoğu oda için 1)

> Bir eczane odasının birden fazla bölgesi olabilir (örneğin ilçe bazlı
> ayrı nöbet listeleri tutan odalar için). Her bölge kendi eczane
> listesine, kuralına ve çizelgesine sahiptir.

### 2.2 Eczane Ekleme

**Eczaneler** → **Yeni Eczane**

- **Eczane Adı**, **Eczacı Adı**, **Telefon**, **Nöbet Bölgesi** (2.1'de
  oluşturduğunuz bölge), **İl**, **İlçe**, **Adres**
- **Harita Bağlantısı** (opsiyonel) — vatandaş ekranında "Yol Tarifi"
  bağlantısı olarak kullanılır.

Çok sayıda eczane varsa tek tek girmek yerine **Eczaneler** →
**Excel ile İçe Aktar** ile toplu yükleme yapılabilir (yalnızca Yönetici
görebilir). Şablon dosyayı indirip doldurduktan sonra yükleyin; sistem
içe aktarmadan önce bir önizleme gösterir, hiçbir satır önizlemeyi
onaylamadan kaydedilmez.

### 2.3 Nöbet Kuralı Tanımlama

**Nöbet Kuralları** → ilgili bölgenin **Düzenle** butonu

- **Asgari Nöbet Aralığı**: aynı eczanenin iki nöbeti arasında geçmesi
  gereken en az gün sayısı.
- **Hafta İçi / Cumartesi / Pazar / Resmi Tatil / Dini Bayram Ağırlığı**:
  her gün türünün "yük puanı". Örneğin Pazar günü nöbeti hafta içi
  nöbetinden daha yorucu kabul edilip daha yüksek bir ağırlık verilebilir
  — sistem, çizelge oluştururken toplam yükü en düşük olan eczaneyi
  önceliklendirir.

Her bölgenin **tam olarak bir** nöbet kuralı olur; kural olmadan o bölge
için çizelge oluşturulamaz.

### 2.4 Tatil Günleri (opsiyonel ama önerilir)

**Tatil Günleri** → **Yeni Tatil Günü**

Resmi ve dini tatilleri burada tek tek tanımlarsınız (tarih + tür). Bir
kez girilen tatil, sistemin bildiği tüm bölgeler için geçerlidir —
her bölgede ayrı ayrı girmenize gerek yoktur.

### 2.5 Mazeretler (opsiyonel, ihtiyaç oldukça)

**Mazeretler** → **Yeni Mazeret**

Bir eczanenin belirli bir tarih aralığında nöbet tutamayacağını
(izin, tadilat vb.) buradan kaydedersiniz. Çizelge oluşturulurken bu
tarihler otomatik olarak dışlanır.

### 2.6 Kurulumu Doğrulama

**Veri Kontrol** sayfası, çizelge oluşturmadan önce eksik/hatalı
verileri (kuralı olmayan bölge, aktif eczanesi olmayan bölge vb.)
listeler. Çizelge oluşturmadan önce bu sayfayı kontrol etmek, oluşturma
sırasında karşılaşabileceğiniz hataları önceden görmenizi sağlar.

---

## 3. Aylık Nöbet Çizelgesi Oluşturma

**Nöbet Çizelgeleri** → **Yeni Nöbet Çizelgesi Oluştur**

- Bölge, ay ve yıl seçip **Nöbet Çizelgesi Oluştur**'a basın.
- Sistem otomatik olarak, aktif eczaneleri, mazeretleri, asgari nöbet
  aralığını ve gün ağırlıklarını dikkate alarak günlük atamaları
  hesaplar.
- Oluşan çizelge **Taslak** durumunda gelir — henüz vatandaşlara
  görünmez, istediğiniz kadar düzenleyebilirsiniz.
- Bir günde yeterli uygun eczane bulunamazsa sistem çökmez, o gün için
  bir **uyarı** bırakır; çizelge detay sayfasında bu uyarılar listelenir.

Aynı bölge + ay + yıl için ikinci bir çizelge oluşturulamaz — önce
mevcut taslağı silmeniz ya da yayından kaldırmanız gerekir.

### Taslağı Silme

Bir taslak çizelgeyi yanlışlıkla oluşturduysanız veya baştan almak
istiyorsanız, çizelge detay sayfasındaki (veya listedeki) **Sil**
butonuyla kaldırabilirsiniz. Yalnızca **Yönetici** rolü silme
yapabilir; **yayınlanmış** bir çizelge asla silinemez — önce yayından
kaldırılması gerekir.

---

## 4. Manuel Düzenleme

Bir eczanenin son anda nöbetini değiştirmesi gerekebilir. Çizelge detay
sayfasında ilgili günün satırındaki **Düzenle**'ye basın:

- Yeni eczaneyi seçin.
- **Değişiklik Nedeni** girmek zorunludur (ör. "eczacı izinde").
- Sistem; seçilen eczanenin aynı gün başka bir yerde atanmış olup
  olmadığını ve mazeretli olup olmadığını kontrol eder.
- Asgari nöbet aralığı ihlal edilirse bir uyarı gösterilir, ama isterseniz
  yine de devam edebilirsiniz.

Değişiklik sonrası tabloda o satırda **Manuel** rozeti görünür ve
girdiğiniz not saklanır. Her manuel değişiklik **Denetim Kayıtları**
sayfasında kim/ne zaman/ne değiştirdi bilgisiyle otomatik kayıt altına
alınır.

---

## 5. Onaylama ve Yayınlama

- **Taslak** durumundaki bir çizelge yalnızca odanın kendi içinde
  görünür.
- Hazır olduğunda **Yayınla** butonuna basarsınız — bu andan itibaren
  çizelge `/vatandas` genel sayfasında görünür olur.
- Bir hata fark ederseniz **Yayından Kaldır** ile geri taslak durumuna
  alabilirsiniz (yalnızca standart nöbet çizelgeleri için; gelişmiş V2
  planlarında yayınlama geri alınamaz — bkz. [Bölüm 8](#8-v2-gelişmiş-nöbet-planları--ne-zaman-gerekir)).

---

## 6. Dışa Aktarma ve Vatandaş Ekranı

- Çizelge detay sayfasında **Excel'e Aktar** ve **PDF İndir** butonları
  bulunur — oda arşivi veya eczanelerle paylaşım için.
- Yayınlanan çizelgeler `/vatandas` adresinde, giriş gerektirmeden,
  bölge seçilerek görüntülenebilir. Bu bağlantıyı odanızın web
  sitesine veya sosyal medyasına ekleyebilirsiniz.

---

## 7. Sık Kullanılan Diğer Ekranlar

| Ekran | Ne İşe Yarar |
|---|---|
| **Nöbet Talepleri** | Eczanelerin nöbet tutamama/erteleme taleplerini inceleyip onaylama/reddetme. Eczaneler `/eczane-talep/[token]` bağlantısıyla giriş yapmadan talep gönderebilir. |
| **Geçmiş Nöbetler** | Sisteme geçmeden önceki nöbet geçmişini (Excel'den) içe aktarıp nöbet dengesi hesabına dahil etme. |
| **Nöbet Dengesi** | Her eczanenin toplam nöbet yükünü (geçmiş + yeni sistem + manuel düzeltme) karşılaştırmalı gösterir. |
| **Denetim Kayıtları** | Sistemde yapılan her değişikliğin kim/ne zaman/ne yaptığı kaydı. |
| **Veri Kontrol** | Eksik/hatalı kurulum verilerini proaktif olarak listeler. |

---

## 8. V2: Gelişmiş Nöbet Planları — Ne Zaman Gerekir?

Yukarıdaki akış ("V1") çoğu oda için yeterlidir: tek bir kural, her gün
aynı sayıda eczane. Ama bazı odaların nöbet düzeni daha karmaşıktır —
örneğin:

- Yalnızca hafta sonu/bayram nöbeti tutan, geri kalan günlerde nöbet
  tutulmayan bir bölge,
- Aynı gün birden fazla eczanenin aynı anda nöbetçi olduğu bir düzen,
- Bayram günleri için tamamen ayrı bir eczane havuzunun kullanıldığı bir
  düzen.

Bu durumlarda **V2 Plan Yapılandırma** ekranı kullanılır. Zaten V1 ile
çalışan bir bölgeniz varsa, sıfırdan yapılandırmak yerine aynı ekrandaki
**V1'den Taşı** butonuyla mevcut kuralınızın birebir aynısını tek tıkla
bir V2 planına dönüştürebilir, ardından yalnızca farklılaşan kısımları
(örn. ayrı bir bayram havuzu) elle özelleştirebilirsiniz.

V2 planları da **Taslak** olarak başlar, yapılandırma tamamlanınca
**Etkinleştir** ile devreye alınır. Bir V2 çizelgesi **Taslak** →
**Onaylandı** → **Yayınlandı** üç aşamasından geçer (V1'in iki
aşamasından farklı olarak). **Onaylandı** durumundaki bir çizelge de
silinebilir; ama **yayınlama geri alınamaz** — yayınlama anında ilgili
eczanelerin nöbet sırası kalıcı olarak ilerler, bu yüzden yayınlamadan
önce dikkatli kontrol edin.

---

## 9. Konum Bazlı Nöbet

Bazı odalarda nöbet, bölge içinde de konuma göre ayrışır — ör. "üniversite
hastanesi yakınındaki eczaneler kendi aralarında ayrı bir nöbet listesi
tutsun". Bunu sağlamanın iki yolu vardır.

### 9.1 Ayrı Bölge (tamamen bağımsız nöbet listesi gerekiyorsa)

Konuma özgü grup kendi kuralına, kendi çizelgesine ve kendi nöbet
dengesine sahip **tamamen bağımsız** bir nöbet listesi olacaksa, en basit
çözüm o konum için ayrı bir **Nöbet Bölgesi** açmaktır (bkz.
[2.1 Nöbet Bölgesi Oluşturma](#21-nöbet-bölgesi-oluşturma)). O bölgedeki
eczaneleri oraya taşıyın, bölgeye kendi nöbet kuralını tanımlayın —
sistem zaten her bölgeyi birbirinden bağımsız çizelgeler. Ek bir
yapılandırma gerekmez, mevcut akışın aynısıdır.

### 9.2 Hizmet Alanı (aynı bölge içinde etiketleme, hızlı gruplama için)

Konuma özgü grup **aynı bölgenin** bir parçası kalacaksa (aynı kural, aynı
nöbet dengesi hesabı) ama yalnızca eczaneleri konuma göre etiketlemek ve
bu etiketle hızlıca gruplamak istiyorsanız, **Hizmet Alanı** kullanılır:

- **Nöbet Bölgeleri** → ilgili bölgenin **Düzenle** butonu → **Hizmet
  Alanları** bölümünden yeni bir hizmet alanı adı girip **Ekle**'ye basın
  (ör. "Üniversite Yakını").
- **Eczaneler** → eczaneyi **Düzenle** → **Hizmet Alanı** açılır
  menüsünden ilgili etiketi seçin. Menü yalnızca eczanenin bağlı olduğu
  bölgenin hizmet alanlarını listeler; etiket tamamen opsiyoneldir.
- Eczane listesinde her satırda hangi hizmet alanına etiketli olduğu
  görünür.
- Bir hizmet alanı silindiğinde etiketli eczaneler **silinmez**,
  yalnızca etiketleri kalkar.

Hizmet Alanı tek başına çizelge oluşturmayı etkilemez — nöbet sırasını
veya ağırlıkları değiştirmez, salt bir etiketleme katmanıdır. Asıl işe
yaradığı yer **V2 Plan Yapılandırma**'daki rotasyon havuzlarıdır (bkz.
[Bölüm 8](#8-v2-gelişmiş-nöbet-planları--ne-zaman-gerekir)): bir
rotasyon havuzunu tek tek eczane seçerek doldurmak yerine, havuzun
düzenleme ekranındaki **"Hizmet Alanına Göre Ekle"** ile o etikete sahip
tüm aktif eczaneleri tek tıkla havuza ekleyebilirsiniz (zaten havuzda
olanlar ve pasif eczaneler otomatik atlanır).

---

## 10. Nöbet Hatırlatma E-postası

Yarın nöbetçi olan eczanelere, eczane kaydında bir e-posta adresi
tanımlıysa hatırlatma gönderebilirsiniz.

- **Eczaneler** → eczaneyi **Düzenle** → **E-posta (opsiyonel)** alanına
  eczanenin e-posta adresini girin. Bu alan boş bırakılabilir; boşsa o
  eczaneye hatırlatma gönderilmez, hata da üretmez.
- Panelin ana sayfasında, **Nöbet Hatırlatmaları** kartındaki
  **"Yarının Nöbet Hatırlatmalarını Gönder"** butonuna basın. Sistem;
  yarın **yayınlanmış** bir çizelgede nöbetçi olan ve e-postası tanımlı
  her eczaneye bir hatırlatma e-postası gönderir.
- Aynı nöbet ataması için ikinci kez gönderilmez — buton birden fazla kez
  tıklansa da tekrar e-posta gitmez.
- Gönderim sonrası, kaç e-postanın gönderildiği, kaç eczanenin
  e-postasının eksik olduğu ve varsa kaç tanesinin daha önce gönderilmiş
  olduğu özet olarak gösterilir.
- Bu gönderim **manuel**dir — sistemde otomatik/günlük bir zamanlayıcı
  yoktur; butona her gün elle basılması gerekir. E-postanın fiilen
  iletilebilmesi için sunucuda bir SMTP yapılandırması (ortam
  değişkenleri) gereklidir. Yapılandırılmamışsa buton yine çalışır ve
  "gönderildi" sayısını raporlar (atama kayıt altına alınır, tekrar
  denenmez), ama gerçekte e-posta kutusuna hiçbir şey ulaşmaz — canlı
  kullanımdan önce bir sistem yöneticisinin SMTP ayarlarını yapması
  gerekir.
- Bu bölüm yalnızca **Yönetici** ve **Oda Yetkilisi** rollerine
  görünür.

---

## 11. Sorun Giderme

**"Bu bölge için tanımlı bir nöbet kuralı bulunmuyor" hatası** — 2.3
adımını tamamlamadan çizelge oluşturmaya çalıştınız. Önce
**Nöbet Kuralları**'ndan bölgeye bir kural tanımlayın.

**"Bu bölgede aktif eczane bulunmuyor" hatası** — bölgede hiç eczane
yok veya hepsi pasif durumda. **Eczaneler** sayfasından bölgeyi
filtreleyip durum kontrolü yapın.

**Çizelge oluşturamıyorum, "zaten bir çizelge mevcut" diyor** — aynı
bölge + ay + yıl için daha önce bir taslak oluşturulmuş. Mevcut taslağı
açıp düzenleyin ya da silip yeniden oluşturun.

**Sil butonunu göremiyorum** — silme işlemleri yalnızca **Yönetici**
rolüne açıktır (istisna: V2 plan yapılandırma taslakları, Oda Yetkilisi
de silebilir). Ayrıca yayınlanmış bir çizelge hiçbir rol tarafından
silinemez — önce yayından kaldırılmalıdır.

**Bir şey beklediğim gibi çalışmıyor** — karşılaştığınız her sorunu,
hangi sayfada olduğunuzu ve ne yapmaya çalıştığınızı belirterek iletin;
hızlıca inceleyip düzeltiyoruz.
