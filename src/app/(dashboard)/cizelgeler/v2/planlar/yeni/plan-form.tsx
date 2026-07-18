"use client";

import { useActionState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FieldError } from "@/components/ui/field-error";
import { initialActionState, fieldError } from "@/lib/action-state";
import { createDutyPlanAction } from "./actions";

export function PlanForm({ regions }: { regions: { id: string; name: string }[] }) {
  const [state, formAction, isPending] = useActionState(createDutyPlanAction, initialActionState);

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="regionId">Bölge</Label>
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

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Plan Adı</Label>
        <Input id="name" name="name" required placeholder="Örn. Pelitli Nöbet Planı" />
        <FieldError message={fieldError(state, "name")} />
      </div>

      {!state.success && state.message && (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Oluşturuluyor..." : "Plan Oluştur"}
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/cizelgeler/v2/planlar">İptal</Link>
        </Button>
      </div>
    </form>
  );
}
