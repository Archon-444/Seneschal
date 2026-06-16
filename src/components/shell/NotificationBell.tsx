"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Dropdown } from "../menu";
import { BellIcon, CheckAllIcon } from "../icons";

interface FeedItem {
  id: string;
  subject: string | null;
  category: string | null;
  urgent: boolean;
  readAt: string | null;
  createdAt: string;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Asia/Dubai",
    day: "2-digit",
    month: "short",
  });
}

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<FeedItem[] | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/notifications?limit=8", { cache: "no-store" });
    if (res.ok) setItems(((await res.json()).items as FeedItem[]) ?? []);
  }, []);

  async function markRead(id: string) {
    setItems((prev) => prev?.map((i) => (i.id === id ? { ...i, readAt: new Date().toISOString() } : i)) ?? null);
    setUnread((n) => Math.max(0, n - 1));
    await fetch(`/api/v1/notifications/${id}/read`, { method: "POST" });
  }

  async function markAll() {
    setItems((prev) => prev?.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })) ?? null);
    setUnread(0);
    await fetch("/api/v1/notifications/read-all", { method: "POST" });
  }

  return (
    <Dropdown
      label={`Notifications${unread ? `, ${unread} unread` : ""}`}
      align="right"
      buttonClassName="relative grid h-9 w-9 place-items-center rounded-md text-ivory-200 hover:bg-navy-800 hover:text-ivory-50"
      panelClassName="w-80 overflow-hidden rounded-lg border border-line bg-white shadow-lg"
      button={
        <>
          <BellIcon />
          {unread > 0 && (
            <span className="figure absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-gold-500 px-1 text-[10px] font-semibold text-navy-900">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </>
      }
    >
      <BellPanel items={items} onOpen={load} onMarkRead={markRead} onMarkAll={markAll} unread={unread} />
    </Dropdown>
  );
}

function BellPanel({
  items,
  unread,
  onOpen,
  onMarkRead,
  onMarkAll,
}: {
  items: FeedItem[] | null;
  unread: number;
  onOpen: () => void;
  onMarkRead: (id: string) => void;
  onMarkAll: () => void;
}) {
  useEffect(() => {
    onOpen();
  }, [onOpen]);

  return (
    <div>
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-gold-700">Notifications</span>
        {unread > 0 && (
          <button
            type="button"
            onClick={onMarkAll}
            className="flex items-center gap-1 text-xs text-navy-500 hover:text-navy-900"
          >
            <CheckAllIcon width={14} height={14} /> Mark all read
          </button>
        )}
      </div>
      <div className="max-h-80 overflow-y-auto">
        {items === null ? (
          <p className="px-3 py-6 text-center text-sm text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted">You&apos;re all caught up.</p>
        ) : (
          items.map((it) => (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              onClick={() => onMarkRead(it.id)}
              className={`flex w-full items-start gap-2 border-b border-line/60 px-3 py-2 text-left hover:bg-ivory-100 ${
                it.readAt ? "opacity-60" : ""
              }`}
            >
              <span
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                  it.readAt ? "bg-transparent" : it.urgent ? "bg-claret-500" : "bg-gold-500"
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-navy-900">{it.subject ?? "Notification"}</span>
                <span className="figure block text-[11px] text-muted">{shortDate(it.createdAt)}</span>
              </span>
            </button>
          ))
        )}
      </div>
      <Link
        href="/notifications"
        className="block border-t border-line px-3 py-2 text-center text-sm text-navy-500 hover:bg-ivory-100 hover:text-navy-900"
      >
        See all
      </Link>
    </div>
  );
}
