"use client";

import { SubmitButton } from "@/components/layout/submit-button";

export function StatusToggleButton({
  action,
  isActive,
  confirmMessage,
}: {
  action: () => void;
  isActive: boolean;
  // Verildiğinde (ör. pasife alma gibi kritik geçişlerde) onay sorar.
  confirmMessage?: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (isActive && confirmMessage && !confirm(confirmMessage)) {
          e.preventDefault();
        }
      }}
    >
      <SubmitButton variant="outline" size="sm" pendingText="İşlem yapılıyor...">
        {isActive ? "Pasif Yap" : "Aktif Yap"}
      </SubmitButton>
    </form>
  );
}
