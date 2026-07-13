import { Cross } from "lucide-react";

import { Sidebar } from "@/components/layout/sidebar";
import { requireUser } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/permissions";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen">
      <Sidebar
        userName={user.name}
        roleLabel={ROLE_LABELS[user.role]}
        role={user.role}
        organizationSlug={user.organization?.slug}
      />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="bg-sidebar text-sidebar-foreground flex h-14 items-center gap-2.5 px-4 md:hidden">
          <div className="bg-sidebar-primary flex size-7 items-center justify-center rounded-lg">
            <Cross className="size-3.5 text-white" strokeWidth={2.5} />
          </div>
          <span className="text-sm font-semibold">Nöbet Yönetimi</span>
        </header>
        <main className="flex-1 p-6 lg:p-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
