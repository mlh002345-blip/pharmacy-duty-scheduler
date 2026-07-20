import { prisma } from "@/lib/prisma";

// Kendi kendine kayıt (self-service) formunun kötüye kullanılmasını
// (aynı ağdan otomatik/toplu sahte oda açılmasını) önlemek için basit,
// pencereli olmayan bir sayaç — bkz. src/app/kayit/actions.ts.
// LoginAttempt'in aksine bir kere aşıldığında kalıcı bir "blok" yazmaz;
// yalnızca son bir saatteki başarılı deneme sayısını sorgular.
const MAX_SIGNUPS_PER_WINDOW = 3;
const WINDOW_MS = 60 * 60 * 1000; // 1 saat

export async function isSelfSignupRateLimited(bucketKey: string): Promise<boolean> {
  const count = await prisma.selfSignupAttempt.count({
    where: { bucketKey, createdAt: { gt: new Date(Date.now() - WINDOW_MS) } },
  });
  return count >= MAX_SIGNUPS_PER_WINDOW;
}

export async function recordSelfSignupAttempt(bucketKey: string): Promise<void> {
  await prisma.selfSignupAttempt.create({ data: { bucketKey } });
}
