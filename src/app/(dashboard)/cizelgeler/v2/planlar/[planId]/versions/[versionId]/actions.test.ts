import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrganizationRole = vi.fn();
const setDayTypeRules = vi.fn();
const setShiftDefinitions = vi.fn();
const setSlotRequirements = vi.fn();

vi.mock("@/lib/auth/tenant", () => ({
  requireOrganizationRole: (...args: unknown[]) => requireOrganizationRole(...args),
  requireOrganizationMember: vi.fn(),
  requireOrganizationRoleOrRedirect: vi.fn(),
}));
vi.mock("@/lib/duty-rules-v2/configuration/update-day-type-rules", () => ({
  setDayTypeRules: (...args: unknown[]) => setDayTypeRules(...args),
}));
vi.mock("@/lib/duty-rules-v2/configuration/update-shift-definitions", () => ({
  setShiftDefinitions: (...args: unknown[]) => setShiftDefinitions(...args),
}));
vi.mock("@/lib/duty-rules-v2/configuration/update-slot-requirements", () => ({
  setSlotRequirements: (...args: unknown[]) => setSlotRequirements(...args),
}));
vi.mock("@/lib/duty-rules-v2/configuration/update-plan-version-policy", () => ({
  setPlanVersionPolicy: vi.fn(),
}));
vi.mock("@/lib/duty-rules-v2/configuration/create-rotation-pool", () => ({
  createRotationPool: vi.fn(),
}));
vi.mock("@/lib/duty-rules-v2/configuration/update-pool-membership", () => ({
  addPoolMembership: vi.fn(),
  addPoolMembershipsByServiceArea: vi.fn(),
  endPoolMembership: vi.fn(),
}));
vi.mock("@/lib/duty-rules-v2/configuration/activate-plan-version", () => ({
  activatePlanVersion: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { updateDayTypeRulesAction, updateShiftDefinitionsAction, updateSlotRequirementsAction } =
  await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
  requireOrganizationRole.mockResolvedValue({
    user: { id: "staff-1", role: "STAFF", organizationId: "org-1" },
  });
});

function makeFormData(field: string, value: string) {
  const fd = new FormData();
  fd.set(field, value);
  return fd;
}

describe("updateDayTypeRulesAction — JSON payload size guard", () => {
  it("rejects an oversized rulesJson string before ever calling JSON.parse/setDayTypeRules", async () => {
    const oversized = `[${"1".repeat(100_001)}]`; // > MAX_CONFIGURATION_JSON_FIELD_LENGTH

    const result = await updateDayTypeRulesAction(
      "plan-1",
      "version-1",
      { success: false, message: "" },
      makeFormData("rulesJson", oversized)
    );

    expect(result.success).toBe(false);
    expect(setDayTypeRules).not.toHaveBeenCalled();
  });

  it("still accepts a well-formed, in-bounds payload", async () => {
    setDayTypeRules.mockResolvedValue({ ok: true, count: 1 });
    const payload = JSON.stringify([{ dayType: "WEEKDAY", isServed: true, weight: 1 }]);

    const result = await updateDayTypeRulesAction(
      "plan-1",
      "version-1",
      { success: false, message: "" },
      makeFormData("rulesJson", payload)
    );

    expect(result.success).toBe(true);
    expect(setDayTypeRules).toHaveBeenCalled();
  });
});

describe("updateShiftDefinitionsAction — JSON payload size guard", () => {
  it("rejects an oversized shiftsJson string before ever calling setShiftDefinitions", async () => {
    const oversized = `[${"1".repeat(100_001)}]`;

    const result = await updateShiftDefinitionsAction(
      "plan-1",
      "version-1",
      { success: false, message: "" },
      makeFormData("shiftsJson", oversized)
    );

    expect(result.success).toBe(false);
    expect(setShiftDefinitions).not.toHaveBeenCalled();
  });

  it("rejects an array longer than the configured max even when the raw string is small", async () => {
    const tooManyShifts = Array.from({ length: 201 }, (_, i) => ({
      name: `S${i}`,
      startMinute: 0,
      endMinute: 1,
      spansMidnight: false,
      defaultWeight: 1,
      sortOrder: i,
    }));

    const result = await updateShiftDefinitionsAction(
      "plan-1",
      "version-1",
      { success: false, message: "" },
      makeFormData("shiftsJson", JSON.stringify(tooManyShifts))
    );

    expect(result.success).toBe(false);
    expect(setShiftDefinitions).not.toHaveBeenCalled();
  });
});

describe("updateSlotRequirementsAction — JSON payload size guard", () => {
  it("rejects an oversized slotsJson string before ever calling setSlotRequirements", async () => {
    const oversized = `[${"1".repeat(100_001)}]`;

    const result = await updateSlotRequirementsAction(
      "plan-1",
      "version-1",
      { success: false, message: "" },
      makeFormData("slotsJson", oversized)
    );

    expect(result.success).toBe(false);
    expect(setSlotRequirements).not.toHaveBeenCalled();
  });
});
