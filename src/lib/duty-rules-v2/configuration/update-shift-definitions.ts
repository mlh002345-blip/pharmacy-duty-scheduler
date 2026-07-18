// Duty Rules V2 — Phase 11: declarative replace of a plan version's
// ShiftDefinition rows, matched by id: an id present in the input =
// update in place; an id present in the DB but absent from the input =
// delete (cascades to its SlotRequirements — an intentional, real
// removal); no id = create. Rejects duplicate names within the SAME call
// before writing anything (mirrors @@unique([planVersionId, name])).

import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { requireDraftPlanVersion, type PlanVersionGuardFailure } from "./plan-version-guard";

export type ShiftDefinitionInput = {
  id?: string;
  name: string;
  startMinute: number;
  endMinute: number;
  spansMidnight: boolean;
  defaultWeight: number;
  sortOrder: number;
};

export type SetShiftDefinitionsInput = {
  organizationId: string;
  versionId: string;
  shifts: ShiftDefinitionInput[];
  userId: string;
};

export type SetShiftDefinitionsSuccess = { ok: true; count: number };

export type SetShiftDefinitionsErrorCode =
  | PlanVersionGuardFailure["code"]
  | "INVALID_INPUT"
  | "DUPLICATE_NAME"
  | "UNKNOWN_SHIFT_ID";

export type SetShiftDefinitionsFailure = {
  ok: false;
  code: SetShiftDefinitionsErrorCode;
  message: string;
};

export type SetShiftDefinitionsResult = SetShiftDefinitionsSuccess | SetShiftDefinitionsFailure;

function fail(code: SetShiftDefinitionsErrorCode, message: string): SetShiftDefinitionsFailure {
  return { ok: false, code, message };
}

export async function setShiftDefinitions(
  input: SetShiftDefinitionsInput
): Promise<SetShiftDefinitionsResult> {
  const { organizationId, versionId, userId } = input;

  for (const shift of input.shifts) {
    const name = shift.name.trim();
    if (
      name.length === 0 ||
      !Number.isInteger(shift.startMinute) ||
      !Number.isInteger(shift.endMinute) ||
      shift.startMinute < 0 ||
      shift.startMinute > 1439 ||
      shift.endMinute < 0 ||
      shift.endMinute > 1439 ||
      shift.defaultWeight <= 0
    ) {
      return fail("INVALID_INPUT", "Vardiya bilgileri geçersiz.");
    }
  }
  const names = input.shifts.map((s) => s.name.trim());
  if (new Set(names).size !== names.length) {
    return fail("DUPLICATE_NAME", "Aynı isimde birden fazla vardiya tanımlanamaz.");
  }

  const guard = await requireDraftPlanVersion(organizationId, versionId);
  if (!guard.ok) return fail(guard.code, guard.message);

  const existingShifts = await prisma.shiftDefinition.findMany({
    where: { planVersionId: versionId },
    select: { id: true },
  });
  const existingIds = new Set(existingShifts.map((s) => s.id));
  const inputIds = input.shifts.filter((s) => s.id).map((s) => s.id as string);
  for (const id of inputIds) {
    if (!existingIds.has(id)) {
      return fail("UNKNOWN_SHIFT_ID", "Bilinmeyen vardiya kimliği.");
    }
  }
  const toDeleteIds = [...existingIds].filter((id) => !inputIds.includes(id));

  const count = await prisma.$transaction(async (tx) => {
    if (toDeleteIds.length > 0) {
      await tx.shiftDefinition.deleteMany({ where: { id: { in: toDeleteIds } } });
    }
    for (const shift of input.shifts) {
      const data = {
        name: shift.name.trim(),
        startMinute: shift.startMinute,
        endMinute: shift.endMinute,
        spansMidnight: shift.spansMidnight,
        defaultWeight: shift.defaultWeight,
        sortOrder: shift.sortOrder,
      };
      if (shift.id) {
        await tx.shiftDefinition.update({ where: { id: shift.id }, data });
      } else {
        await tx.shiftDefinition.create({ data: { ...data, planVersionId: versionId } });
      }
    }
    await writeAuditLog(tx, {
      organizationId,
      userId,
      action: "UPDATE",
      entity: "DutyPlanVersion",
      entityId: versionId,
      after: { shiftDefinitions: input.shifts, deletedCount: toDeleteIds.length },
    });
    return input.shifts.length;
  });

  return { ok: true, count };
}
