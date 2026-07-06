"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@prisma/client";

import { cn } from "@/lib/utils";
import { navItems } from "@/lib/nav-items";
import { logoutAction } from "@/lib/auth/actions";
import { hasPermission } from "@/lib/auth/permissions";

export function Sidebar({
  userName,
  roleLabel,
  role,
}: {
  userName: string;
  roleLabel: string;
  role: UserRole;
}) {
  const pathname = usePathname();
  const visibleNavItems = navItems.filter(
    (item) => !item.permission || hasPermission(role, item.permission)
  );

  return (
    <aside className="hidden w-64 shrink-0 border-r bg-sidebar text-sidebar-foreground md:flex md:flex-col">
      <div className="flex h-14 items-center border-b px-4">
        <span className="text-sm font-semibold">Nöbet Yönetim Paneli</span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {visibleNavItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-3">
        <div className="px-1 pb-2">
          <p className="truncate text-sm font-medium">{userName}</p>
          <p className="text-sidebar-foreground/60 text-xs">{roleLabel}</p>
        </div>
        <form action={logoutAction}>
          <button
            type="submit"
            className="text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground w-full rounded-md px-3 py-2 text-left text-sm font-medium transition-colors"
          >
            Çıkış Yap
          </button>
        </form>
      </div>
    </aside>
  );
}
