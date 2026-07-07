"use client";

import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/ui/field-error";
import { initialActionState, fieldError, type ActionState } from "@/lib/action-state";

type PublicRequestAction = (
  state: ActionState,
  formData: FormData
) => Promise<ActionState>;

const REQUEST_TYPE_OPTIONS = [
  { value: "CANNOT_DUTY", label: "Nöbet Tutamama" },
  { value: "PREFER_DUTY", label: "Nöbet Tercihi" },
  { value: "SWAP_REQUEST", label: "Nöbet Değişimi" },
  { value: "EMERGENCY_EXCUSE", label: "Acil Mazeret" },
];

export function PublicRequestForm({ action }: { action: PublicRequestAction }) {
  const [state, formAction, isPending] = useActionState(action, initialActionState);

  if (state.success) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-50 px-6 py-10 text-center">
        <CheckCircle2 className="size-10 text-emerald-600" />
        <p className="font-semibold text-emerald-800">{state.message}</p>
        <p className="text-sm text-emerald-700/80">
          Talebiniz incelendikten sonra sonuç, eczacı odası tarafından size iletilecektir.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="requestType">Talep Türü</Label>
        <Select id="requestType" name="requestType" defaultValue="CANNOT_DUTY" required>
          {REQUEST_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <FieldError message={fieldError(state, "requestType")} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="startDate">Başlangıç Tarihi</Label>
          <Input id="startDate" name="startDate" type="date" required />
          <FieldError message={fieldError(state, "startDate")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="endDate">Bitiş Tarihi</Label>
          <Input id="endDate" name="endDate" type="date" required />
          <FieldError message={fieldError(state, "endDate")} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="explanation">Açıklama</Label>
        <Textarea
          id="explanation"
          name="explanation"
          placeholder="Örn: 14 Temmuz'da yıllık izinde olacağım için nöbet tutamayacağım."
          required
        />
        <FieldError message={fieldError(state, "explanation")} />
      </div>

      {!state.success && state.message && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Gönderiliyor..." : "Talebi Gönder"}
      </Button>
    </form>
  );
}
