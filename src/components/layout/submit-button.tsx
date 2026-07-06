"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

// Shows Turkish pending feedback for any <form action={...}> submit button
// (server actions, or client actions via useActionState) without each form
// needing its own pending-state wiring.
export function SubmitButton({
  children,
  pendingText = "İşlem yapılıyor...",
  disabled,
  ...props
}: React.ComponentProps<typeof Button> & { pendingText?: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={disabled || pending} {...props}>
      {pending ? pendingText : children}
    </Button>
  );
}
