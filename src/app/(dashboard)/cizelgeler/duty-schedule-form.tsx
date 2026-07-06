"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FieldError } from "@/components/ui/field-error";
import { TURKISH_MONTH_NAMES } from "@/lib/scheduling/date-tr";
import { initialActionState, fieldError } from "@/lib/action-state";
import { createDutyScheduleAction } from "./actions";

const YEAR_OPTIONS = Array.from({ length: 11 }, (_, i) => 2025 + i);

export function DutyScheduleForm({
  regions,
}: {
  regions: { id: string; name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(
    createDutyScheduleAction,
    initialActionState
  );

  const now = new Date();

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="regionId">Nöbet Bölgesi</Label>
        <Select id="regionId" name="regionId" defaultValue="" required>
          <option value="">Seçiniz</option>
          {regions.map((region) => (
            <option key={region.id} value={region.id}>
              {region.name}
            </option>
          ))}
        </Select>
        <FieldError message={fieldError(state, "regionId")} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="month">Ay</Label>
          <Select id="month" name="month" defaultValue={String(now.getUTCMonth() + 1)} required>
            {TURKISH_MONTH_NAMES.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </Select>
          <FieldError message={fieldError(state, "month")} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="year">Yıl</Label>
          <Select id="year" name="year" defaultValue={String(now.getUTCFullYear())} required>
            {YEAR_OPTIONS.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </Select>
          <FieldError message={fieldError(state, "year")} />
        </div>
      </div>

      {!state.success && state.message && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Çizelge oluşturuluyor..." : "Nöbet Çizelgesi Oluştur"}
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/cizelgeler">İptal</Link>
        </Button>
      </div>
    </form>
  );
}
