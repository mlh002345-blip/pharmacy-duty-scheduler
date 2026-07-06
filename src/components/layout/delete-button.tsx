"use client";

import { SubmitButton } from "@/components/layout/submit-button";

export function DeleteButton({
  action,
  confirmMessage,
}: {
  action: () => void;
  confirmMessage: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(confirmMessage)) {
          e.preventDefault();
        }
      }}
    >
      <SubmitButton variant="destructive" size="sm" pendingText="Siliniyor...">
        Sil
      </SubmitButton>
    </form>
  );
}
