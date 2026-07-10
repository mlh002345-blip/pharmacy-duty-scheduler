import { PrismaClient } from "@prisma/client";

import { resolveE2EDatabaseUrl } from "../../integration/helpers/test-db-guard";

// Resolved (and guard-checked) once per Playwright worker process. Every
// spec file imports `e2ePrisma` from this module rather than the app's
// own `@/lib/prisma` singleton — this keeps the E2E test process's
// database connection independent of whatever DATABASE_URL the separate
// `next dev` child process (started by Playwright's webServer, see
// playwright.config.ts) was given, while still guaranteeing both point
// at the exact same guarded E2E_DATABASE_URL.
export const e2eDatabaseUrl = resolveE2EDatabaseUrl();

export const e2ePrisma = new PrismaClient({ datasourceUrl: e2eDatabaseUrl });
