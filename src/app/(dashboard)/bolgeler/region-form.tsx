"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { Region } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/ui/field-error";
import { type ActionState, initialActionState, fieldError } from "@/lib/action-state";

type RegionAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function RegionForm({
  action,
  region,
}: {
  action: RegionAction;
  region?: Region;
}) {
  const [state, formAction, isPending] = useActionState(action, initialActionState);

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Bölge Adı</Label>
        <Input id="name" name="name" defaultValue={region?.name} required />
        <FieldError message={fieldError(state, "name")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="district">İlçe</Label>
        <Input id="district" name="district" defaultValue={region?.district} required />
        <FieldError message={fieldError(state, "district")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dailyDutyCount">Günlük Nöbetçi Sayısı</Label>
        <Input
          id="dailyDutyCount"
          name="dailyDutyCount"
          type="number"
          min={1}
          defaultValue={region?.dailyDutyCount ?? 1}
          required
        />
        <FieldError message={fieldError(state, "dailyDutyCount")} />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="isActive"
          name="isActive"
          type="checkbox"
          defaultChecked={region?.isActive ?? true}
          className="size-4"
        />
        <Label htmlFor="isActive">Aktif</Label>
      </div>

      {!state.success && state.message && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          Kaydet
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/bolgeler">İptal</Link>
        </Button>
      </div>
    </form>
  );
}
