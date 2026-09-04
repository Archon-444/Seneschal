"use client";

import Link from "next/link";
import { Dropdown } from "../menu";
import { ChevronDownIcon, GearIcon, SignOutIcon, UserIcon } from "../icons";

function initials(name: string, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

const ROLE_LABEL: Record<string, string> = {
  WORKSPACE_ADMIN: "Admin",
  MANAGER: "Manager",
  FIDUCIARY: "Fiduciary",
  CLIENT_VIEWER: "Client viewer",
  AGENT: "Agent",
  MANAGING_AGENT: "Managing agent",
  LICENSED_PARTNER: "Partner",
  VENDOR: "Vendor",
  AUDITOR: "Auditor",
};

export function UserMenu({
  name,
  email,
  role,
  workspaceName,
  signOut,
}: {
  name: string;
  email: string;
  role: string;
  workspaceName: string;
  signOut: () => Promise<void>;
}) {
  const itemClass =
    "flex items-center gap-2 px-3 py-1.5 text-[13px] text-navy-700 hover:bg-ivory-100 focus:bg-ivory-100 focus:outline-none";
  return (
    <Dropdown
      label="Account menu"
      align="right"
      buttonClassName="flex h-8 items-center gap-2 rounded px-1.5 text-left hover:bg-ivory-100"
      panelClassName="w-60 overflow-hidden rounded border border-line bg-white py-1 shadow-md"
      button={
        <>
          <span className="figure grid h-6 w-6 place-items-center rounded-full bg-navy-900 text-[10px] font-semibold text-white">
            {initials(name, email)}
          </span>
          <span className="hidden min-w-0 sm:block">
            <span className="block max-w-48 truncate text-[12.5px] text-navy-900">{name || email}</span>
          </span>
          <ChevronDownIcon className="hidden text-muted sm:block" />
        </>
      }
    >
      {(close) => (
        <>
          <div className="border-b border-line px-3 py-2">
            <div className="truncate text-[13px] font-medium text-navy-900">{name || email}</div>
            <div className="truncate text-xs text-muted">{email}</div>
            <div className="mt-1 truncate text-xs text-muted">
              {workspaceName ? `${workspaceName} · ` : ""}{ROLE_LABEL[role] ?? role}
            </div>
          </div>
          <Link href="/settings#profile" role="menuitem" onClick={close} className={itemClass}>
            <UserIcon /> Profile
          </Link>
          <Link href="/settings" role="menuitem" onClick={close} className={itemClass}>
            <GearIcon /> Settings
          </Link>
          <form action={signOut} className="border-t border-line">
            <button type="submit" role="menuitem" className={`${itemClass} w-full text-claret-500`}>
              <SignOutIcon /> Sign out
            </button>
          </form>
        </>
      )}
    </Dropdown>
  );
}
