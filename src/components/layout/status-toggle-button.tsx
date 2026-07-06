import { Button } from "@/components/ui/button";

export function StatusToggleButton({
  action,
  isActive,
}: {
  action: () => void;
  isActive: boolean;
}) {
  return (
    <form action={action}>
      <Button type="submit" variant="outline" size="sm">
        {isActive ? "Pasif Yap" : "Aktif Yap"}
      </Button>
    </form>
  );
}
