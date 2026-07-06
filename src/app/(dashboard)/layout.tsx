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
      <Sidebar userName={user.name} roleLabel={ROLE_LABELS[user.role]} role={user.role} />
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex h-14 items-center border-b px-4 md:hidden">
          <span className="text-sm font-semibold">Nöbet Yönetim Paneli</span>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
