import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { requirePlatformAdmin } from "@/lib/auth/platform";
import { logoutAction } from "@/lib/auth/actions";

// Deliberately its own layout, not (dashboard)/layout.tsx — this area is
// guarded by requirePlatformAdmin(), never by tenant.ts's
// organization-scoped guards, and must never render the org Sidebar
// (which is driven by organization Permission checks that a
// PLATFORM_ADMIN — organizationId: null — always fails). See
// docs/architecture/MULTI_TENANCY.md.
export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const platformAdmin = await requirePlatformAdmin();

  return (
    <div className="min-h-screen">
      <header className="bg-sidebar text-sidebar-foreground flex h-14 items-center justify-between px-6">
        <Link href="/platform/kurumlar" className="flex items-center gap-2.5">
          <div className="bg-sidebar-primary flex size-7 items-center justify-center rounded-lg">
            <ShieldAlert className="size-3.5 text-white" strokeWidth={2.5} />
          </div>
          <span className="text-sm font-semibold">Platform Yönetimi</span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-sidebar-foreground/70">{platformAdmin.name}</span>
          <form action={logoutAction}>
            <button type="submit" className="hover:text-white">
              Çıkış Yap
            </button>
          </form>
        </div>
      </header>
      <main className="p-6 lg:p-8">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
