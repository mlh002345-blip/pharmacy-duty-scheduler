import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
      <div className="relative">
        <div className="bg-primary/10 absolute inset-0 translate-x-1 translate-y-1 rounded-2xl" />
        <div className="bg-card text-primary relative flex size-14 items-center justify-center rounded-2xl border shadow-sm">
          <Icon className="size-6" />
        </div>
      </div>
      <div>
        <p className="font-medium">{title}</p>
        {description && (
          <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-sm">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
