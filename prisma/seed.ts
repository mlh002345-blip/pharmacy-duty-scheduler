import { randomBytes } from "node:crypto";

import { PrismaClient, HolidayType } from "@prisma/client";
import { faker } from "@faker-js/faker/locale/tr";

import { hashPassword } from "../src/lib/auth/password";
import { generateAndSaveDutySchedule } from "../src/lib/scheduling/generate-and-save-duty-schedule";
import { normalizeText } from "../src/lib/historical/normalize";

const prisma = new PrismaClient();

// Side of Istanbul each district sits on, used to generate a plausible
// landline area code (0216 Anadolu / 0212 Avrupa) instead of faker's
// made-up area codes.
const REGIONS = [
  { name: "Kadıköy", district: "Kadıköy", areaCode: "0216" },
  { name: "Üsküdar", district: "Üsküdar", areaCode: "0216" },
  { name: "Beşiktaş", district: "Beşiktaş", areaCode: "0212" },
  { name: "Bakırköy", district: "Bakırköy", areaCode: "0212" },
  { name: "Şişli", district: "Şişli", areaCode: "0212" },
];

// Demo-only credentials, never use these in a real deployment.
const USERS = [
  {
    // Kurum adı: panel "Hoş geldiniz, Eczacı Odası" göstersin diye
    // yönetici görünen adı kişi adı değil kurum adıdır.
    name: "Eczacı Odası",
    email: "admin@example.com",
    password: "Admin123!",
    role: "ADMIN" as const,
  },
  {
    name: "Mehmet Demir",
    email: "staff@example.com",
    password: "Staff123!",
    role: "STAFF" as const,
  },
  {
    name: "Zeynep Kaya",
    email: "viewer@example.com",
    password: "Viewer123!",
    role: "VIEWER" as const,
  },
];

const HOLIDAYS_2026: { name: string; date: string; type: HolidayType }[] = [
  { name: "Yılbaşı", date: "2026-01-01", type: "OFFICIAL" },
  { name: "Ulusal Egemenlik ve Çocuk Bayramı", date: "2026-04-23", type: "OFFICIAL" },
  { name: "Emek ve Dayanışma Günü", date: "2026-05-01", type: "OFFICIAL" },
  { name: "Atatürk'ü Anma, Gençlik ve Spor Bayramı", date: "2026-05-19", type: "OFFICIAL" },
  { name: "Demokrasi ve Millî Birlik Günü", date: "2026-07-15", type: "OFFICIAL" },
  { name: "Zafer Bayramı", date: "2026-08-30", type: "OFFICIAL" },
  { name: "Cumhuriyet Bayramı", date: "2026-10-29", type: "OFFICIAL" },
  { name: "Ramazan Bayramı 1. Gün", date: "2026-03-20", type: "RELIGIOUS" },
  { name: "Ramazan Bayramı 2. Gün", date: "2026-03-21", type: "RELIGIOUS" },
  { name: "Ramazan Bayramı 3. Gün", date: "2026-03-22", type: "RELIGIOUS" },
  { name: "Kurban Bayramı 1. Gün", date: "2026-05-27", type: "RELIGIOUS" },
  { name: "Kurban Bayramı 2. Gün", date: "2026-05-28", type: "RELIGIOUS" },
  { name: "Kurban Bayramı 3. Gün", date: "2026-05-29", type: "RELIGIOUS" },
  { name: "Kurban Bayramı 4. Gün", date: "2026-05-30", type: "RELIGIOUS" },
];

// Common generic Turkish pharmacy names, used alongside surname-based names
// (e.g. "Yılmaz Eczanesi") for realistic variety without artificial-looking
// faker output like "X and Sons" or "X Group".
const GENERIC_PHARMACY_NAMES = [
  "Merkez Eczanesi",
  "Şifa Eczanesi",
  "Deva Eczanesi",
  "Sağlık Eczanesi",
  "Güven Eczanesi",
  "Anadolu Eczanesi",
  "Yeni Eczanesi",
  "Umut Eczanesi",
  "Hayat Eczanesi",
  "Yıldız Eczanesi",
  "Çınar Eczanesi",
  "Barış Eczanesi",
  "Yaşam Eczanesi",
  "Dost Eczanesi",
  "Kardelen Eczanesi",
  "Vefa Eczanesi",
  "Gül Eczanesi",
  "Nur Eczanesi",
  "İmge Eczanesi",
  "Ada Eczanesi",
  "Cihan Eczanesi",
  "Zafer Eczanesi",
  "Selvi Eczanesi",
  "Vadi Eczanesi",
];

function turkishLandlinePhone(areaCode: string): string {
  const exchange = faker.number.int({ min: 200, max: 899 });
  const part2 = faker.number.int({ min: 10, max: 99 });
  const part3 = faker.number.int({ min: 10, max: 99 });
  return `${areaCode} ${exchange} ${part2} ${part3}`;
}

function turkishAddress(district: string): string {
  return `${faker.location.streetAddress()}, ${district}/İstanbul`;
}

// Eczane adları veri sağlık kontrolünün "aynı isimle birden fazla eczane
// kaydı" kritik hatasını tetiklememesi için demo genelinde benzersiz
// üretilir. Önce ortak/jenerik isim havuzundan (henüz kullanılmamışsa),
// yoksa soyadı tabanlı bir isimle — soyadı çakışırsa yeni bir soyadıyla
// tekrar denenir.
function generateUniquePharmacyName(usedNames: Set<string>): {
  name: string;
  firstName: string;
  lastName: string;
} {
  const firstName = faker.person.firstName();
  const preferGeneric = faker.datatype.boolean({ probability: 0.25 });

  if (preferGeneric) {
    const availableGeneric = GENERIC_PHARMACY_NAMES.find((n) => !usedNames.has(n));
    if (availableGeneric) {
      usedNames.add(availableGeneric);
      return { name: availableGeneric, firstName, lastName: faker.person.lastName() };
    }
  }

  let lastName = faker.person.lastName();
  let name = `${lastName} Eczanesi`;
  let attempts = 0;
  while (usedNames.has(name) && attempts < 100) {
    lastName = faker.person.lastName();
    name = `${lastName} Eczanesi`;
    attempts += 1;
  }
  usedNames.add(name);
  return { name, firstName, lastName };
}

// Bu script veritabanını tamamen temizleyip sahte demo verisiyle doldurur.
// Production ortamında yanlışlıkla çalıştırılıp gerçek verinin silinmesini
// önlemek için: NODE_ENV=production iken DEMO_SEED=true açıkça verilmedikçe
// çalışmayı reddeder. Yerel/geliştirme ortamında (NODE_ENV production değilken)
// herhangi bir ek bayrağa gerek yoktur. Ayrıntılar için docs/DEPLOYMENT.md.
function assertSeedIsSafeToRun() {
  const isProduction = process.env.NODE_ENV === "production";
  const demoSeedEnabled = process.env.DEMO_SEED === "true";

  if (isProduction && !demoSeedEnabled) {
    console.error(
      "HATA: NODE_ENV=production ortamında demo seed script'i varsayılan " +
        "olarak engellenir (mevcut veriler silinip demo verisiyle " +
        "değiştirilir). Bunu bilerek ve isteyerek çalıştırmak için " +
        "DEMO_SEED=true ortam değişkenini ayarlayın. Gerçek bir pilot/" +
        "production ortamında bu script'i ASLA çalıştırmayın — bkz. " +
        "docs/DEPLOYMENT.md ve docs/SECURITY_CHECKLIST.md."
    );
    process.exit(1);
  }
}

async function main() {
  assertSeedIsSafeToRun();

  console.log("Seeding database...");

  await prisma.session.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.dutyRequest.deleteMany();
  await prisma.dutyBalanceAdjustment.deleteMany();
  await prisma.historicalDutyRecord.deleteMany();
  await prisma.historicalDutyImportBatch.deleteMany();
  await prisma.dutyAssignment.deleteMany();
  await prisma.dutyScheduleWarning.deleteMany();
  await prisma.dutySchedule.deleteMany();
  await prisma.unavailability.deleteMany();
  await prisma.holiday.deleteMany();
  await prisma.dutyRule.deleteMany();
  await prisma.pharmacy.deleteMany();
  await prisma.region.deleteMany();
  await prisma.user.deleteMany();

  // Demo seed data belongs to one demo organization — never hardcoded to
  // a real chamber's name (see docs/architecture/MULTI_TENANCY.md).
  const organization = await prisma.organization.create({
    data: {
      name: "Demo Eczacı Odası",
      province: "Demo",
      slug: "demo-eczaci-odasi",
      isActive: true,
    },
  });

  const createdUsers = await Promise.all(
    USERS.map(async (user) =>
      prisma.user.create({
        data: {
          name: user.name,
          email: user.email,
          role: user.role,
          isActive: true,
          organizationId: organization.id,
          passwordHash: await hashPassword(user.password),
        },
      })
    )
  );
  const adminUser = createdUsers.find((u) => u.role === "ADMIN")!;

  const regions = await Promise.all(
    REGIONS.map((region) =>
      prisma.region.create({
        data: {
          name: region.name,
          district: region.district,
          dailyDutyCount: 1,
          organizationId: organization.id,
        },
      })
    )
  );

  await Promise.all(
    regions.map((region) =>
      prisma.dutyRule.create({
        data: {
          minDaysBetweenDuties: 7,
          weekdayWeight: 1,
          saturdayWeight: 1.25,
          sundayWeight: 1.5,
          officialHolidayWeight: 2,
          religiousHolidayWeight: 2,
          regionId: region.id,
        },
      })
    )
  );

  const usedPharmacyNames = new Set<string>();
  const pharmacyData = Array.from({ length: 100 }).map((_, i) => {
    const regionConfig = REGIONS[i % REGIONS.length];
    const region = regions[i % regions.length];
    const { name, firstName, lastName } = generateUniquePharmacyName(usedPharmacyNames);
    const address = turkishAddress(regionConfig.district);

    return {
      name,
      normalizedName: normalizeText(name),
      pharmacistName: `${firstName} ${lastName}`,
      address,
      phone: turkishLandlinePhone(regionConfig.areaCode),
      city: "İstanbul",
      district: regionConfig.district,
      // API anahtarı gerektirmeyen basit bir harita arama bağlantısı;
      // vatandaş ekranındaki "Yol Tarifi Al" butonu bu alanı kullanır.
      mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${name} ${address}`
      )}`,
      isActive: faker.datatype.boolean({ probability: 0.9 }),
      regionId: region.id,
      // Herkese açık nöbet talep formu (/eczane-talep/[token]) için
      // tahmin edilemez, eczaneye özel bağlantı anahtarı.
      requestToken: randomBytes(16).toString("hex"),
    };
  });

  await prisma.pharmacy.createMany({ data: pharmacyData });
  const pharmacies = await prisma.pharmacy.findMany();

  await prisma.holiday.createMany({
    data: HOLIDAYS_2026.map((h) => ({
      name: h.name,
      date: new Date(h.date),
      type: h.type,
    })),
  });

  const sampleUnavailablePharmacies = faker.helpers.arrayElements(
    pharmacies,
    10
  );

  await prisma.unavailability.createMany({
    data: sampleUnavailablePharmacies.map((pharmacy) => {
      const startDate = faker.date.soon({ days: 60 });
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + faker.number.int({ min: 1, max: 5 }));

      return {
        pharmacyId: pharmacy.id,
        startDate,
        endDate,
        reason: faker.helpers.arrayElement([
          "Yıllık izin",
          "Tadilat",
          "Sağlık raporu",
          "Ruhsat devri",
        ]),
      };
    }),
  });

  // Demo schedules: one published (so /vatandas shows real data for the
  // current date right after seeding) and one left as a draft (so the
  // draft/publish workflow has something to demonstrate immediately).
  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const currentYear = now.getUTCFullYear();

  // The public /vatandas screen defaults to the alphabetically-first active
  // region (matching its own query), not creation order — align here so the
  // default view shows real data immediately after seeding, with no need to
  // pick a region first.
  const regionsByName = [...regions].sort((a, b) => a.name.localeCompare(b.name, "tr"));
  const publishedRegion = regionsByName[0];
  const draftRegion = regionsByName[1];

  // Örnek geçmiş nöbet aktarımı: yayınlanacak bölgenin eczaneleri için bir
  // önceki ayın nöbet listesi "içe aktarılmış" gibi kaydedilir. Böylece
  // /gecmis-nobetler dolu gelir ve çizelge üretimi (aşağıda) geçmiş yükü
  // denge skoruna gerçekten dahil eder. Kayıtlar DutyAssignment'a dönüşmez.
  const prevMonthDate = new Date(Date.UTC(currentYear, currentMonth - 2, 1));
  const prevMonth = prevMonthDate.getUTCMonth() + 1;
  const prevYear = prevMonthDate.getUTCFullYear();
  const daysInPrevMonth = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();

  const historicalPharmacies = pharmacies.filter(
    (p) => p.regionId === publishedRegion.id && p.isActive
  );
  const historicalBatch = await prisma.historicalDutyImportBatch.create({
    data: {
      organizationId: organization.id,
      fileName: "ornek-gecmis-nobet-listesi.xlsx",
      note: "Demo verisi: bir önceki ayın nöbet listesi",
      rowCount: daysInPrevMonth + 1,
      matchedCount: daysInPrevMonth,
      unmatchedCount: 1,
      warningCount: 1,
    },
  });

  await prisma.historicalDutyRecord.createMany({
    data: Array.from({ length: daysInPrevMonth }).map((_, dayIndex) => {
      const dutyDate = new Date(Date.UTC(prevYear, prevMonth - 1, dayIndex + 1));
      const dayOfWeek = dutyDate.getUTCDay();
      const weight = dayOfWeek === 0 ? 1.3 : dayOfWeek === 6 ? 1.2 : 1.0;
      const pharmacy = historicalPharmacies[dayIndex % historicalPharmacies.length];
      return {
        batchId: historicalBatch.id,
        rowNumber: dayIndex + 2,
        dutyDate,
        rawPharmacyName: pharmacy.name,
        rawRegionName: publishedRegion.name,
        rawDutyType:
          dayOfWeek === 0 || dayOfWeek === 6 ? "Hafta Sonu" : "Normal",
        dutyType: dayOfWeek === 0 || dayOfWeek === 6 ? "Hafta Sonu" : "Normal",
        weight,
        matchStatus: "MATCHED" as const,
        pharmacyId: pharmacy.id,
        regionId: publishedRegion.id,
      };
    }),
  });

  // Eşleşmeyen örnek kayıt: kapanmış bir eczane — denge skoruna katılmaz.
  await prisma.historicalDutyRecord.create({
    data: {
      batchId: historicalBatch.id,
      rowNumber: daysInPrevMonth + 2,
      dutyDate: new Date(Date.UTC(prevYear, prevMonth - 1, 15)),
      rawPharmacyName: "Kapanmış Eczane",
      rawRegionName: publishedRegion.name,
      rawDutyType: "Normal",
      dutyType: "Normal",
      weight: 1.0,
      matchStatus: "UNMATCHED",
      warningMessage: "Bu ada sahip bir eczane sistemde bulunamadı.",
      regionId: publishedRegion.id,
    },
  });

  // Örnek manuel denge düzeltmesi.
  await prisma.dutyBalanceAdjustment.create({
    data: {
      pharmacyId: historicalPharmacies[0].id,
      points: 5,
      reason:
        "Daha eski kayıtlar sisteme aktarılamadığı için +5 başlangıç yükü eklendi.",
    },
  });

  // Örnek nöbet talepleri: eczacı odasının inceleyeceği bekleyen talepler,
  // çizelge oluşturmayı gerçekten etkileyecek onaylı bir nöbet tutamama
  // talebi ve reddedilmiş bir örnek.
  const dutyRequestSamplePharmacies = faker.helpers.arrayElements(
    historicalPharmacies,
    Math.min(4, historicalPharmacies.length)
  );
  const dutyRequestScheduleStart = new Date(Date.UTC(currentYear, currentMonth - 1, 5));
  const dutyRequestScheduleEnd = new Date(Date.UTC(currentYear, currentMonth - 1, 7));

  await prisma.dutyRequest.create({
    data: {
      pharmacyId: dutyRequestSamplePharmacies[0].id,
      regionId: publishedRegion.id,
      requestType: "CANNOT_DUTY",
      startDate: dutyRequestScheduleStart,
      endDate: dutyRequestScheduleEnd,
      explanation: "Tadilat nedeniyle bu tarihlerde nöbet tutulamayacaktır.",
      status: "PENDING",
      source: "PUBLIC_LINK",
    },
  });
  await prisma.dutyRequest.create({
    data: {
      pharmacyId: dutyRequestSamplePharmacies[1 % dutyRequestSamplePharmacies.length].id,
      regionId: publishedRegion.id,
      requestType: "PREFER_DUTY",
      startDate: new Date(Date.UTC(currentYear, currentMonth - 1, 14)),
      endDate: new Date(Date.UTC(currentYear, currentMonth - 1, 14)),
      explanation: "Bu tarihte nöbet tutmayı tercih ediyoruz.",
      status: "PENDING",
      source: "ADMIN_ENTRY",
    },
  });
  await prisma.dutyRequest.create({
    data: {
      pharmacyId: dutyRequestSamplePharmacies[2 % dutyRequestSamplePharmacies.length].id,
      regionId: publishedRegion.id,
      requestType: "CANNOT_DUTY",
      startDate: new Date(Date.UTC(currentYear, currentMonth - 1, 20)),
      endDate: new Date(Date.UTC(currentYear, currentMonth - 1, 21)),
      explanation: "Aile ferdinin sağlık durumu nedeniyle nöbet tutulamayacaktır.",
      status: "APPROVED",
      source: "ADMIN_ENTRY",
      reviewedById: adminUser.id,
      reviewedAt: new Date(),
      reviewNote: "Onaylandı; bu tarihlerde çizelgede bu eczaneye atama yapılmayacak.",
    },
  });
  await prisma.dutyRequest.create({
    data: {
      pharmacyId: dutyRequestSamplePharmacies[3 % dutyRequestSamplePharmacies.length].id,
      regionId: publishedRegion.id,
      requestType: "SWAP_REQUEST",
      startDate: new Date(Date.UTC(currentYear, currentMonth - 1, 10)),
      endDate: new Date(Date.UTC(currentYear, currentMonth - 1, 10)),
      explanation: "Başka bir eczane ile nöbet değişimi talep ediyoruz.",
      status: "REJECTED",
      source: "ADMIN_ENTRY",
      reviewedById: adminUser.id,
      reviewedAt: new Date(),
      reviewNote: "Değişim için karşı eczane onayı sağlanamadı.",
    },
  });

  const { schedule: publishedSchedule } = await generateAndSaveDutySchedule({
    month: currentMonth,
    year: currentYear,
    regionId: publishedRegion.id,
    organizationId: organization.id,
    userId: adminUser.id,
  });
  await prisma.dutySchedule.update({
    where: { id: publishedSchedule.id },
    data: { status: "PUBLISHED" },
  });

  await generateAndSaveDutySchedule({
    month: currentMonth,
    year: currentYear,
    regionId: draftRegion.id,
    organizationId: organization.id,
    userId: adminUser.id,
  });

  console.log("Seed completed:");
  console.log(`- ${USERS.length} users`);
  console.log(`- ${regions.length} regions`);
  console.log(`- ${pharmacyData.length} pharmacies`);
  console.log(`- ${HOLIDAYS_2026.length} holidays`);
  console.log(`- ${sampleUnavailablePharmacies.length} unavailability records`);
  console.log(
    `- ${daysInPrevMonth} matched + 1 unmatched historical duty records (${prevMonth}/${prevYear}, ${publishedRegion.name})`
  );
  console.log(`- 1 manual balance adjustment (+5, ${historicalPharmacies[0].name})`);
  console.log(
    "- 4 duty requests (2 pending, 1 approved nöbet tutamama, 1 rejected)"
  );
  console.log(
    `- 1 published schedule (${publishedRegion.name}, ${currentMonth}/${currentYear})`
  );
  console.log(`- 1 draft schedule (${draftRegion.name}, ${currentMonth}/${currentYear})`);
  console.log("");
  console.log("Demo login credentials (local development only):");
  for (const user of USERS) {
    console.log(`- ${user.role}: ${user.email} / [redacted demo password]`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
