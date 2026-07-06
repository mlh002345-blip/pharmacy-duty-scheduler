# Dağıtım Rehberi (Deployment)

Bu rehber; projeyi barındırılan bir demo ortamına veya gerçek bir pilot
ortamına taşırken izlenecek adımları açıklar. Ürün kapsamı değişmez, bu
belge sadece çalıştırma/altyapı konularını kapsar.

Önce **"Ortam Türleri"** bölümünü okuyup hangi senaryoda olduğunuzu
belirleyin; bazı adımlar (ör. demo seed) sadece hosted demo için uygundur.

> **Branch notu:** `main` branch'i yerel geliştirme için SQLite kullanmaya
> devam eder. `deploy/postgresql-demo` branch'i ise `prisma/schema.prisma`
> içinde `provider = "postgresql"` ile ve PostgreSQL'e karşı üretilmiş temiz
> bir migration geçmişiyle gelir — hosted demo/pilot dağıtımı için bu
> branch'i kullanın. Bu branch'te yerel geliştirme de bir PostgreSQL
> veritabanı gerektirir (bkz. aşağıdaki "PostgreSQL Hazırlığı").

## Ortam Türleri

| | Yerel Geliştirme | Barındırılan Demo (Hosted Demo) | Gerçek Pilot |
|---|---|---|---|
| Veritabanı | SQLite (`file:./dev.db`) | PostgreSQL (yönetilen/hosted) | PostgreSQL (yedeklemeli, yönetilen) |
| Veri | Sahte/demo | Sahte/demo (`DEMO_SEED=true` ile) | Gerçek eczane/oda verisi |
| Demo seed | Serbest | Bilerek açılabilir | **Asla çalıştırılmaz** |
| Demo hesapları | Var, sorun değil | Var, sorun değil (halka açık demo olduğu bilinerek) | **Silinmeli/değiştirilmeli** |
| Yedekleme | Gerekmez | Önerilir | **Zorunlu** |
| KVKK aydınlatma metni | Gerekmez | Önerilir | **Zorunlu** |
| HTTPS | Gerekmez | Önerilir | **Zorunlu** |

Kısaca: **Barındırılan demo**, gerçek olmayan/sahte veriyle çalışan, oda
yetkilileri veya potansiyel müşterilere gösterim amaçlı canlı bir ortamdır.
**Gerçek pilot** ise gerçek eczane/oda verisiyle, yedeklemeli, güvenli
kimlik bilgileriyle ve KVKK gereksinimleri karşılanmış şekilde çalışan
üretim ortamıdır. Barındırılan demo ortamı hiçbir zaman gerçek pilot
ortamı olarak "terfi ettirilmemelidir" — gerçek pilot için sıfırdan, temiz
bir veritabanıyla başlanmalıdır (bkz. aşağıdaki "Demo Seed'i Güvenli
Çalıştırma" ve `docs/SECURITY_CHECKLIST.md`).

## 1. PostgreSQL Hazırlığı

`deploy/postgresql-demo` branch'inde `prisma/schema.prisma` zaten
PostgreSQL'e ayarlıdır:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Şemadaki tüm modeller (`@id @default(cuid())`, string/DateTime/Int/Float/
Boolean/enum alanları) PostgreSQL ile tam uyumludur; SQLite'a özgü herhangi
bir özellik kullanılmamıştır, bu yüzden model tanımlarında ek bir değişiklik
gerekmemiştir.

**Migration geçmişi hakkında önemli not:** `main` branch'indeki mevcut
migration'lar SQLite'a karşı üretilmişti (`prisma/migrations/
migration_lock.toml` → `provider = "sqlite"`) ve bu geçmiş PostgreSQL ile
**güvenle yeniden kullanılamaz** — iki sağlayıcının SQL lehçesi ve migration
kilidi birbiriyle uyumlu değildir. Bu yüzden bu branch'te eski SQLite
migration'ları kaldırılıp, aynı şemadan `prisma migrate diff` ile PostgreSQL
için tek, temiz bir "init" migration'ı (`prisma/migrations/
20260706120000_init_postgresql/migration.sql`) üretilmiştir. Bu migration,
canlı bir PostgreSQL veritabanına ihtiyaç duymadan doğrudan şemadan
üretildiği için, gerçek bir PostgreSQL sunucusuna karşı hiç çalıştırılmamış
"temiz" bir migration'dır — ilk `prisma migrate deploy` çalıştırıldığında
uygulanacaktır (bkz. aşağıdaki "Migration'ları Çalıştırma").

1. PostgreSQL veritabanınızı oluşturun (yönetilen bir servis — ör. Railway,
   Render, Supabase, Neon, Amazon RDS — veya kendi sunucunuz).

2. `DATABASE_URL` ortam değişkenini PostgreSQL bağlantı dizesiyle ayarlayın
   (bkz. `.env.production.example`):

   ```
   DATABASE_URL="postgresql://KULLANICI:SIFRE@HOST:5432/VERITABANI?schema=public"
   ```

3. Prisma Client'ı üretin:

   ```bash
   npm run db:generate
   ```

4. Migration'ı uygulayın (bkz. "Migration'ları Çalıştırma" bölümü).

`main` branch'i yerel geliştirmede SQLite ile devam eder; bu iki branch'in
şema/migration geçmişini birleştirmeyin (rebase/merge sırasında
`prisma/schema.prisma`'nın `provider` alanı ve `prisma/migrations/` klasörü
dikkatle ele alınmalıdır).

## 2. Ortam Değişkenlerini Yapılandırma

`.env.production.example` dosyasını referans alın (gerçek değerleri asla
repoya eklemeyin):

| Değişken | Açıklama |
|---|---|
| `DATABASE_URL` | PostgreSQL bağlantı dizesi. |
| `NODE_ENV` | `production` olarak ayarlanmalıdır. |
| `APP_URL` | Uygulamanın dışa açık adresi (mutlak URL üretimi için, ileride gerekebilir). |
| `DEMO_SEED` | Sadece hosted demo ortamında `true` yapılabilir; gerçek pilotta hiç ayarlanmamalı/`false` olmalıdır (bkz. aşağıdaki bölüm). |
| `SESSION_SECRET` | **Şu an gerekli değildir.** Oturumlar, veritabanında saklanan rastgele opak token'larla doğrulanır (bkz. `src/lib/auth/session.ts`), imzalı/JWT tipi bir mekanizma kullanılmaz. İleride eklenirse `openssl rand -hex 32` ile üretilen güçlü, gizli bir değer kullanılmalıdır. |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Sadece `npm run db:create-admin` çalıştırılırken geçici olarak gereklidir (bkz. aşağıdaki "İlk Yönetici Kullanıcısını Oluşturma"). Kalıcı olarak saklanmalarına gerek yoktur. |

Hosting sağlayıcınızın (ör. Vercel, Railway, Render, kendi sunucunuz)
ortam değişkeni/secret yönetim mekanizmasını kullanın; `.env` dosyasını
sunucuya elle kopyalamak yerine sağlayıcının secret store'unu tercih edin.

## 3. Migration'ları Çalıştırma

Production ortamında migration'ları uygulamak için:

```bash
npm run db:migrate:deploy
```

(Bu, `prisma migrate deploy`'u çalıştırır — `migrate dev`'den farklı olarak
yeni migration dosyası oluşturmaz, sadece `prisma/migrations/` altındaki
mevcut migration'ları sırayla uygular ve interaktif soru sormaz; CI/CD veya
dağıtım script'lerinde kullanıma uygundur.) İlk çalıştırmada, PostgreSQL
için hazırlanmış tek "init" migration'ı (bkz. yukarıdaki "PostgreSQL
Hazırlığı") uygulanıp tüm tablolar/enum'lar oluşturulur.

## 4. İlk Yönetici (Admin) Kullanıcısını Oluşturma

Gerçek bir pilot ortamında demo seed'i **çalıştırmamalısınız** (bkz. aşağı).
Bunun yerine `scripts/create-admin.ts` script'iyle ilk ADMIN kullanıcısını
doğrudan veritabanında, uygulamanın kendi şifre hashleme mantığını
(`src/lib/auth/password.ts` → `hashPassword`) kullanarak oluşturun:

```bash
ADMIN_NAME="Sistem Yöneticisi" \
ADMIN_EMAIL="admin@odaniz.org.tr" \
ADMIN_PASSWORD="guclu-bir-sifre-buraya" \
npm run db:create-admin
```

Script:

- `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` ortam değişkenlerini
  zorunlu kılar (`ADMIN_PASSWORD` en az 8 karakter olmalıdır),
- şifreyi uygulamanın kendi `hashPassword` fonksiyonuyla hashler; şifre
  veya hash'i hiçbir zaman konsola yazdırmaz,
- aynı e-posta ile zaten bir kullanıcı varsa **hiçbir şeyi değiştirmez** ve
  hata koduyla çıkar — var olan kullanıcıyı ADMIN'e yükseltip şifresini
  güncellemek isterseniz `ADMIN_ALLOW_OVERWRITE=true` ekleyerek tekrar
  çalıştırın.

Giriş yaptıktan sonra bu geçici şifreyi `/kullanicilar` ekranından (ADMIN
olarak) güçlü bir şifreyle değiştirmeniz önerilir.

## 5. Demo Seed'i Güvenli Çalıştırma

`prisma/seed.ts`, veritabanını tamamen temizleyip sahte demo verisiyle
doldurur. Bu, **sadece hosted demo ortamında, bilerek** çalıştırılmalıdır;
gerçek pilot ortamında asla çalıştırılmamalıdır.

Güvenlik önlemi olarak script, `NODE_ENV=production` iken `DEMO_SEED=true`
açıkça ayarlanmadıkça çalışmayı reddeder:

```bash
# Hosted demo ortamında, bilerek demo verisiyle doldurmak için:
DEMO_SEED=true npm run db:seed

# Yerel geliştirmede (NODE_ENV production değilken) ek bir bayrağa gerek yoktur:
npm run db:seed
```

Gerçek pilot ortamında `DEMO_SEED` değişkenini **hiçbir zaman ayarlamayın**.

## 6. Projeyi Derleme (Build)

```bash
npm install
npm run db:generate
npm run build
```

## 7. Uygulamayı Başlatma

```bash
npm run start
```

(Node tabanlı bir barındırma ortamında `next start` komutunu çalıştıran bir
process manager — ör. systemd servisi, PM2, veya hosting sağlayıcınızın
kendi runtime'ı — kullanın.)

## Özet: Uçtan Uca Komut Sırası (Hosted Demo)

```bash
# 1. PostgreSQL veritabanını oluşturun ve DATABASE_URL'i ayarlayın
export DATABASE_URL="postgresql://KULLANICI:SIFRE@HOST:5432/VERITABANI?schema=public"

# 2. Bağımlılıkları kurun ve Prisma Client'ı üretin
npm install
npm run db:generate

# 3. Migration'ları uygulayın
npm run db:migrate:deploy

# 4. İlk yönetici kullanıcısını oluşturun
ADMIN_NAME="Sistem Yöneticisi" ADMIN_EMAIL="admin@odaniz.org.tr" \
  ADMIN_PASSWORD="guclu-bir-sifre-buraya" npm run db:create-admin

# 5. (Opsiyonel, SADECE hosted demo için) demo verisiyle doldurun
DEMO_SEED=true npm run db:seed

# 6. Derleyin ve başlatın
npm run build
npm run start
```

## 8. Dağıtım Sonrası Kontrol Listesi

- [ ] `DATABASE_URL` PostgreSQL'i işaret ediyor ve bağlantı başarılı
- [ ] `npm run db:migrate:deploy` hatasız tamamlandı
- [ ] En az bir ADMIN kullanıcısı oluşturuldu ve giriş yapılabiliyor
- [ ] Demo seed sadece hosted demo ortamında ve bilerek çalıştırıldı
      (gerçek pilotta hiç çalıştırılmadı)
- [ ] Uygulama HTTPS arkasında çalışıyor
- [ ] `/vatandas` sayfası giriş yapmadan erişilebiliyor
- [ ] `/giris` sayfası çalışıyor ve rol tabanlı yönlendirme doğru
- [ ] Sunucu saat dilimi `Europe/Istanbul` olarak ayarlı
- [ ] `docs/SECURITY_CHECKLIST.md` içindeki tüm maddeler gözden geçirildi

Gerçek pilot öncesi ek güvenlik adımları için bkz.
[`docs/SECURITY_CHECKLIST.md`](SECURITY_CHECKLIST.md).
