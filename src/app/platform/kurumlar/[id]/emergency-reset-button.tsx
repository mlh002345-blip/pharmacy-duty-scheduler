"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { initialActionState } from "@/lib/action-state";
import { issueEmergencyPasswordResetAction } from "../actions";

export function EmergencyResetButton({
  organizationId,
  userId,
}: {
  organizationId: string;
  userId: string;
}) {
  const action = issueEmergencyPasswordResetAction.bind(null, organizationId, userId);
  const [state, formAction, isPending] = useActionState(action, initialActionState);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1.5">
      <Button type="submit" variant="outline" size="sm" disabled={isPending}>
        <KeyRound className="size-3.5" />
        {isPending ? "Oluşturuluyor..." : "Şifre Sıfırlama Bağlantısı Oluştur"}
      </Button>
      {state.message && (
        <p
          className={`max-w-md text-right text-xs break-all ${
            state.success ? "text-emerald-700" : "text-destructive"
          }`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
