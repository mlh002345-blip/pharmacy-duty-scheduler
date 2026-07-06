"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { DutyRule } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/ui/field-error";
import { type ActionState, initialActionState, fieldError } from "@/lib/action-state";

type DutyRuleAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function DutyRuleForm({
  action,
  rule,
}: {
  action: DutyRuleAction;
  rule?: DutyRule | null;
}) {
  const [state, formAction, isPending] = useActionState(action, initialActionState);

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="minDaysBetweenDuties">Asgari Nöbet Aralığı (gün)</Label>
        <Input
          id="minDaysBetweenDuties"
          name="minDaysBetweenDuties"
          type="number"
          min={0}
          step={1}
          defaultValue={rule?.minDaysBetweenDuties ?? 7}
          required
        />
        <FieldError message={fieldError(state, "minDaysBetweenDuties")} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="weekdayWeight">Hafta İçi Ağırlığı</Label>
          <Input
            id="weekdayWeight"
            name="weekdayWeight"
            type="number"
            min={0}
            step="0.01"
            defaultValue={rule?.weekdayWeight ?? 1}
            required
          />
          <FieldError message={fieldError(state, "weekdayWeight")} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="saturdayWeight">Cumartesi Ağırlığı</Label>
          <Input
            id="saturdayWeight"
            name="saturdayWeight"
            type="number"
            min={0}
            step="0.01"
            defaultValue={rule?.saturdayWeight ?? 1.25}
            required
          />
          <FieldError message={fieldError(state, "saturdayWeight")} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sundayWeight">Pazar Ağırlığı</Label>
          <Input
            id="sundayWeight"
            name="sundayWeight"
            type="number"
            min={0}
            step="0.01"
            defaultValue={rule?.sundayWeight ?? 1.5}
            required
          />
          <FieldError message={fieldError(state, "sundayWeight")} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="officialHolidayWeight">Resmi Tatil Ağırlığı</Label>
          <Input
            id="officialHolidayWeight"
            name="officialHolidayWeight"
            type="number"
            min={0}
            step="0.01"
            defaultValue={rule?.officialHolidayWeight ?? 2}
            required
          />
          <FieldError message={fieldError(state, "officialHolidayWeight")} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="religiousHolidayWeight">Dini Bayram Ağırlığı</Label>
          <Input
            id="religiousHolidayWeight"
            name="religiousHolidayWeight"
            type="number"
            min={0}
            step="0.01"
            defaultValue={rule?.religiousHolidayWeight ?? 2}
            required
          />
          <FieldError message={fieldError(state, "religiousHolidayWeight")} />
        </div>
      </div>

      {!state.success && state.message && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          Kaydet
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/kurallar">İptal</Link>
        </Button>
      </div>
    </form>
  );
}
