"use client";

import { useActionState } from "react";
import type { BillingStatus } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/ui/field-error";
import { BILLING_STATUS_LABELS, BILLING_STATUS_OPTIONS } from "@/lib/billing/labels";
import { type ActionState, initialActionState, fieldError } from "@/lib/action-state";

type BillingFormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

export function OrganizationBillingForm({
  action,
  billingStatus,
  billingNotes,
}: {
  action: BillingFormAction;
  billingStatus: BillingStatus;
  billingNotes: string | null;
}) {
  const [state, formAction, isPending] = useActionState(action, initialActionState);

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="billingStatus">Faturalama Durumu</Label>
        <Select id="billingStatus" name="billingStatus" defaultValue={billingStatus} required>
          {BILLING_STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {BILLING_STATUS_LABELS[option]}
            </option>
          ))}
        </Select>
        <FieldError message={fieldError(state, "billingStatus")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="billingNotes">Faturalama Notu</Label>
        <Textarea
          id="billingNotes"
          name="billingNotes"
          defaultValue={billingNotes ?? ""}
          placeholder="Örn. Yıllık sözleşme, sonraki fatura Ocak 2027"
          rows={3}
        />
        <FieldError message={fieldError(state, "billingNotes")} />
      </div>

      {!state.success && state.message && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}

      <div>
        <Button type="submit" disabled={isPending}>
          Kaydet
        </Button>
      </div>
    </form>
  );
}
