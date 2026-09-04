"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Sidebar } from "./Sidebar";
import { NAV_ICONS } from "./navIcons";
import { type NavItem } from "./nav";
import { UserMenu } from "./UserMenu";
import { NotificationBell } from "./NotificationBell";
import { CommandPalette } from "./CommandPalette";
import type { SearchHit } from "@/server/services/search";
import { Dropdown } from "../menu";
import { CloseIcon, MenuIcon, PanelLeftIcon } from "../icons";
import { Logo } from "../Logo";

const SIDEBAR_COOKIE = "seneschal_sidebar";
const ZONE_LABEL: Record<string, string> = { WORK: "Work", MANAGE: "Manage" };

/** The nav item whose href is the longest prefix of the current path — what the
 *  header names as the current section. */
function currentSection(nav: NavItem[], pathname: string): NavItem | undefined {
  return nav
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

export function AppShell({
  nav,
  isStaff,
  workspaceName,
  user,
  creates = [],
  initialCollapsed,
  initialUnread,
  signOut,
  search,
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
  /** Global-search action; presence mounts the ⌘K palette (operator surface only). */
  search?: (q: string) => Promise<SearchHit[]>;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDialogElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const drawerTitleId = useId();
  const pathname = usePathname();
  const section = currentSection(nav, pathname);

  const closeDrawer = useCallback(() => {
    if (drawerRef.current?.open) drawerRef.current.close();
    else setDrawerOpen(false);
  }, []);

  function openDrawer() {
    const drawer = drawerRef.current;
    if (!drawer || drawer.open) return;
    drawer.showModal();
    setDrawerOpen(true);
  }

  // A native modal dialog makes the rest of the shell inert and owns the focus
  // trap. These effects cover the mobile-shell lifecycle that <dialog> cannot:
  // route changes, crossing the desktop breakpoint, and scroll restoration.
  useEffect(() => {
    closeDrawer();
  }, [pathname, closeDrawer]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeAtDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) closeDrawer();
    };
    desktop.addEventListener("change", closeAtDesktop);
    return () => desktop.removeEventListener("change", closeAtDesktop);
  }, [closeDrawer]);

  useEffect(() => {
    if (!drawerOpen) return;
    const bodyOverflow = document.body.style.overflow;
    const rootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = rootOverflow;
    };
  }, [drawerOpen]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  }

  const brand = (full: boolean, onNavigate?: () => void) => (
    <Link
      href="/dashboard"
      onClick={onNavigate}
      className={`flex min-w-0 items-center text-white ${full ? "gap-2" : "justify-center"}`}
    >
      <Logo className="h-6 w-6 shrink-0" />
      {full && (
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold leading-tight">Seneschal</span>
          {workspaceName && <span className="block truncate text-[11px] leading-tight text-navy-300">{workspaceName}</span>}
        </span>
      )}
    </Link>
  );

  return (
    <div className="flex min-h-screen">
      {/* Keyboard users: first Tab lands here and jumps past the chrome. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-navy-900 focus:shadow-md"
      >
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside
        aria-label="Primary navigation"
        className={`hidden shrink-0 flex-col bg-navy-900 text-navy-100 md:flex ${
          collapsed ? "w-14" : "w-56"
        }`}
      >
        <div
          className={`flex h-12 items-center border-b border-navy-800 ${
            collapsed ? "justify-center px-2" : "px-3.5"
          }`}
        >
          {brand(!collapsed)}
        </div>
        <Sidebar nav={nav} isStaff={isStaff} collapsed={collapsed} />
      </aside>

      {/* Native modal semantics provide focus containment and inert background content. */}
      <dialog
        id="mobile-navigation-drawer"
        ref={drawerRef}
        aria-labelledby={drawerTitleId}
        aria-modal="true"
        onCancel={(event) => {
          event.preventDefault();
          closeDrawer();
        }}
        onClose={() => {
          setDrawerOpen(false);
          const trigger = menuTriggerRef.current;
          if (trigger?.isConnected && window.getComputedStyle(trigger).display !== "none") {
            trigger.focus();
          }
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDrawer();
        }}
        className="mobile-nav-drawer fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-64 max-w-[calc(100vw-3rem)] border-0 bg-transparent p-0 text-navy-100 md:hidden"
      >
        <h2 id={drawerTitleId} className="sr-only">Navigation menu</h2>
        <aside className="flex h-full flex-col bg-navy-900 text-navy-100 shadow-xl">
          <div className="flex min-h-12 items-center justify-between border-b border-navy-800 px-3 py-1.5 pl-3.5">
            {brand(true, closeDrawer)}
            <button
              autoFocus
              type="button"
              aria-label="Close navigation menu"
              onClick={closeDrawer}
              className="grid h-11 w-11 place-items-center rounded text-navy-100 hover:bg-navy-800 hover:text-white"
            >
              <CloseIcon />
            </button>
          </div>
          <Sidebar nav={nav} isStaff={isStaff} collapsed={false} mobile onNavigate={closeDrawer} />
        </aside>
      </dialog>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center gap-2 border-b border-line bg-white px-3 text-navy-900 sm:px-4">
          <button
            ref={menuTriggerRef}
            type="button"
            aria-label="Open navigation menu"
            aria-controls="mobile-navigation-drawer"
            aria-expanded={drawerOpen}
            onClick={openDrawer}
            className="grid h-10 w-10 place-items-center rounded text-navy-700 hover:bg-ivory-100 md:hidden"
          >
            <MenuIcon />
          </button>
          <button
            type="button"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
            onClick={toggleCollapsed}
            className="hidden h-8 w-8 place-items-center rounded text-muted hover:bg-ivory-100 hover:text-navy-900 md:grid"
          >
            <PanelLeftIcon />
          </button>
          {section && (
            <div className="hidden min-w-0 items-center gap-1.5 text-[12.5px] sm:flex" aria-label="Current section">
              {section.zone && (
                <>
                  <span className="text-muted">{ZONE_LABEL[section.zone]}</span>
                  <span className="text-muted">/</span>
                </>
              )}
              <span className="truncate font-medium text-navy-900">{section.label}</span>
            </div>
          )}
          <div className="flex flex-1 justify-center px-2">
            {search && <CommandPalette search={search} />}
          </div>
          {creates.length > 0 && (
            <Dropdown
              label="Create new"
              align="right"
              buttonClassName="flex h-8 items-center gap-1.5 rounded border border-navy-900 bg-navy-900 px-2.5 text-[13px] font-medium text-white hover:bg-navy-800"
              panelClassName="w-56 overflow-hidden rounded border border-line bg-white py-1 shadow-md"
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
                      className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-navy-700 hover:bg-ivory-100"
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
        <main id="main-content" tabIndex={-1} className="flex-1 px-4 py-5 outline-none sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
