import { PrismaClient } from "@prisma/client";

import { env } from "@/lib/env";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Importing "@/lib/env" above runs startup env validation before this
// client is constructed — a missing/malformed DATABASE_URL throws here,
// at module load, instead of failing lazily on the first query.
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient(env.databaseUrl ? { datasourceUrl: env.databaseUrl } : undefined);

if (env.nodeEnv !== "production") {
  globalForPrisma.prisma = prisma;
}
