import { PrismaClient, HolidayType } from "@prisma/client";
import { faker } from "@faker-js/faker/locale/tr";

import { hashPassword } from "../src/lib/auth/password";

const prisma = new PrismaClient();

const REGIONS = [
  { name: "Kadıköy", district: "Kadıköy" },
  { name: "Üsküdar", district: "Üsküdar" },
  { name: "Beşiktaş", district: "Beşiktaş" },
  { name: "Bakırköy", district: "Bakırköy" },
  { name: "Şişli", district: "Şişli" },
];

// Demo-only credentials, never use these in a real deployment.
const USERS = [
  {
    name: "Ayşe Yılmaz",
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

async function main() {
  console.log("Seeding database...");

  await prisma.session.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.dutyAssignment.deleteMany();
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
    const region = regions[i % regions.length];
    return {
      name: `${faker.company.name()} Eczanesi`,
      pharmacistName: faker.person.fullName(),
      address: faker.location.streetAddress({ useFullAddress: true }),
      phone: faker.phone.number({ style: "national" }),
      city: "İstanbul",
      district: region.district,
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

  console.log("Seed completed:");
  console.log(`- ${USERS.length} users`);
  console.log(`- ${regions.length} regions`);
  console.log(`- ${pharmacyData.length} pharmacies`);
  console.log(`- ${HOLIDAYS_2026.length} holidays`);
  console.log(`- ${sampleUnavailablePharmacies.length} unavailability records`);
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
