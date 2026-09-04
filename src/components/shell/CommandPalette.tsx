"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SearchHit } from "@/server/services/search";

// ⌘K jump-to-record palette (operator surface only — mounted when AppShell
// receives a `search` action). Native <dialog> gives the focus trap, Escape,
// and focus-return; results come from the scoped globalSearch service, so a
// hit is always something this role could reach via the entity's own list.

const GROUP_LABEL: Record<SearchHit["type"], string> = {
  property: "Properties",
  contact: "Contacts",
  client: "Clients",
};

export function CommandPalette({ search }: { search: (q: string) => Promise<SearchHit[]> }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [pending, startTransition] = useTransition();
  // Monotonic query counter — a slow early response must not overwrite a
  // faster later one.
  const seq = useRef(0);

  const open = useCallback(() => {
    dialogRef.current?.showModal();
    inputRef.current?.focus();
  }, []);

  const close = useCallback(() => {
    dialogRef.current?.close();
  }, []);

  // Global shortcut: ⌘K (mac) / Ctrl+K.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (dialogRef.current?.open) close();
        else open();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Debounced lookup.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setHits([]);
      setActive(0);
      return;
    }
    const id = ++seq.current;
    const timer = setTimeout(() => {
      startTransition(async () => {
        const res = await search(query);
        if (seq.current === id) {
          setHits(res);
          setActive(0);
        }
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [q, search]);

  function reset() {
    setQ("");
    setHits([]);
    setActive(0);
  }

  function go(hit: SearchHit) {
    close();
    router.push(hit.href);
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (hits.length ? (a + 1) % hits.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (hits.length ? (a - 1 + hits.length) % hits.length : 0));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      go(hits[active]);
    }
  }

  // Group for display while keeping `hits` flat for arrow-key order.
  const groups = (["property", "contact", "client"] as const)
    .map((type) => ({ type, items: hits.filter((h) => h.type === type) }))
    .filter((g) => g.items.length > 0);

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="flex h-8 w-full max-w-sm items-center gap-2 rounded border border-line bg-ivory-100 px-2.5 text-[12.5px] text-muted hover:border-navy-300 hover:bg-white"
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <span className="hidden flex-1 text-left sm:inline">Search properties, contacts, clients</span>
        <kbd className="figure hidden rounded-sm border border-line bg-white px-1 text-[10px] text-muted md:inline">⌘K</kbd>
      </button>
      <dialog
        ref={dialogRef}
        onClose={reset}
        aria-label="Search records"
        className="seneschal-dialog mx-auto mt-[12vh] w-full max-w-lg rounded border border-line bg-white p-0 shadow-lg"
      >
        <div className="border-b border-line p-3">
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls={listId}
            aria-activedescendant={hits[active] ? `${listId}-${active}` : undefined}
            aria-label="Search properties, contacts and clients"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search properties, contacts, clients…"
            className="w-full bg-transparent text-sm text-navy-900 placeholder:text-muted focus:outline-none"
          />
        </div>
        <div id={listId} role="listbox" aria-label="Results" className="max-h-80 overflow-y-auto p-2">
          {q.trim().length < 2 ? (
            <p className="px-2 py-4 text-center text-xs text-muted">
              Type at least two characters to search.
            </p>
          ) : pending && hits.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted">Searching…</p>
          ) : hits.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted">No matches for “{q.trim()}”.</p>
          ) : (
            groups.map((group) => (
              <div key={group.type} className="mb-1">
                <p className="t-label px-2 pt-2 pb-1 text-muted">{GROUP_LABEL[group.type]}</p>
                {group.items.map((hit) => {
                  const index = hits.indexOf(hit);
                  return (
                    <button
                      key={`${hit.type}-${hit.id}`}
                      type="button"
                      role="option"
                      id={`${listId}-${index}`}
                      aria-selected={index === active}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => go(hit)}
                      className={`flex w-full items-baseline justify-between gap-3 rounded px-2 py-1.5 text-left text-[13px] ${
                        index === active ? "bg-ivory-100 text-navy-900" : "text-navy-700"
                      }`}
                    >
                      <span className="truncate font-semibold">{hit.label}</span>
                      {hit.sub && <span className="shrink-0 text-xs text-muted">{hit.sub}</span>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[10px] text-muted">
          <span>↑↓ navigate · ↵ open · esc close</span>
          <span className="figure">{hits.length > 0 ? `${hits.length} result${hits.length === 1 ? "" : "s"}` : ""}</span>
        </div>
      </dialog>
    </>
  );
}
