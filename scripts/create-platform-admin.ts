// Tek seferlik, production-güvenli ilk PLATFORM_ADMIN oluşturma script'i.
// `prisma migrate deploy` sonrası, Railway SSH veya ham SQL gerektirmeden
// (örn. geçici bir pre-deploy komutu olarak) ilk platform yöneticisini
// oluşturmak için kullanılır. Ayrıntılar için
// docs/operations/MULTI_TENANCY_PRODUCTION_DEPLOYMENT.md.
//
// Kullanım:
//   PLATFORM_ADMIN_EMAIL="platform@ornek.org" \
//   PLATFORM_ADMIN_PASSWORD="guclu-bir-sifre" \
//   PLATFORM_ADMIN_NAME="Platform Yöneticisi" \   # isteğe bağlı
//   npm run db:create-platform-admin
//
// Güvenlik kuralları (scripts/create-admin.ts'ten daha katı — bu script
// bilinçli olarak overwrite bayrağı DESTEKLEMEZ):
//   - Aynı e-postalı PLATFORM_ADMIN zaten varsa: hiçbir şey değiştirmeden
//     (şifre dahil) başarıyla çıkar — tekrar çalıştırmak güvenlidir
//     (idempotent).
//   - Aynı e-posta bir kiracı (ADMIN/STAFF/VIEWER) kullanıcısına aitse:
//     hiçbir şey değiştirmeden hata koduyla durur.
//   - Farklı e-postalı bir PLATFORM_ADMIN zaten varsa: hiçbir şey
//     değiştirmeden hata koduyla durur (bu bir ilk-kurulum script'idir).
//   - Şifre ve şifre hash'i hiçbir zaman loglanmaz/yazdırılmaz;
//     DATABASE_URL hiçbir zaman yazdırılmaz.

import { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { hashPassword } from "../src/lib/auth/password";
import { toSafeError } from "../src/lib/observability/logger";

// src/lib/validations/user.ts ile aynı e-posta/şifre kuralları
// (trim + zod email; şifre en az 8 karakter). E-posta, uygulamanın kendi
// login akışıyla eşleşmesi için küçük harfe normalize edilir.
export const platformAdminInputSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "PLATFORM_ADMIN_EMAIL zorunludur.")
    .email("PLATFORM_ADMIN_EMAIL geçerli bir e-posta olmalıdır.")
    .transform((value) => value.toLowerCase()),
  password: z
    .string()
    .min(8, "PLATFORM_ADMIN_PASSWORD en az 8 karakter olmalıdır."),
  name: z.string().trim().min(1).default("Platform Yöneticisi"),
});

export type PlatformAdminInput = z.input<typeof platformAdminInputSchema>;

export class PlatformAdminBootstrapError extends Error {}

// Ortam değişkenlerini okur; eksikse güvenli (sır içermeyen) bir mesajla
// durur. Şifrenin kendisi hiçbir hata mesajına girmez.
export function readEnvInput(
  env: Record<string, string | undefined>
): PlatformAdminInput {
  const email = env.PLATFORM_ADMIN_EMAIL;
  const password = env.PLATFORM_ADMIN_PASSWORD;
  if (!email || email.trim() === "") {
    throw new PlatformAdminBootstrapError(
      "PLATFORM_ADMIN_EMAIL ortam değişkeni ayarlanmalıdır."
    );
  }
  if (!password || password === "") {
    throw new PlatformAdminBootstrapError(
      "PLATFORM_ADMIN_PASSWORD ortam değişkeni ayarlanmalıdır."
    );
  }
  const name = env.PLATFORM_ADMIN_NAME;
  return name && name.trim() !== ""
    ? { email, password, name }
    : { email, password };
}

export type CreatePlatformAdminResult = {
  outcome: "created" | "already-exists";
  email: string;
};

// Yazdırılacak mesajlar tek yerden üretilir; hiçbirine şifre/hash girmez.
export function formatResultMessage(result: CreatePlatformAdminResult): string {
  return result.outcome === "created"
    ? `PLATFORM_ADMIN oluşturuldu: ${result.email}`
    : `PLATFORM_ADMIN zaten mevcut: ${result.email}. Hiçbir değişiklik yapılmadı (şifre değiştirilmedi).`;
}

export async function createPlatformAdmin(
  input: PlatformAdminInput,
  db: PrismaClient
): Promise<CreatePlatformAdminResult> {
  const parsed = platformAdminInputSchema.safeParse(input);
  if (!parsed.success) {
    // Zod mesajları yukarıdaki sabit metinlerdir — girilen değerler
    // (özellikle şifre) mesaja dahil edilmez.
    throw new PlatformAdminBootstrapError(
      parsed.error.issues.map((issue) => issue.message).join(" ")
    );
  }
  const { email, password, name } = parsed.data;

  // Hash, transaction dışında hesaplanır (CPU işi transaction'ı uzatmasın);
  // gerçek uygulamanın kendi scrypt implementasyonu kullanılır.
  const passwordHash = await hashPassword(password);

  return db.$transaction(async (tx) => {
    const otherPlatformAdmin = await tx.user.findFirst({
      where: { role: "PLATFORM_ADMIN", NOT: { email } },
      select: { id: true },
    });
    if (otherPlatformAdmin) {
      throw new PlatformAdminBootstrapError(
        "Farklı bir e-postayla kayıtlı bir PLATFORM_ADMIN zaten var. " +
          "Bu bir ilk-kurulum script'idir; hiçbir değişiklik yapılmadı. " +
          "Ek platform yöneticileri için mevcut PLATFORM_ADMIN hesabını kullanın."
      );
    }

    const existing = await tx.user.findUnique({
      where: { email },
      select: { role: true },
    });

    if (existing && existing.role !== "PLATFORM_ADMIN") {
      throw new PlatformAdminBootstrapError(
        `Bu e-posta zaten bir kiracı kullanıcısına ait (rol: ${existing.role}). ` +
          "Kiracı kullanıcıları PLATFORM_ADMIN'e dönüştürülmez; ayrılmış, yeni bir " +
          "e-posta adresi kullanın. Hiçbir değişiklik yapılmadı."
      );
    }

    if (existing) {
      // Aynı PLATFORM_ADMIN zaten var: şifre dahil hiçbir alan değiştirilmez.
      return { outcome: "already-exists" as const, email };
    }

    await tx.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: "PLATFORM_ADMIN",
        organizationId: null,
        isActive: true,
      },
    });
    return { outcome: "created" as const, email };
  });
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const input = readEnvInput(process.env);
    const result = await createPlatformAdmin(input, prisma);
    console.log(formatResultMessage(result));
  } catch (error) {
    if (error instanceof PlatformAdminBootstrapError) {
      console.error(`HATA: ${error.message}`);
    } else {
      // Beklenmeyen hatalar (örn. bağlantı hatası) toSafeError'dan geçirilir:
      // yalnızca name/code/kırpılmış mesaj yazdırılır ve olası
      // connection-string içerikleri maskelenir — DATABASE_URL asla yazdırılmaz.
      const safe = toSafeError(error);
      console.error(
        `HATA (beklenmeyen): ${safe.name}${safe.code ? ` [${safe.code}]` : ""}: ${safe.message}`
      );
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

// Vitest bu modülü import ettiğinde main() çalışmaz; yalnızca doğrudan
// `tsx scripts/create-platform-admin.ts` (veya npm script'i) ile çalışır.
if (process.argv[1]?.includes("create-platform-admin")) {
  void main();
}
