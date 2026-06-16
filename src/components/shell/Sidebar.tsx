"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
}

function monogram(label: string): string {
  return label
    .split(/\s+/)
    .filter((w) => /[a-z]/i.test(w[0] ?? ""))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

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

  const link = (href: string, label: string, accent = false) => {
    const active = isActive(pathname, href);
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
        className={`${base} ${tone} ${collapsed ? "justify-center" : "gap-3"}`}
      >
        {collapsed ? (
          <span className="figure w-6 text-center text-[11px] tracking-tight">{monogram(label)}</span>
        ) : (
          label
        )}
      </Link>
    );
  };

  return (
    <nav className="flex-1 space-y-0.5 px-3 py-4">
      {nav.map((item) => link(item.href, item.label))}
      {isStaff && <div className="mt-4">{link("/admin", "Staff console", true)}</div>}
    </nav>
  );
}
