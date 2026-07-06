import { SubmitButton } from "@/components/layout/submit-button";

export function StatusToggleButton({
  action,
  isActive,
}: {
  action: () => void;
  isActive: boolean;
}) {
  return (
    <form action={action}>
      <SubmitButton variant="outline" size="sm" pendingText="İşlem yapılıyor...">
        {isActive ? "Pasif Yap" : "Aktif Yap"}
      </SubmitButton>
    </form>
  );
}
