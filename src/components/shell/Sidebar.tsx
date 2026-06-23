"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAV_ICONS, type IconKey } from "./navIcons";
import { type NavItem } from "./nav";
import { ChevronDownIcon } from "../icons";

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
  const [moreOpen, setMoreOpen] = useState(false);

  const link = (item: { href: string; label: string; icon: IconKey }, accent = false) => {
    const active = isActive(pathname, item.href);
    const Glyph = NAV_ICONS[item.icon];
    const base = "flex items-center rounded px-3 py-1.5 text-sm transition-colors";
    const tone = active
      ? "bg-navy-800 text-ivory-50"
      : accent
        ? "text-gold-300 hover:bg-navy-800"
        : "text-ivory-200 hover:bg-navy-800 hover:text-ivory-50";
    return (
      <Link
        key={item.href}
        href={item.href}
        prefetch={false}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        title={collapsed ? item.label : undefined}
        aria-label={collapsed ? item.label : undefined}
        className={`${base} ${tone} ${collapsed ? "justify-center" : "gap-3"}`}
      >
        <Glyph className="shrink-0" />
        {!collapsed && item.label}
      </Link>
    );
  };

  // Persona rails (TENANT_NAV / LANDLORD_NAV) carry no zone — render them flat, as before.
  const zoned = nav.some((i) => i.zone);
  const consoleBlock = isStaff && (
    // The platform console is a context-switch OUT of the workspace, not a feature: a divider
    // above it and gold accent mark it as leaving the workspace plane.
    <div className="mt-auto border-t border-navy-800 px-3 pt-3 pb-1">
      {!collapsed && <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-navy-300">Platform</div>}
      {link({ href: "/admin", label: "Platform console", icon: "staff" }, true)}
    </div>
  );

  if (!zoned) {
    return (
      <nav className="flex flex-1 flex-col px-3 py-4">
        <div className="space-y-0.5">{nav.map((item) => link(item))}</div>
        {consoleBlock}
      </nav>
    );
  }

  const work = nav.filter((i) => i.zone === "WORK");
  const primary = work.filter((i) => i.tier !== "secondary");
  const secondary = work.filter((i) => i.tier === "secondary");
  const manage = nav.filter((i) => i.zone === "MANAGE");
  const secondaryActive = secondary.some((i) => isActive(pathname, i.href));
  const showSecondary = collapsed || moreOpen || secondaryActive;

  const header = (label: string) =>
    collapsed ? (
      <div className="mx-1 my-2 border-t border-navy-800" />
    ) : (
      <div className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-navy-300">{label}</div>
    );

  return (
    <nav className="flex flex-1 flex-col px-3 py-4">
      <div className="space-y-0.5">
        {primary.length > 0 && header("Work")}
        {primary.map((item) => link(item))}

        {secondary.length > 0 &&
          (collapsed ? (
            // No labels when collapsed — a disclosure makes no sense, so show the glyphs directly.
            secondary.map((item) => link(item))
          ) : (
            <>
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                aria-expanded={showSecondary}
                className="flex w-full items-center gap-3 rounded px-3 py-1.5 text-sm text-ivory-200 transition-colors hover:bg-navy-800 hover:text-ivory-50"
              >
                <ChevronDownIcon className={`shrink-0 transition-transform ${showSecondary ? "" : "-rotate-90"}`} />
                More
              </button>
              {showSecondary && secondary.map((item) => link(item))}
            </>
          ))}

        {manage.length > 0 && header("Manage")}
        {manage.map((item) => link(item))}
      </div>
      {consoleBlock}
    </nav>
  );
}
