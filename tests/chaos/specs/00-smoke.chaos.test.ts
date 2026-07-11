import { afterAll, describe, expect, it } from "vitest";

import { chaosConnectionCount, sanitizedChaosTarget } from "../../../scripts/chaos/fault-control";
import { createChaosRegion, createChaosUser } from "../helpers/fixtures";
import { chaosPrisma } from "../helpers/db";

describe("chaos harness smoke test", () => {
  afterAll(async () => {
    await chaosPrisma.$disconnect();
  });

  it("connects to the guarded chaos database and can read pg_stat_activity", async () => {
    expect(sanitizedChaosTarget()).toContain("chaos");
    await chaosPrisma.$queryRaw`SELECT 1`; // force the singleton to actually open a connection
    const count = await chaosConnectionCount();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("can create and read back real fixtures against the chaos database", async () => {
    const region = await createChaosRegion();
    const user = await createChaosUser();
    const found = await chaosPrisma.region.findUnique({ where: { id: region.id } });
    expect(found?.name).toBe(region.name);
    expect(user.role).toBe("ADMIN");
  });
});
