"use client";

import { SubmitButton } from "@/components/layout/submit-button";
import type { Button } from "@/components/ui/button";

// Kritik işlemler (yayınlama, yayından kaldırma vb.) için onay soran form.
export function ConfirmSubmitForm({
  action,
  confirmMessage,
  children,
  pendingText,
  variant,
}: {
  action: () => Promise<void>;
  confirmMessage: string;
  children: React.ReactNode;
  pendingText?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
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
      <SubmitButton variant={variant} pendingText={pendingText}>
        {children}
      </SubmitButton>
    </form>
  );
}
