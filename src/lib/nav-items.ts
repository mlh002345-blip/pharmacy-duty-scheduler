import {
  LayoutDashboard,
  Building2,
  MapPin,
  ListChecks,
  CalendarDays,
  UserX,
  CalendarRange,
  Scale,
  Archive,
  Inbox,
  History,
  Globe,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { Permission } from "@/lib/auth/permissions";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  permission?: Permission;
};

export const navItems: NavItem[] = [
  { label: "Panel", href: "/", icon: LayoutDashboard },
  { label: "Eczaneler", href: "/eczaneler", icon: Building2 },
  { label: "Nöbet Bölgeleri", href: "/bolgeler", icon: MapPin },
  { label: "Nöbet Kuralları", href: "/kurallar", icon: ListChecks },
  { label: "Tatil Günleri", href: "/tatil-gunleri", icon: CalendarDays },
  { label: "Mazeretler", href: "/mazeretler", icon: UserX },
  { label: "Nöbet Talepleri", href: "/nobet-talepleri", icon: Inbox },
  { label: "Geçmiş Nöbetler", href: "/gecmis-nobetler", icon: Archive },
  { label: "Nöbet Çizelgeleri", href: "/cizelgeler", icon: CalendarRange },
  { label: "Nöbet Dengesi", href: "/nobet-dengesi", icon: Scale },
  { label: "Denetim Kayıtları", href: "/denetim-kayitlari", icon: History },
  { label: "Vatandaş Ekranı", href: "/vatandas", icon: Globe },
  {
    label: "Kullanıcılar",
    href: "/kullanicilar",
    icon: Users,
    permission: "manageUsers",
  },
];
