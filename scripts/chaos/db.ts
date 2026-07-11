import { PrismaClient } from "@prisma/client";

import { resolveChaosDatabaseUrl } from "../../tests/integration/helpers/test-db-guard";

export const chaosDatabaseUrl = resolveChaosDatabaseUrl();

export const chaosPrisma = new PrismaClient({ datasourceUrl: chaosDatabaseUrl });
