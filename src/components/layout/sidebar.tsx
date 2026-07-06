"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Cross, LogOut } from "lucide-react";
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

  const initials = userName
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase("tr");

  return (
    <aside className="bg-sidebar text-sidebar-foreground hidden w-64 shrink-0 md:flex md:flex-col">
      <div className="flex h-16 items-center gap-3 px-5">
        <div className="bg-sidebar-primary flex size-9 shrink-0 items-center justify-center rounded-xl shadow-md shadow-black/20">
          <Cross className="size-4 text-white" strokeWidth={2.5} />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight">Nöbet Yönetimi</p>
          <p className="text-sidebar-foreground/55 text-[11px]">Eczacı Odası Paneli</p>
        </div>
      </div>
      <div className="bg-sidebar-border mx-5 h-px" />
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
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
                "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-white"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-white"
              )}
            >
              {isActive && (
                <span className="bg-sidebar-primary absolute top-1/2 left-0 h-5 w-1 -translate-y-1/2 rounded-r-full" />
              )}
              <Icon
                className={cn(
                  "size-4 shrink-0",
                  isActive ? "text-sidebar-primary" : "text-sidebar-foreground/50"
                )}
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="p-3">
        <div className="bg-sidebar-accent/50 rounded-xl p-3">
          <div className="flex items-center gap-3">
            <div className="bg-sidebar-primary/20 text-sidebar-primary flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{userName}</p>
              <p className="text-sidebar-foreground/55 text-xs">{roleLabel}</p>
            </div>
          </div>
          <form action={logoutAction} className="mt-2.5">
            <button
              type="submit"
              className="text-sidebar-foreground/70 hover:bg-sidebar-accent flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm font-medium transition-colors hover:text-white"
            >
              <LogOut className="size-4" />
              Çıkış Yap
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
