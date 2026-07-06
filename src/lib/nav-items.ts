import {
  LayoutDashboard,
  Building2,
  MapPin,
  ListChecks,
  CalendarDays,
  UserX,
  CalendarRange,
  Scale,
  History,
  Globe,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export const navItems: NavItem[] = [
  { label: "Panel", href: "/", icon: LayoutDashboard },
  { label: "Eczaneler", href: "/eczaneler", icon: Building2 },
  { label: "Nöbet Bölgeleri", href: "/bolgeler", icon: MapPin },
  { label: "Nöbet Kuralları", href: "/kurallar", icon: ListChecks },
  { label: "Tatil Günleri", href: "/tatil-gunleri", icon: CalendarDays },
  { label: "Mazeretler", href: "/mazeretler", icon: UserX },
  { label: "Nöbet Çizelgeleri", href: "/cizelgeler", icon: CalendarRange },
  { label: "Adalet Raporu", href: "/adalet-raporu", icon: Scale },
  { label: "Denetim Kayıtları", href: "/denetim-kayitlari", icon: History },
  { label: "Vatandaş Ekranı", href: "/vatandas", icon: Globe },
];
