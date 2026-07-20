"use client";

import { useActionState } from "react";
import { Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { initialActionState } from "@/lib/action-state";
import { sendDutyRemindersAction } from "./reminder-actions";

export function SendRemindersButton() {
  const [state, formAction, isPending] = useActionState(
    sendDutyRemindersAction,
    initialActionState
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Button type="submit" variant="outline" size="sm" disabled={isPending} className="w-fit">
        <Mail className="size-3.5" />
        {isPending ? "Gönderiliyor..." : "Yarının Nöbet Hatırlatmalarını Gönder"}
      </Button>
      {state.message && (
        <p className={state.success ? "text-muted-foreground text-xs" : "text-destructive text-xs"}>
          {state.message}
        </p>
      )}
    </form>
  );
}
