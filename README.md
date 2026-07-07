# Pharmacy Duty Scheduler (Nöbet Çizelgeleme Sistemi)

## Proje Özeti

Eczacı odaları için nöbet çizelgeleme yönetim sistemi. Excel tabanlı manuel
nöbet planlamasının yerine geçer:

- eczane, bölge ve nöbet kuralı yönetimi
- tatil günü ve mazeret (uygun olmama) kaydı
- kural tabanlı otomatik aylık nöbet çizelgesi oluşturma
- manuel nöbet ataması değişikliği (gerekçe ile)
- nöbet dengesi / nöbet yükü analizi
- Excel ve PDF olarak dışa aktarma
- taslak/yayın durumu yönetimi
- rol tabanlı yetkilendirme ile kullanıcı yönetimi
- vatandaşlar için herkese açık nöbetçi eczane ekranı
- her değişiklik için denetim kaydı (audit log)

Ürün kapsamı ve geliştirme kuralları için bkz. `CLAUDE.md`.

## Teknoloji

- Next.js (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- Prisma ORM + SQLite (yerel/demo ortamı için)
- Vitest (birim testleri)
- xlsx (Excel dışa aktarma), pdfkit (PDF dışa aktarma)

## Kurulum

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run db:seed
npm run dev
```

Uygulama `http://localhost:3000` adresinde açılır. Yönetim paneli girişte
`/giris` sayfasına yönlendirir. Vatandaş ekranı `/vatandas` adresinde giriş
gerektirmeden erişilebilir.

## Ortam Değişkenleri

`.env.example` dosyasını `.env` olarak kopyalayın. Yerel geliştirme için
gereken değişkenler ve açıklamaları `.env.example` içinde yorum olarak
belirtilmiştir (`DATABASE_URL`, `NODE_ENV`, `DEMO_SEED`). Hosted/production
ortamı için `.env.production.example` dosyasına ve
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) rehberine bakın.

## Veritabanı Migration

Şema değişikliklerini uygulamak ve yeni migration oluşturmak için:

```bash
npx prisma migrate dev
```

Prisma Client'ı şemadan yeniden üretmek için (migration olmadan):

```bash
npx prisma generate
```

## Seed Çalıştırma

```bash
npm run db:seed
```

Bu komut veritabanını temizler ve şu demo verilerini oluşturur:

- 3 kullanıcı (ADMIN, STAFF, VIEWER — bkz. Giriş Bilgileri)
- 5 nöbet bölgesi (Kadıköy, Üsküdar, Beşiktaş, Bakırköy, Şişli) ve her biri
  için bir nöbet kuralı
- 100 eczane, gerçekçi Türkçe isim/adres/telefon bilgileriyle
- 2026 yılı resmî ve dini bayram günleri
- 10 örnek mazeret (uygun olmama) kaydı
- içinde bulunulan ay için 1 yayında, 1 taslak nöbet çizelgesi (böylece
  `/vatandas` sayfası seed sonrası hemen gerçek veri gösterir)

Bu script veritabanını **tamamen temizler**. `NODE_ENV=production` iken
yanlışlıkla çalıştırılmaması için `DEMO_SEED=true` açıkça verilmedikçe
çalışmayı reddeder; ayrıntılar için
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) → "Demo Seed'i Güvenli
Çalıştırma" bölümüne bakın.

## Giriş Bilgileri (Sadece Demo)

Aşağıdaki hesaplar **yalnızca yerel demo/geliştirme** amaçlıdır. Gerçek bir
pilot kullanımdan önce mutlaka değiştirilmeli veya silinmelidir.

| Rol                | E-posta              | Şifre       |
| ------------------ | --------------------- | ----------- |
| Yönetici (ADMIN)    | admin@example.com     | Admin123!   |
| Oda Yetkilisi (STAFF) | staff@example.com   | Staff123!   |
| Görüntüleyici (VIEWER) | viewer@example.com | Viewer123!  |

## Demo Akışı

Kısa bir tanıtım için bkz. [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md).
Detaylı test adımları için bkz. [`docs/QA_CHECKLIST.md`](docs/QA_CHECKLIST.md).

## Barındırma (Hosted Demo / Pilot) Dağıtımı

Projeyi barındırılan bir demo ortamına veya gerçek bir pilot ortamına
taşırken izlenecek adımlar (PostgreSQL'e geçiş, ortam değişkenleri,
migration, ilk yönetici kullanıcısı, demo seed'in güvenli çalıştırılması)
için bkz. [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Gerçek pilot öncesi
gözden geçirilmesi gereken güvenlik maddeleri için bkz.
[`docs/SECURITY_CHECKLIST.md`](docs/SECURITY_CHECKLIST.md).

Özetle:

1. `admin@example.com` ile `/giris` üzerinden giriş yapın.
2. Panel, Eczaneler, Nöbet Bölgeleri ve Nöbet Kuralları sayfalarını inceleyin.
3. `/cizelgeler/yeni` üzerinden yeni bir nöbet çizelgesi oluşturun.
4. Çizelge detay sayfasında nöbet dengesini, manuel değişiklik ve dışa
   aktarma (Excel/PDF) seçeneklerini gösterin.
5. Çizelgeyi yayınlayın ve `/vatandas` sayfasında sonucu gösterin.
6. `/denetim-kayitlari` sayfasında yapılan işlemlerin kaydını gösterin.

## Ana Özellikler

- **Kurulum verisi yönetimi**: eczane, bölge, nöbet kuralı, tatil günü,
  mazeret için tam CRUD (Sil işlemleri ilişkili kayıt varsa Türkçe uyarı ile
  engellenir).
- **Otomatik çizelge oluşturma**: seçilen bölge ve ay için kural tabanlı,
  açıklanabilir bir algoritma (bkz. `src/lib/scheduling/`). Yetersiz eczane
  olduğunda sistem çökmez, o gün için uyarı kaydı oluşturur.
- **Manuel atama değişikliği**: gerekçe zorunlu, asgari nöbet aralığı
  ihlalinde onay isteyen bir uyarı akışı içerir.
- **Dışa aktarma**: Excel (xlsx) ve PDF (Türkçe karakter desteğiyle) olarak
  çizelge indirme.
- **Yayın durumu**: taslak/yayında geçişleri ve buna bağlı yetkilendirme.
- **Vatandaş ekranı**: sadece yayınlanmış çizelgelerden bugün/yarın nöbetçi
  eczaneleri gösterir; giriş gerektirmez.
- **Kimlik doğrulama ve roller**: e-posta/şifre girişi, oturum tabanlı
  kimlik doğrulama, ADMIN/STAFF/VIEWER rollerine göre yetkilendirme.
- **Kullanıcı yönetimi**: sadece ADMIN, kullanıcı oluşturabilir, düzenleyebilir,
  aktif/pasif yapabilir.
- **Denetim kaydı**: tüm oluşturma/güncelleme/silme işlemleri ve kullanıcı
  değişiklikleri Türkçe olarak `/denetim-kayitlari` sayfasında görüntülenir.

## Komutlar

- `npm run dev` — geliştirme sunucusunu başlatır
- `npm run build` — production build alır
- `npm run lint` — lint kontrolü yapar
- `npm test` — birim testlerini çalıştırır (Vitest)
- `npm run db:seed` — veritabanını örnek verilerle doldurur

## Bilinen Sınırlamalar

- Kullanıcı silme (hard delete) uygulanmadı; denetim kaydı bütünlüğünü
  korumak için sadece aktif/pasif geçişi desteklenir.
- Çizelge bazlı nöbet yükü analizi tek dönem içindir; tüm
  dönemleri kapsayan genel bir rapor henüz yok.
- Şifre sıfırlama e-posta akışı yok; şifre değişikliği sadece ADMIN
  tarafından kullanıcı düzenleme ekranından yapılabilir.
- Oturumlar süresi dolduğunda otomatik temizlenmiyor (kullanılmayan
  oturum kayıtları veritabanında kalabilir).
- `xlsx` paketinin npm'de yayınlanan sürümünde bilinen güvenlik açıkları var
  (yalnızca güvenilmeyen dosya *okuma* işleminde risk taşır); bu proje
  yalnızca kendi verisinden dosya *yazdığı* için pratik risk düşüktür, ancak
  production öncesi tekrar değerlendirilmelidir.
- Tek dil (Türkçe) arayüz; çoklu dil desteği yok.
- Otomatik zamanlanmış görev (ör. ayın başında otomatik çizelge oluşturma)
  yok; çizelgeler manuel olarak oluşturulur.

## Production Notları

Aşağıdakiler gerçek bir pilot kullanım öncesinde **yapılması gereken**
değişikliklerdir. Bu depoda henüz uygulanmamıştır, sadece belgelenmiştir:

- **Veritabanı**: SQLite yerine PostgreSQL kullanın (çoklu kullanıcı/eşzamanlı
  yazma ve yedekleme için SQLite uygun değildir).
- **Demo kimlik bilgileri**: `admin@example.com` / `staff@example.com` /
  `viewer@example.com` hesaplarını ve şifrelerini production'a geçmeden önce
  değiştirin veya silin; seed script'i production ortamında çalıştırmayın.
- **Oturum güvenliği**: oturum çerezleri zaten `httpOnly` ve production'da
  `secure` olarak ayarlanıyor; ek olarak uygulamanın HTTPS arkasında
  çalıştığından ve ters proxy/CDN üzerinden güvenli başlıkların (HSTS vb.)
  ayarlandığından emin olun.
- **Ortam değişkenleri**: `DATABASE_URL` gibi tüm değişkenleri gerçek
  ortam için ayrı ayrı ve gizli (secret) olarak yönetin; `.env` dosyasını
  asla repoya eklemeyin.
- **Yedekleme**: veritabanı için düzenli otomatik yedekleme ve geri yükleme
  testleri planlayın.
- **Seed devre dışı**: `npm run db:seed` gibi verileri temizleyen komutların
  production ortamında yanlışlıkla çalıştırılamayacağından emin olun.
- **KVKK ve kişisel veri işleme**: eczacı/eczane iletişim bilgileri ve
  kullanıcı hesap bilgileri işlendiği için KVKK kapsamında aydınlatma metni,
  veri saklama süresi ve erişim/silme talepleri süreçlerini tanımlayın.
- **Sunucu saat dilimi**: sunucunun `Europe/Istanbul` saat dilimine göre
  yapılandırıldığından emin olun (nöbet tarihleri ve "bugün/yarın"
  hesaplamaları sunucu saatine göre yapılır).
- **İzleme ve loglama**: hata izleme (ör. Sentry) ve temel uygulama
  loglaması eklenmesi önerilir.
