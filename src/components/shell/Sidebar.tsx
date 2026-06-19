"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ICONS, type IconKey, type NavItem } from "./nav";

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  nav,
  isStaff,
  collapsed,
  onNavigate,
}: {
  nav: NavItem[];
  isStaff: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  const link = (href: string, label: string, icon: IconKey, accent = false) => {
    const active = isActive(pathname, href);
    const Glyph = NAV_ICONS[icon];
    const base = "flex items-center rounded px-3 py-1.5 text-sm transition-colors";
    const tone = active
      ? "bg-navy-800 text-ivory-50"
      : accent
        ? "text-gold-300 hover:bg-navy-800"
        : "text-ivory-200 hover:bg-navy-800 hover:text-ivory-50";
    return (
      <Link
        key={href}
        href={href}
        prefetch={false}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        title={collapsed ? label : undefined}
        aria-label={collapsed ? label : undefined}
        className={`${base} ${tone} ${collapsed ? "justify-center" : "gap-3"}`}
      >
        <Glyph className="shrink-0" />
        {!collapsed && label}
      </Link>
    );
  };

  return (
    <nav className="flex-1 space-y-0.5 px-3 py-4">
      {nav.map((item) => link(item.href, item.label, item.icon))}
      {isStaff && <div className="mt-4">{link("/admin", "Platform console", "staff", true)}</div>}
    </nav>
  );
}
