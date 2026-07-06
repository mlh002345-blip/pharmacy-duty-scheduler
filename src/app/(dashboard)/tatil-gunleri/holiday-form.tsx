"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { Holiday } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FieldError } from "@/components/ui/field-error";
import { HOLIDAY_TYPE_LABELS } from "@/lib/validations/holiday";
import { type ActionState, initialActionState, fieldError } from "@/lib/action-state";

type HolidayAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function HolidayForm({
  action,
  holiday,
}: {
  action: HolidayAction;
  holiday?: Holiday;
}) {
  const [state, formAction, isPending] = useActionState(action, initialActionState);
  const defaultDate = holiday ? holiday.date.toISOString().slice(0, 10) : "";

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="date">Tarih</Label>
        <Input id="date" name="date" type="date" defaultValue={defaultDate} required />
        <FieldError message={fieldError(state, "date")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Tatil Adı</Label>
        <Input id="name" name="name" defaultValue={holiday?.name} required />
        <FieldError message={fieldError(state, "name")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="type">Tür</Label>
        <Select id="type" name="type" defaultValue={holiday?.type ?? ""} required>
          <option value="">Seçiniz</option>
          {Object.entries(HOLIDAY_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <FieldError message={fieldError(state, "type")} />
      </div>

      {!state.success && state.message && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          Kaydet
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/tatil-gunleri">İptal</Link>
        </Button>
      </div>
    </form>
  );
}
