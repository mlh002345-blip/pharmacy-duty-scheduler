import { describe, expect, it, vi } from "vitest";

import {
  assertLastActiveOrganizationNotDeactivated,
  LastActiveOrganizationError,
} from "./organization-guard";

function makeTx(activeOrganizationCount: number) {
  return {
    $executeRaw: vi.fn(async () => 0),
    organization: { count: vi.fn().mockResolvedValue(activeOrganizationCount) },
  };
}

describe("assertLastActiveOrganizationNotDeactivated", () => {
  it("throws LastActiveOrganizationError when only one active organization remains", async () => {
    const tx = makeTx(1);

    await expect(
      assertLastActiveOrganizationNotDeactivated(tx as never)
    ).rejects.toBeInstanceOf(LastActiveOrganizationError);
  });

  it("throws when there are zero active organizations (already inconsistent state)", async () => {
    const tx = makeTx(0);

    await expect(
      assertLastActiveOrganizationNotDeactivated(tx as never)
    ).rejects.toBeInstanceOf(LastActiveOrganizationError);
  });

  it("resolves without throwing when more than one active organization remains", async () => {
    const tx = makeTx(2);

    await expect(
      assertLastActiveOrganizationNotDeactivated(tx as never)
    ).resolves.toBeUndefined();
  });

  it("acquires the advisory lock before counting (serializes concurrent callers)", async () => {
    const tx = makeTx(2);
    const callOrder: string[] = [];
    tx.$executeRaw.mockImplementation(async () => {
      callOrder.push("lock");
      return 0;
    });
    tx.organization.count.mockImplementation(async () => {
      callOrder.push("count");
      return 2;
    });

    await assertLastActiveOrganizationNotDeactivated(tx as never);

    expect(callOrder).toEqual(["lock", "count"]);
  });
});
