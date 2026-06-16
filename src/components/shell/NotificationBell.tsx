"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dropdown } from "../menu";
import { BellIcon, CheckAllIcon } from "../icons";
import { shouldApplyCount } from "./notificationBadge";

const POLL_MS = 60_000;

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

  // Monotonic sequence so out-of-order async responses settle to the newest write.
  const seqRef = useRef(0);
  const appliedRef = useRef(0);
  // Suspend interval polling while the user's own mark POSTs are outstanding.
  const pendingMarks = useRef(0);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/notifications?limit=8", { cache: "no-store" });
    if (res.ok) setItems(((await res.json()).items as FeedItem[]) ?? []);
  }, []);

  const refreshCount = useCallback(async () => {
    const mySeq = ++seqRef.current;
    const res = await fetch("/api/v1/notifications/unread-count", { cache: "no-store" });
    if (!res.ok) return;
    const count = (await res.json()).count as number;
    if (shouldApplyCount(mySeq, appliedRef.current)) {
      appliedRef.current = mySeq;
      setUnread(count);
    }
  }, []);

  async function markRead(id: string) {
    setItems((prev) => prev?.map((i) => (i.id === id ? { ...i, readAt: new Date().toISOString() } : i)) ?? null);
    appliedRef.current = ++seqRef.current;
    setUnread((n) => Math.max(0, n - 1));
    pendingMarks.current += 1;
    try {
      await fetch(`/api/v1/notifications/${id}/read`, { method: "POST" });
    } finally {
      pendingMarks.current -= 1;
    }
    await refreshCount();
  }

  async function markAll() {
    setItems((prev) => prev?.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })) ?? null);
    appliedRef.current = ++seqRef.current;
    setUnread(0);
    pendingMarks.current += 1;
    try {
      await fetch("/api/v1/notifications/read-all", { method: "POST" });
    } finally {
      pendingMarks.current -= 1;
    }
    await refreshCount();
  }

  // Opening the panel loads items and reconciles the badge immediately.
  const onPanelOpen = useCallback(() => {
    void load();
    void refreshCount();
  }, [load, refreshCount]);

  // Live badge: poll the count while the tab is visible, and reconcile on focus.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      if (pendingMarks.current === 0) void refreshCount();
    };
    const start = () => {
      if (timer === null) timer = setInterval(tick, POLL_MS);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        void refreshCount();
        start();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [refreshCount]);

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
      <BellPanel items={items} onOpen={onPanelOpen} onMarkRead={markRead} onMarkAll={markAll} unread={unread} />
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
              className={`flex w-full items-start gap-2 border-b border-l-2 border-line/60 px-3 py-2 text-left hover:bg-ivory-100 ${
                it.readAt
                  ? "border-l-transparent"
                  : it.urgent
                    ? "border-l-claret-500 bg-claret-500/[0.04]"
                    : "border-l-gold-500 bg-gold-100/40"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm ${it.readAt ? "text-muted" : "text-navy-900"}`}>
                  {it.subject ?? "Notification"}
                </span>
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
