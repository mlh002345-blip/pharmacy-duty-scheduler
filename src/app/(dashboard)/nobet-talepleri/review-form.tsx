"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/ui/field-error";
import { initialActionState, fieldError, type ActionState } from "@/lib/action-state";

type ReviewAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

const DECISION_CONFIRM: Record<string, string> = {
  APPROVED:
    "Talep onaylanacak ve çizelge oluşturmada dikkate alınacak. Onaylıyor musunuz?",
  REJECTED: "Talep reddedilecek. Onaylıyor musunuz?",
  CANCELLED: "Talep iptal edilecek. Onaylıyor musunuz?",
};

export function DutyRequestReviewForm({ action }: { action: ReviewAction }) {
  const [state, formAction, isPending] = useActionState(action, initialActionState);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        const submitter = (e.nativeEvent as SubmitEvent).submitter as
          | HTMLButtonElement
          | null;
        const decision = submitter?.value ?? "";
        if (DECISION_CONFIRM[decision] && !confirm(DECISION_CONFIRM[decision])) {
          e.preventDefault();
        }
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reviewNote">
          İnceleme Notu{" "}
          <span className="text-muted-foreground font-normal">
            (reddetme için zorunlu)
          </span>
        </Label>
        <Textarea
          id="reviewNote"
          name="reviewNote"
          placeholder="Örn: Aynı hafta için üç talep var; bölgede yeterli eczane kalmıyor."
        />
        <FieldError message={fieldError(state, "reviewNote")} />
      </div>

      {!state.success && state.message && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="APPROVED" disabled={isPending}>
          {isPending ? "İşlem yapılıyor..." : "Onayla"}
        </Button>
        <Button
          type="submit"
          name="decision"
          value="REJECTED"
          variant="destructive"
          disabled={isPending}
        >
          Reddet
        </Button>
        <Button
          type="submit"
          name="decision"
          value="CANCELLED"
          variant="outline"
          disabled={isPending}
        >
          İptal Et
        </Button>
      </div>
    </form>
  );
}
