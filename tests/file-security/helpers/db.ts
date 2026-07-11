import { PrismaClient } from "@prisma/client";

import { resolveFileTestDatabaseUrl } from "../../integration/helpers/test-db-guard";

export const fileTestDatabaseUrl = resolveFileTestDatabaseUrl();

export const fileTestPrisma = new PrismaClient({ datasourceUrl: fileTestDatabaseUrl });
