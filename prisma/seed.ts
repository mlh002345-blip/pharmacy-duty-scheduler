import { PrismaClient, HolidayType } from "@prisma/client";
import { faker } from "@faker-js/faker/locale/tr";

import { hashPassword } from "../src/lib/auth/password";
import { generateAndSaveDutySchedule } from "../src/lib/scheduling/generate-and-save-duty-schedule";

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

function pharmacyName(lastName: string): string {
  // Most Turkish pharmacies are named after the pharmacist's surname.
  const useGenericName = faker.datatype.boolean({ probability: 0.25 });
  if (useGenericName) {
    return faker.helpers.arrayElement(GENERIC_PHARMACY_NAMES);
  }
  return `${lastName} Eczanesi`;
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
  await prisma.dutyAssignment.deleteMany();
  await prisma.dutyScheduleWarning.deleteMany();
  await prisma.dutySchedule.deleteMany();
  await prisma.unavailability.deleteMany();
  await prisma.holiday.deleteMany();
  await prisma.dutyRule.deleteMany();
  await prisma.pharmacy.deleteMany();
  await prisma.region.deleteMany();
  await prisma.user.deleteMany();

  await Promise.all(
    USERS.map(async (user) =>
      prisma.user.create({
        data: {
          name: user.name,
          email: user.email,
          role: user.role,
          isActive: true,
          passwordHash: await hashPassword(user.password),
        },
      })
    )
  );

  const regions = await Promise.all(
    REGIONS.map((region) =>
      prisma.region.create({
        data: { name: region.name, district: region.district, dailyDutyCount: 1 },
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

  const pharmacyData = Array.from({ length: 100 }).map((_, i) => {
    const regionConfig = REGIONS[i % REGIONS.length];
    const region = regions[i % regions.length];
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();

    const name = pharmacyName(lastName);
    const address = turkishAddress(regionConfig.district);

    return {
      name,
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

  const publishedSchedule = await generateAndSaveDutySchedule({
    month: currentMonth,
    year: currentYear,
    regionId: publishedRegion.id,
  });
  await prisma.dutySchedule.update({
    where: { id: publishedSchedule.id },
    data: { status: "PUBLISHED" },
  });

  await generateAndSaveDutySchedule({
    month: currentMonth,
    year: currentYear,
    regionId: draftRegion.id,
  });

  console.log("Seed completed:");
  console.log(`- ${USERS.length} users`);
  console.log(`- ${regions.length} regions`);
  console.log(`- ${pharmacyData.length} pharmacies`);
  console.log(`- ${HOLIDAYS_2026.length} holidays`);
  console.log(`- ${sampleUnavailablePharmacies.length} unavailability records`);
  console.log(
    `- 1 published schedule (${publishedRegion.name}, ${currentMonth}/${currentYear})`
  );
  console.log(`- 1 draft schedule (${draftRegion.name}, ${currentMonth}/${currentYear})`);
  console.log("");
  console.log("Demo login credentials (local development only):");
  for (const user of USERS) {
    console.log(`- ${user.role}: ${user.email} / ${user.password}`);
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
