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
  disabled,
}: {
  action: () => Promise<void>;
  confirmMessage: string;
  children: React.ReactNode;
  pendingText?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  /** Real HTML disabled (not merely a visual state) — e.g. Duty Rules V2
   *  Phase 11's activation button, which must never be clickable while
   *  blocking readiness issues remain. */
  disabled?: boolean;
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
      <SubmitButton variant={variant} pendingText={pendingText} disabled={disabled}>
        {children}
      </SubmitButton>
    </form>
  );
}
