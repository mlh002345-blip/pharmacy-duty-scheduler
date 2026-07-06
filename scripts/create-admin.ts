// Tek seferlik, production-güvenli ilk yönetici (ADMIN) kullanıcısı oluşturma
// script'i. Hosted demo/pilot ortamında `prisma migrate deploy` sonrası,
// arayüzden kullanıcı oluşturma imkanı olmadan ilk girişi yapabilmek için
// kullanılır. Ayrıntılar için docs/DEPLOYMENT.md.
//
// Kullanım:
//   ADMIN_NAME="Sistem Yöneticisi" \
//   ADMIN_EMAIL="admin@odaniz.org.tr" \
//   ADMIN_PASSWORD="guclu-bir-sifre" \
//   npm run db:create-admin
//
// Aynı e-posta ile zaten bir kullanıcı varsa, script hiçbir şeyi değiştirmez
// ve çıkış kodu 1 ile durur. Var olan kullanıcıyı ADMIN'e yükseltip şifresini
// güncellemek isterseniz ADMIN_ALLOW_OVERWRITE=true ekleyin.

import { PrismaClient } from "@prisma/client";

import { hashPassword } from "../src/lib/auth/password";

const prisma = new PrismaClient();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`${name} ortam değişkeni ayarlanmalıdır.`);
  }
  return value;
}

async function main() {
  const name = requireEnv("ADMIN_NAME");
  const email = requireEnv("ADMIN_EMAIL").trim().toLowerCase();
  const password = requireEnv("ADMIN_PASSWORD");
  const allowOverwrite = process.env.ADMIN_ALLOW_OVERWRITE === "true";

  if (password.length < 8) {
    throw new Error("ADMIN_PASSWORD en az 8 karakter olmalıdır.");
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing && !allowOverwrite) {
    console.error(
      `HATA: '${email}' e-postalı bir kullanıcı zaten var (rol: ${existing.role}). ` +
        "Var olan kullanıcıyı ADMIN'e yükseltip şifresini güncellemek için " +
        "ADMIN_ALLOW_OVERWRITE=true ile tekrar çalıştırın. Hiçbir değişiklik yapılmadı."
    );
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);

  if (existing) {
    await prisma.user.update({
      where: { email },
      data: { name, passwordHash, role: "ADMIN", isActive: true },
    });
    console.log(`Var olan kullanıcı ('${email}') ADMIN olarak güncellendi.`);
  } else {
    await prisma.user.create({
      data: { name, email, passwordHash, role: "ADMIN", isActive: true },
    });
    console.log(`İlk yönetici kullanıcı oluşturuldu: ${email}`);
  }

  // Şifre hash'i hiçbir zaman loglanmaz/yazdırılmaz.
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
