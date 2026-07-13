import { describe, expect, it, vi } from "vitest";

import { assertLastActiveAdminNotRemoved, LastActiveAdminError } from "./admin-guard";

function makeTx(activeAdminCount: number) {
  return {
    $executeRaw: vi.fn(async () => 0),
    user: { count: vi.fn().mockResolvedValue(activeAdminCount) },
  };
}

describe("assertLastActiveAdminNotRemoved", () => {
  it("throws LastActiveAdminError when only one active admin remains", async () => {
    const tx = makeTx(1);

    await expect(
      assertLastActiveAdminNotRemoved(tx as never, "org-1")
    ).rejects.toBeInstanceOf(LastActiveAdminError);
  });

  it("throws when there are zero active admins (already inconsistent state)", async () => {
    const tx = makeTx(0);

    await expect(assertLastActiveAdminNotRemoved(tx as never, "org-1")).rejects.toBeInstanceOf(
      LastActiveAdminError
    );
  });

  it("resolves without throwing when more than one active admin remains", async () => {
    const tx = makeTx(2);

    await expect(assertLastActiveAdminNotRemoved(tx as never, "org-1")).resolves.toBeUndefined();
  });

  it("acquires the advisory lock before counting (serializes concurrent callers)", async () => {
    const tx = makeTx(2);
    const callOrder: string[] = [];
    tx.$executeRaw.mockImplementation(async () => {
      callOrder.push("lock");
      return 0;
    });
    tx.user.count.mockImplementation(async () => {
      callOrder.push("count");
      return 2;
    });

    await assertLastActiveAdminNotRemoved(tx as never, "org-1");

    expect(callOrder).toEqual(["lock", "count"]);
  });
});
