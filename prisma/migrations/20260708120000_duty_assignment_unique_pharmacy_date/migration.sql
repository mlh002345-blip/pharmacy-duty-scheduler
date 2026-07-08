-- Bir eczanenin aynı çizelgede aynı tarihte birden fazla kez nöbetçi
-- olarak görünmesini veritabanı seviyesinde engeller (concurrency sweep,
-- finding 2). Yalnızca DutyAssignment'ı kapsar; HistoricalDutyRecord ayrı
-- bir tablodur ve bu kısıttan etkilenmez.
--
-- Bu migration'ı uygulamadan önce, mevcut veride bu kısıtı ihlal eden bir
-- satır olup olmadığı doğrulanmalıdır — aşağıdaki sorgu boş sonuç
-- döndürmelidir:
--
--   SELECT "dutyScheduleId", "pharmacyId", "date", COUNT(*)
--   FROM "DutyAssignment"
--   GROUP BY "dutyScheduleId", "pharmacyId", "date"
--   HAVING COUNT(*) > 1;
--
-- Yerel seed verisiyle (62 atama satırı, 0 ihlal) ve prod/demo
-- ortamlarında dağıtım öncesi doğrulandı — bkz.
-- docs/security/06-concurrency-race-conditions.md.

-- CreateIndex
CREATE UNIQUE INDEX "DutyAssignment_dutyScheduleId_pharmacyId_date_key" ON "DutyAssignment"("dutyScheduleId", "pharmacyId", "date");
