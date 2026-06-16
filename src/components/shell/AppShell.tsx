"use client";

import Link from "next/link";
import { useState } from "react";
import { Sidebar } from "./Sidebar";
import type { NavItem } from "./nav";
import { UserMenu } from "./UserMenu";
import { NotificationBell } from "./NotificationBell";
import { CloseIcon, MenuIcon, PanelLeftIcon } from "../icons";

const SIDEBAR_COOKIE = "seneschal_sidebar";

export function AppShell({
  nav,
  isStaff,
  workspaceName,
  user,
  initialCollapsed,
  initialUnread,
  signOut,
  children,
}: {
  nav: NavItem[];
  isStaff: boolean;
  workspaceName: string;
  user: { name: string; email: string; role: string };
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
    <Link href="/dashboard" className="font-display text-2xl text-ivory-50">
      {full ? "Seneschal" : "S"}
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
        <div className={`border-b border-navy-700 py-5 ${collapsed ? "px-3 text-center" : "px-5"}`}>
          {brand(!collapsed)}
          {!collapsed && <div className="mt-1 truncate text-xs text-navy-300">{workspaceName}</div>}
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
