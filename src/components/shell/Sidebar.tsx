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
  mobile = false,
  onNavigate,
}: {
  nav: NavItem[];
  isStaff: boolean;
  collapsed: boolean;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const link = (item: { href: string; label: string; icon: IconKey }, accent = false) => {
    const active = isActive(pathname, item.href);
    const Glyph = NAV_ICONS[item.icon];
    const base = `flex items-center rounded px-2.5 text-[13px] transition-colors ${mobile ? "min-h-11 py-2" : "h-[30px]"}`;
    const tone = active
      ? "bg-navy-800 font-medium text-white"
      : accent
        ? "text-gold-300 hover:bg-navy-800"
        : "text-navy-100 hover:bg-navy-800 hover:text-white";
    return (
      <Link
        key={item.href}
        href={item.href}
        prefetch={false}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        title={collapsed ? item.label : undefined}
        aria-label={collapsed ? item.label : undefined}
        className={`${base} ${tone} ${collapsed ? "justify-center" : "gap-2.5"}`}
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
    <div className="mt-auto border-t border-navy-800 px-2 pt-2 pb-1">
      {!collapsed && <div className="px-2.5 pb-1 pt-1 text-[11px] font-medium text-navy-300">Platform</div>}
      {link({ href: "/admin", label: "Platform console", icon: "staff" }, true)}
    </div>
  );

  if (!zoned) {
    return (
      <nav className="flex flex-1 flex-col px-2 py-3">
        <div className="space-y-px">{nav.map((item) => link(item))}</div>
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
      <div className="px-2.5 pt-3.5 pb-1 text-[11px] font-medium text-navy-300">{label}</div>
    );

  return (
    <nav className="flex flex-1 flex-col px-2 py-2">
      <div className="space-y-px">
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
                className={`flex w-full items-center gap-2.5 rounded px-2.5 text-[13px] text-navy-100 transition-colors hover:bg-navy-800 hover:text-white ${
                  mobile ? "min-h-11 py-2" : "h-[30px]"
                }`}
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
