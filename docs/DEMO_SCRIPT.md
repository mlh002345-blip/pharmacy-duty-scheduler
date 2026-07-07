# Demo Akışı (7–10 Dakika)

Eczacı odası yönetimine sunulacak canlı demo için önerilen akış. Demo
öncesi veritabanının `npm run db:seed` ile taze seed verisiyle
doldurulmuş olduğundan emin olun.

Demo hesabı: `admin@example.com` / `Admin123!`

---

## 1. Giriş (30 sn)

"Sisteme e-posta ve şifre ile giriş yapıyoruz. Her kullanıcının bir rolü
var: Yönetici, Oda Yetkilisi veya Görüntüleyici. Bugün Yönetici hesabıyla
ilerleyeceğiz."

- `/giris` adresine gidin, `admin@example.com` / `Admin123!` ile giriş yapın.

## 2. Panel (30 sn)

"Giriş yaptıktan sonra karşımıza sistemin genel özeti çıkıyor: toplam
eczane sayısı, aktif bölge sayısı, taslak ve yayındaki çizelge sayıları.
Sık kullanılan işlemlere buradan tek tıkla ulaşabiliyoruz."

- Panel sayfasındaki özet kartları ve "Hızlı İşlemler" bölümünü gösterin.

## 3. Eczane Listesi (1 dk)

"Odaya kayıtlı tüm eczaneleri buradan yönetiyoruz: isim, eczacı, bölge,
telefon ve durum bilgisiyle birlikte. İsme göre arama yapabiliyoruz,
bölge ve durum bazında filtreleyebiliyoruz."

- `/eczaneler` sayfasına gidin.
- Arama kutusuna bir eczacı adı yazıp filtrelemeyi gösterin.
- Bir eczanenin "Düzenle" sayfasını kısaca açıp kapatın.

## 4. Bölgeler ve Nöbet Kuralları (1 dk)

"Eczaneler nöbet bölgelerine ayrılıyor; her bölgenin günlük kaç eczane
nöbet tutacağı ve nöbet kuralları (hafta içi, hafta sonu, resmî tatil,
dini bayram ağırlıkları, asgari nöbet aralığı) ayrı ayrı tanımlanıyor."

- `/bolgeler` sayfasını gösterin.
- `/kurallar` sayfasına geçip bir bölgenin kural detayını açın.

## 5. Mazeretler / Uygun Olmama Kayıtları (30 sn)

"Bir eczanenin belirli bir tarih aralığında nöbet tutamayacağını buradan
kaydediyoruz — örneğin yıllık izin veya tadilat durumunda. Sistem, çizelge
oluştururken bu tarihleri otomatik olarak dışlıyor."

- `/mazeretler` sayfasını gösterin.

## 6. Aylık Çizelge Oluşturma (1.5 dk)

"Şimdi asıl işi sisteme yaptıralım: bir bölge ve ay seçerek otomatik nöbet
çizelgesi oluşturacağız. Algoritma; aktif eczaneleri, bölge kısıtını,
mazeretleri, asgari nöbet aralığını ve hafta sonu/tatil ağırlıklarını
dikkate alarak günlük atamaları belirliyor."

- `/cizelgeler/yeni` sayfasına gidin.
- Bir bölge, mevcut ay ve yıl seçip "Nöbet Çizelgesi Oluştur" butonuna
  basın.
- Oluşan çizelge detay sayfasında günlük atama tablosunu gösterin.
- (Varsa) uyarı listesini gösterip "yetersiz eczane olan günlerde sistem
  çökmüyor, sadece uyarı veriyor" diyerek açıklayın.

## 7. Nöbet Dengesi (1 dk)

"Çizelgenin altında, her eczanenin kaç nöbet tuttuğunu, kaçının hafta
sonuna, kaçının tatil gününe denk geldiğini ve toplam yük puanını gösteren
bir nöbet yükü analizi var. Bu sayede nöbet dağılımının dengeli olduğunu
kanıtlayabiliyoruz."

- Aynı sayfada "Nöbet Dengesi" tablosuna kaydırın.

## 8. Manuel Değişiklik ve Gerekçe (1.5 dk)

"Bazen bir eczane son anda nöbetini değiştirmek isteyebilir. Bu durumda
günlük atamalar tablosundan ilgili günün yanındaki 'Düzenle' butonuna
basıyoruz, yeni eczaneyi seçiyoruz ve değişiklik nedenini yazmak zorunlu.
Sistem; seçilen eczanenin aynı gün başka bir yerde atanmış olup olmadığını,
mazeretli olup olmadığını kontrol ediyor. Asgari nöbet aralığı ihlal
edilirse bizi uyarıyor, ama gerekirse yine de devam edebiliyoruz."

- Bir atama satırında "Düzenle"ye tıklayın.
- Farklı bir eczane seçip bir gerekçe yazıp kaydedin.
- Tabloda "Manuel" rozetini ve girilen notu gösterin.

## 9. Denetim Kaydı (1 dk)

"Yaptığımız her değişiklik — kim, ne zaman, neyi değiştirdi — otomatik
olarak kaydediliyor. Az önceki manuel değişikliği burada görebiliyoruz."

- `/denetim-kayitlari` sayfasına gidin, en üstteki kaydı gösterin.

## 10. Excel / PDF Dışa Aktarma (1 dk)

"Çizelgeyi oda arşivi veya eczanelerle paylaşmak için Excel ya da PDF
olarak indirebiliyoruz."

- Çizelge detay sayfasında "Excel'e Aktar" ve "PDF İndir" butonlarına
  basıp indirilen dosyaları kısaca açın.

## 11. Yayınlama (30 sn)

"Çizelge hazır olduğunda 'Yayınla' butonuyla yayına alıyoruz. Yayına
alınmadan önce vatandaşlar bu bilgiyi göremiyor — bu sayede taslak
aşamasında hata düzeltme şansımız oluyor."

- "Yayınla" butonuna basın, durumun "Yayında" olarak değiştiğini gösterin.

## 12. Vatandaş Ekranı (1 dk)

"Son olarak, vatandaşların gördüğü ekranı gösterelim. Giriş yapmaya gerek
yok; bölgesini seçen bir vatandaş, bugünün ve yarının nöbetçi eczanelerini,
telefon ve adres bilgisiyle birlikte görebiliyor."

- `/vatandas` sayfasını yeni bir sekmede açın.
- Az önce yayınladığınız bölgeyi seçip bugünkü nöbetçi eczaneyi gösterin.

---

### Kapanış

"Özetle: eczane ve bölge yönetiminden otomatik çizelgelemeye, manuel
düzenlemeden denetim kaydına, dışa aktarmadan vatandaş ekranına kadar tüm
süreç tek bir sistemde, uçtan uca izlenebilir şekilde yönetiliyor."
