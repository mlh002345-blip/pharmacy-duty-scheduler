import { prisma } from "@/lib/prisma";

// No authentication system exists yet. Until one is added, audit logs are
// attributed to the first registered user as a temporary placeholder.
export async function getCurrentUserId(): Promise<string> {
  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) {
    throw new Error("Sistemde tanımlı kullanıcı bulunamadı.");
  }
  return user.id;
}
