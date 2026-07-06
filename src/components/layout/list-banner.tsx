import { cn } from "@/lib/utils";

export function ListBanner({
  success,
  error,
}: {
  success?: string;
  error?: string;
}) {
  const message = error ?? success;
  if (!message) return null;

  return (
    <div
      className={cn(
        "rounded-md border px-4 py-2 text-sm",
        error
          ? "border-destructive/50 bg-destructive/10 text-destructive"
          : "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      )}
    >
      {message}
    </div>
  );
}
