# QA Kontrol Listesi

Demo veya yayın öncesi manuel doğrulama için kullanılacak kontrol listesi.
Her madde işaretlendiğinde beklenen davranışı da not edin.

Demo hesapları için bkz. `README.md` → "Giriş Bilgileri".

## 1. Giriş / Çıkış (Login / Logout)

- [ ] `/giris` sayfası doğru e-posta/şifre ile giriş yapılabiliyor
- [ ] Hatalı e-posta/şifre ile "Hatalı e-posta veya şifre." mesajı gösteriliyor
- [ ] Pasif (isActive=false) kullanıcı ile giriş denemesinde "Kullanıcı
      hesabı pasif durumdadır." mesajı gösteriliyor
- [ ] Giriş yapmadan `/` adresine gidildiğinde `/giris` sayfasına
      yönlendiriliyor
- [ ] "Çıkış Yap" butonu oturumu sonlandırıyor ve `/giris` sayfasına
      yönlendiriyor
- [ ] Çıkış yaptıktan sonra herhangi bir admin sayfasına gidilmeye
      çalışıldığında tekrar `/giris`'e yönlendiriliyor

## 2. Rol Yetkileri (Genel)

- [ ] ADMIN tüm sayfalara ve işlemlere erişebiliyor
- [ ] STAFF kurulum verilerini yönetebiliyor, çizelge oluşturabiliyor,
      yayınlayabiliyor, atama düzenleyebiliyor
- [ ] VIEWER sadece görüntüleyebiliyor; oluşturma/düzenleme/silme
      butonları görünmüyor
- [ ] Yetkisiz bir işlem denendiğinde (ör. doğrudan URL ile) "Bu işlem
      için yetkiniz bulunmuyor." veya "Bu sayfaya erişim yetkiniz
      bulunmuyor." mesajı gösteriliyor

## 3. Kullanıcı Yönetimi (Sadece ADMIN)

- [ ] `/kullanicilar` sadece ADMIN'e görünüyor (kenar çubuğunda da)
- [ ] STAFF ve VIEWER `/kullanicilar` adresine gittiğinde yönlendiriliyor
      ve Türkçe uyarı gösteriliyor
- [ ] Yeni kullanıcı oluşturma çalışıyor (ad, e-posta, rol, şifre, şifre
      tekrarı doğrulamaları dahil)
- [ ] Yeni oluşturulan kullanıcı ile giriş yapılabiliyor
- [ ] Kullanıcı düzenleme (ad/e-posta/rol/durum) çalışıyor
- [ ] Şifre alanları boş bırakıldığında mevcut şifre korunuyor
- [ ] Aktif/Pasif geçişi çalışıyor
- [ ] ADMIN kendi hesabını pasife alamıyor ("Kendi hesabınız" notu
      gösteriliyor, geçiş butonu yok)
- [ ] Sistemdeki son aktif ADMIN pasife alınamıyor ("Sistemde en az bir
      aktif yönetici bulunmalıdır." mesajı gösteriliyor)

## 4. Eczane CRUD

- [ ] Eczane listesi görüntüleniyor, isim/eczacı adına göre arama çalışıyor
- [ ] Bölge ve durum (aktif/pasif) filtreleri çalışıyor
- [ ] Yeni eczane oluşturma çalışıyor, zorunlu alan doğrulamaları Türkçe
- [ ] Eczane düzenleme çalışıyor
- [ ] Aktif/Pasif geçişi çalışıyor
- [ ] Nöbet ataması olan bir eczane silinmeye çalışıldığında Türkçe uyarı
      ile engelleniyor

## 5. Bölge CRUD

- [ ] Bölge listesi ve eczane sayısı doğru görüntüleniyor
- [ ] Yeni bölge oluşturma / düzenleme çalışıyor
- [ ] Aktif/Pasif geçişi çalışıyor
- [ ] Eczanesi olan bir bölge silinmeye çalışıldığında Türkçe uyarı ile
      engelleniyor

## 6. Nöbet Kuralı CRUD

- [ ] Her bölge için kural oluşturma/düzenleme çalışıyor
- [ ] Asgari nöbet aralığı, ağırlık alanları için sayısal doğrulama çalışıyor
      (negatif/sıfır değerler için Türkçe hata mesajı)

## 7. Tatil Günü CRUD

- [ ] Tatil günü listesi görüntüleniyor
- [ ] Yeni tatil günü ekleme (Resmî Tatil / Dini Bayram / Diğer türleri)
- [ ] Tatil günü düzenleme ve silme çalışıyor

## 8. Mazeret CRUD

- [ ] Mazeret listesi görüntüleniyor
- [ ] Yeni mazeret ekleme; eczane seçimi bölgeye göre gruplanmış listeden
      yapılabiliyor
- [ ] Bitiş tarihi başlangıçtan önce girildiğinde Türkçe hata gösteriliyor
- [ ] Mazeret düzenleme ve silme çalışıyor

## 9. Nöbet Çizelgesi Oluşturma

- [ ] `/cizelgeler/yeni` üzerinden bölge/ay/yıl seçilerek çizelge
      oluşturuluyor
- [ ] Aynı bölge/ay/yıl için tekrar oluşturma denendiğinde Türkçe uyarı
      gösteriliyor
- [ ] Aktif eczanesi veya kuralı olmayan bölge seçildiğinde Türkçe hata
      gösteriliyor
- [ ] Yetersiz uygun eczane olan günler için uyarı oluşuyor ve detay
      sayfasında listeleniyor (sistem çökmüyor)

## 10. Manuel Atama Değişikliği

- [ ] Çizelge detay sayfasında bir atama için "Düzenle" çalışıyor
- [ ] Aynı tarihte zaten atanmış bir eczane seçildiğinde engelleniyor
- [ ] Mazeretli bir eczane seçildiğinde engelleniyor
- [ ] Asgari nöbet aralığı ihlalinde Türkçe uyarı ve onay kutusu
      gösteriliyor; onaylanınca kayıt tamamlanıyor
- [ ] Değişiklik nedeni zorunlu
- [ ] Değişiklik sonrası "Manuel" rozeti ve not/gerekçe görüntüleniyor

## 11. Denetim Kaydı (Audit Log)

- [ ] `/denetim-kayitlari` sayfası son işlemleri Türkçe etiketlerle
      gösteriyor (Oluşturuldu/Güncellendi/Silindi)
- [ ] Manuel atama değişiklikleri "eski eczane → yeni eczane (Neden: ...)"
      biçiminde görüntüleniyor
- [ ] Kullanıcı işlemleri (oluşturma/güncelleme/rol/durum/şifre değişikliği)
      görüntüleniyor ve şifre bilgisi hiçbir yerde görünmüyor

## 12. Excel Dışa Aktarma

- [ ] Çizelge detay veya liste sayfasından "Excel'e Aktar" indirme
      başlatıyor
- [ ] Dosya adı ASCII güvenli (ör. `nobet-cizelgesi-2026-07-kadikoy.xlsx`)
- [ ] Excel içeriğinde tüm sütunlar (Tarih, Gün, Bölge, Nöbetçi Eczane,
      Eczacı, Telefon, Adres, Ağırlık, Manuel Değişiklik, Not) doğru

## 13. PDF Dışa Aktarma

- [ ] "PDF İndir" indirme başlatıyor
- [ ] Türkçe karakterler (ş, ğ, ı, İ, ö, ü, ç) doğru görüntüleniyor
- [ ] Sayfalama (birden fazla sayfa) doğru çalışıyor

## 14. Yayınlama / Yayından Kaldırma

- [ ] Taslak bir çizelge "Yayınla" ile yayına alınabiliyor
- [ ] Yayındaki bir çizelge "Yayından Kaldır" ile taslağa alınabiliyor
- [ ] Yayında olan bir çizelge silinmeye çalışıldığında Türkçe uyarı ile
      engelleniyor
- [ ] Yayın durumu değişiklikleri denetim kaydında görünüyor

## 15. Vatandaş Ekranı (Public)

- [ ] `/vatandas` giriş yapılmadan erişilebiliyor
- [ ] Sadece yayınlanmış çizelgelerden veri gösteriliyor
- [ ] Bölge filtresi çalışıyor
- [ ] "Bugünün" ve "Yarınki" nöbetçi eczaneleri doğru gösteriliyor
- [ ] Tarih seçimi ile başka bir gün sorgulanabiliyor
- [ ] Yayınlanmış veri olmayan tarih/bölge için Türkçe boş durum mesajı
      gösteriliyor: "Bu tarih için yayımlanmış nöbetçi eczane bilgisi
      bulunamadı."
- [ ] Eczane telefonu, adresi ve (varsa) yol tarifi bağlantısı görüntüleniyor
- [ ] İlaç stoğu, fiyat, rezervasyon veya reklam gibi kapsam dışı bilgi
      YOK

## 16. Genel UI Kontrolü

- [ ] Tüm görünen metinler Türkçe (İngilizce etiket kalmamış)
- [ ] Sayfa başlıkları ve buton etiketleri tutarlı
- [ ] Boş durumlar (kayıt yok) anlaşılır mesajlarla gösteriliyor
- [ ] Tablolar laptop ekranında okunabilir (yatay kaydırma gerekiyorsa
      düzgün çalışıyor)
- [ ] Geliştirici/debug metni (console çıktısı, TODO, lorem ipsum vb.)
      arayüzde görünmüyor
