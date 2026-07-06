# Dağıtım Rehberi (Deployment)

Bu rehber; projeyi barındırılan bir demo ortamına veya gerçek bir pilot
ortamına taşırken izlenecek adımları açıklar. Ürün kapsamı değişmez, bu
belge sadece çalıştırma/altyapı konularını kapsar.

Önce **"Ortam Türleri"** bölümünü okuyup hangi senaryoda olduğunuzu
belirleyin; bazı adımlar (ör. demo seed) sadece hosted demo için uygundur.

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

Proje yerel geliştirmede SQLite kullanır (`prisma/schema.prisma` →
`datasource db { provider = "sqlite" }`). Şemadaki tüm modeller
(`@id @default(cuid())`, string/DateTime/Int/Float/Boolean/enum alanları)
zaten PostgreSQL ile tam uyumludur; SQLite'a özgü herhangi bir özellik
kullanılmamıştır. Hosted/production ortamında PostgreSQL'e geçmek için:

1. `prisma/schema.prisma` dosyasında datasource bloğunu güncelleyin:

   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```

   (Tek değişiklik `provider = "sqlite"` → `provider = "postgresql"`.)

2. Production ortamının `DATABASE_URL` değişkenini PostgreSQL bağlantı
   dizesiyle ayarlayın (bkz. `.env.production.example`):

   ```
   DATABASE_URL="postgresql://KULLANICI:SIFRE@HOST:5432/VERITABANI?schema=public"
   ```

3. Migration'ları PostgreSQL'e karşı yeniden oluşturup uygulayın:

   ```bash
   npx prisma migrate dev --name init_postgresql
   ```

   > Not: SQLite ve PostgreSQL için ayrı migration geçmişi tutulur. Yerel
   > SQLite geliştirmesini bozmamak için bu değişikliği ayrı bir dağıtım
   > branch'inde veya dağıtım öncesi son adım olarak yapmanız, ve yerel
   > `prisma/migrations` klasörünü SQLite için değiştirmeden bırakmanız
   > önerilir. Aynı `schema.prisma` dosyasıyla iki farklı veritabanı
   > sağlayıcısı (SQLite ve PostgreSQL) arasında migration geçmişini ortak
   > kullanamazsınız; hosted ortam için migration'ları PostgreSQL'e karşı
   > temiz bir şekilde yeniden oluşturmanız gerekir.

4. Prisma Client'ı yeni şemaya göre yeniden üretin:

   ```bash
   npx prisma generate
   ```

Bu proje bilinçli olarak yerel geliştirmede SQLite'ı korur (basit kurulum,
sıfır bağımlılık) ve PostgreSQL geçişini sadece dağıtım anında, yukarıdaki
adımlarla yapılacak şekilde tasarlar — böylece günlük geliştirme akışı
etkilenmez.

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

Hosting sağlayıcınızın (ör. Vercel, Railway, Render, kendi sunucunuz)
ortam değişkeni/secret yönetim mekanizmasını kullanın; `.env` dosyasını
sunucuya elle kopyalamak yerine sağlayıcının secret store'unu tercih edin.

## 3. Migration'ları Çalıştırma

Production ortamında migration'ları uygulamak için:

```bash
npx prisma migrate deploy
```

(`migrate dev` yerine `migrate deploy` kullanılır — bu komut yeni migration
dosyası oluşturmaz, sadece mevcut migration'ları sırayla uygular ve
interaktif soru sormaz; CI/CD veya dağıtım script'lerinde kullanıma
uygundur.)

## 4. İlk Yönetici (Admin) Kullanıcısını Oluşturma

Gerçek bir pilot ortamında demo seed'i **çalıştırmamalısınız** (bkz. aşağı).
Bunun yerine ilk ADMIN kullanıcısını doğrudan veritabanında oluşturun.
En basit yol, tek seferlik bir Node script'i çalıştırmaktır:

```bash
node -e "
const { PrismaClient } = require('@prisma/client');
const { scryptSync, randomBytes } = require('crypto');

const prisma = new PrismaClient();

async function main() {
  const password = 'GUCLU-BIR-SIFRE-BURAYA'; // Oluşturduktan sonra değiştirin
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  const passwordHash = \`\${salt}:\${hash}\`;

  await prisma.user.create({
    data: {
      name: 'Sistem Yöneticisi',
      email: 'admin@odaniz.org.tr',
      passwordHash,
      role: 'ADMIN',
      isActive: true,
    },
  });
  console.log('İlk yönetici kullanıcı oluşturuldu.');
}

main().finally(() => prisma.\$disconnect());
"
```

> Şifre hashleme biçimi `src/lib/auth/password.ts`'teki `hashPassword`
> fonksiyonuyla birebir aynı olmalıdır (scrypt, `salt:hash` formatı, hex
> encoding). Yukarıdaki script bu formatı taklit eder; farklı bir yöntem
> kullanmayın. Kullanıcı oluşturduktan hemen sonra bu geçici şifreyi
> `/kullanicilar` ekranından (ADMIN olarak giriş yaptıktan sonra) güçlü bir
> şifreyle değiştirin.

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
npx prisma generate
npm run build
```

## 7. Uygulamayı Başlatma

```bash
npm run start
```

(Node tabanlı bir barındırma ortamında `next start` komutunu çalıştıran bir
process manager — ör. systemd servisi, PM2, veya hosting sağlayıcınızın
kendi runtime'ı — kullanın.)

## 8. Dağıtım Sonrası Kontrol Listesi

- [ ] `DATABASE_URL` PostgreSQL'i işaret ediyor ve bağlantı başarılı
- [ ] `npx prisma migrate deploy` hatasız tamamlandı
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
