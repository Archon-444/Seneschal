"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

// Accessible dropdown primitive, reused by the user menu and the notification
// bell. Handles open/close, click-outside, Escape (with focus return to the
// trigger), focus-first-item on open, and the aria wiring. Menu items are real
// links/buttons, so Tab/Shift+Tab move between them natively.

export function Dropdown({
  label,
  button,
  buttonClassName = "",
  panelClassName = "",
  align = "right",
  children,
}: {
  label: string;
  button: ReactNode;
  buttonClassName?: string;
  panelClassName?: string;
  align?: "left" | "right";
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    // Move focus into the panel so keyboard users land on the first action.
    panelRef.current?.querySelector<HTMLElement>("a,button,[tabindex]")?.focus();
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className={buttonClassName}
      >
        {button}
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="menu"
          className={`absolute z-50 mt-2 ${align === "right" ? "right-0" : "left-0"} ${panelClassName}`}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}
