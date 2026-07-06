# Güvenlik Kontrol Listesi

Barındırılan bir demo ortamından gerçek bir pilot kullanıma geçmeden önce
aşağıdaki maddelerin tamamı gözden geçirilmelidir. İlgili genel dağıtım
adımları için bkz. [`docs/DEPLOYMENT.md`](DEPLOYMENT.md).

## Kimlik Bilgileri

- [ ] Demo hesaplarının şifreleri değiştirildi veya hesaplar tamamen
      silindi (`admin@example.com`, `staff@example.com`,
      `viewer@example.com` — bkz. `prisma/seed.ts`)
- [ ] Gerçek pilotta kullanılacak tüm kullanıcı hesapları tek tek gözden
      geçirildi: gereksiz hesaplar pasife alındı, roller (ADMIN/STAFF/
      VIEWER) doğru atandı
- [ ] Sistemde en az bir aktif ADMIN kullanıcısı olduğu doğrulandı

## Ağ ve Oturum Güvenliği

- [ ] Uygulama HTTPS arkasında çalışıyor (ters proxy/CDN üzerinden TLS
      sonlandırma yapılandırıldı)
- [ ] Oturum çerezleri `httpOnly` ve (production'da) `secure` olarak
      ayarlı olduğu doğrulandı (bkz. `src/lib/auth/session.ts` —
      `secure: process.env.NODE_ENV === "production"`); bunun için
      `NODE_ENV=production` olarak ayarlandığından emin olun
- [ ] Ters proxy/CDN üzerinde HSTS gibi güvenli HTTP başlıkları
      yapılandırıldı
- [ ] Güçlü bir `SESSION_SECRET` kullanılması: **Şu an bu proje imzalı
      (JWT tipi) oturum kullanmadığından bir `SESSION_SECRET`
      gerekmemektedir** — oturumlar veritabanında saklanan rastgele opak
      token'larla doğrulanır. Bu maddenin fiilen uygulanabilmesi için,
      imzalı oturum/CSRF token'ı gibi bir mekanizma eklenirse, o zaman
      `openssl rand -hex 32` ile üretilmiş güçlü ve gizli bir değer
      kullanılmalı ve asla repoya eklenmemelidir

## Veritabanı

- [ ] Production ortamında SQLite yerine PostgreSQL kullanılıyor (bkz.
      `docs/DEPLOYMENT.md` → "PostgreSQL Hazırlığı")
- [ ] PostgreSQL sunucusuna erişim kısıtlandı: sadece uygulama
      sunucusunun IP'sinden bağlantıya izin veren güvenlik duvarı/network
      kuralları var; veritabanı genel internete açık değil
- [ ] Veritabanı kullanıcısının yetkileri sadece bu uygulamanın
      şemasıyla sınırlı (gereksiz superuser yetkisi yok)
- [ ] Düzenli otomatik yedekleme yapılandırıldı ve en az bir kez geri
      yükleme testi yapıldı

## Seed ve Demo Verisi

- [ ] Production ortamında demo seed script'i devre dışı: `DEMO_SEED`
      ortam değişkeni ayarlanmadı/`false` (bkz. `prisma/seed.ts`'teki
      `NODE_ENV=production` kontrolü)
- [ ] Gerçek pilot öncesi, hosted demo ortamından kalan tüm sahte/demo
      veriler (eczaneler, kullanıcılar, çizelgeler, denetim kayıtları)
      temizlendi ve pilot, temiz bir veritabanıyla başlatıldı

## Denetim ve İzleme

- [ ] `/denetim-kayitlari` sayfası düzenli olarak gözden geçiriliyor
      (özellikle kullanıcı rolü/durumu değişiklikleri ve manuel nöbet
      atama değişiklikleri için)
- [ ] Sunucu saat dilimi `Europe/Istanbul` olarak yapılandırıldı
      (nöbet tarihleri ve "bugün/yarın" hesaplamaları buna bağlıdır)
- [ ] Temel hata izleme/loglama (ör. Sentry veya sunucu logları) devrede

## KVKK / Kişisel Veri

- [ ] Eczacı/eczane iletişim bilgileri (isim, telefon, adres) ve kullanıcı
      hesap bilgileri için KVKK kapsamında bir aydınlatma metni hazırlandı
- [ ] Veri saklama süresi ve silme talebi süreci tanımlandı
- [ ] Kişisel verilere erişimi olan kullanıcı hesapları (ADMIN/STAFF)
      gözden geçirildi ve en az yetki ilkesine uygun şekilde sınırlandı

## Ortam Türü Onayı

- [ ] Bu dağıtımın "Barındırılan Demo" mu yoksa "Gerçek Pilot" mu olduğu
      açıkça belirlendi (bkz. `docs/DEPLOYMENT.md` → "Ortam Türleri")
- [ ] Gerçek pilot ise: yukarıdaki tüm maddeler eksiksiz tamamlandı ve
      demo verisi/hesapları kalmadığı doğrulandı
