"use client";

import Link from "next/link";
import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { NAV_ICONS } from "./navIcons";
import { type NavItem } from "./nav";
import { UserMenu } from "./UserMenu";
import { NotificationBell } from "./NotificationBell";
import { Dropdown } from "../menu";
import { CloseIcon, MenuIcon, PanelLeftIcon } from "../icons";
import { Logo } from "../Logo";

const SIDEBAR_COOKIE = "seneschal_sidebar";

export function AppShell({
  nav,
  isStaff,
  workspaceName,
  user,
  creates = [],
  initialCollapsed,
  initialUnread,
  signOut,
  children,
}: {
  nav: NavItem[];
  isStaff: boolean;
  workspaceName: string;
  user: { name: string; email: string; role: string };
  /** "+ New" header actions, cap-filtered for the role. Empty for personas. */
  creates?: NavItem[];
  initialCollapsed: boolean;
  initialUnread: number;
  signOut: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }

  const brand = (full: boolean) => (
    <Link href="/dashboard" className={`flex items-center text-ivory-50 ${full ? "gap-2" : "justify-center"}`}>
      <Logo className="h-8 w-8 shrink-0" />
      {full && <span className="font-display text-2xl">Seneschal</span>}
    </Link>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside
        className={`hidden shrink-0 flex-col border-r border-navy-800 bg-navy-900 text-ivory-100 md:flex ${
          collapsed ? "w-16" : "w-60"
        }`}
      >
        <div
          className={`flex h-14 items-center border-b border-navy-700 ${
            collapsed ? "justify-center px-3" : "px-5"
          }`}
        >
          {brand(!collapsed)}
        </div>
        <Sidebar nav={nav} isStaff={isStaff} collapsed={collapsed} />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-navy-900/40" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <aside className="relative flex h-full w-64 flex-col bg-navy-900 text-ivory-100">
            <div className="flex items-center justify-between border-b border-navy-700 px-5 py-5">
              {brand(true)}
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setDrawerOpen(false)}
                className="text-ivory-200 hover:text-ivory-50"
              >
                <CloseIcon />
              </button>
            </div>
            <Sidebar nav={nav} isStaff={isStaff} collapsed={false} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b border-navy-800 bg-navy-900 px-3 text-ivory-100">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-md hover:bg-navy-800 md:hidden"
          >
            <MenuIcon />
          </button>
          <button
            type="button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
            onClick={toggleCollapsed}
            className="hidden h-9 w-9 place-items-center rounded-md text-ivory-200 hover:bg-navy-800 hover:text-ivory-50 md:grid"
          >
            <PanelLeftIcon />
          </button>
          <div className="flex-1" />
          {creates.length > 0 && (
            <Dropdown
              label="Create new"
              align="right"
              buttonClassName="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-ivory-100 hover:bg-navy-800"
              panelClassName="w-56 overflow-hidden rounded-lg border border-line bg-white py-1 shadow-lg"
              button={
                <>
                  <span className="text-base leading-none" aria-hidden="true">+</span>
                  <span className="hidden sm:inline">New</span>
                </>
              }
            >
              {(close) =>
                creates.map((c) => {
                  const Glyph = NAV_ICONS[c.icon];
                  return (
                    <Link
                      key={c.href}
                      href={c.href}
                      role="menuitem"
                      onClick={close}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-navy-700 hover:bg-ivory-100"
                    >
                      <Glyph className="shrink-0 text-navy-500" /> {c.label}
                    </Link>
                  );
                })
              }
            </Dropdown>
          )}
          <NotificationBell initialUnread={initialUnread} />
          <UserMenu
            name={user.name}
            email={user.email}
            role={user.role}
            workspaceName={workspaceName}
            signOut={signOut}
          />
        </header>
        <main className="flex-1 px-6 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
