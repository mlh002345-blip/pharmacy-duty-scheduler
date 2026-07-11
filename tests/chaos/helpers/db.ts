import { PrismaClient } from "@prisma/client";

import { resolveChaosDatabaseUrl } from "../../integration/helpers/test-db-guard";

// Resolved (and guard-checked) once per Vitest worker process. Every
// chaos spec imports `chaosPrisma` from this module for its own
// assertions/fixtures — independent of whatever DATABASE_URL a separate
// `next start` child process (for HTTP-level scenarios) was given, while
// both are guaranteed to point at the exact same guarded chaos database.
export const chaosDatabaseUrl = resolveChaosDatabaseUrl();

export const chaosPrisma = new PrismaClient({ datasourceUrl: chaosDatabaseUrl });
