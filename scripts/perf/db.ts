import { PrismaClient } from "@prisma/client";

import { resolvePerfDatabaseUrl } from "../../tests/integration/helpers/test-db-guard";

export const perfDatabaseUrl = resolvePerfDatabaseUrl();

export const perfPrisma = new PrismaClient({ datasourceUrl: perfDatabaseUrl });
