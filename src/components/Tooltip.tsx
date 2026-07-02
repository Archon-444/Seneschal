"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * Keyboard-accessible tooltip for short explanations of derived figures
 * (index ceilings, confidence thresholds). Shows on hover AND focus, hides on
 * Escape; the bubble is connected via aria-describedby. Not for content a user
 * must read to proceed — that belongs inline (Field hint or copy).
 */
export function Tooltip({
  label,
  children,
  triggerLabel,
}: {
  /** The tooltip text. */
  label: string;
  /** Trigger content (icon, dotted-underline term…). */
  children: ReactNode;
  /** Accessible name for the trigger when its content is decorative. */
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <span tabIndex={0} aria-label={triggerLabel} aria-describedby={open ? id : undefined}>
        {children}
      </span>
      {open && (
        <span
          role="tooltip"
          id={id}
          className="absolute bottom-full left-1/2 z-50 mb-1.5 w-max max-w-56 -translate-x-1/2 rounded-lg border border-line bg-navy-900 px-3 py-2 text-xs text-ivory-50 shadow-md"
        >
          {label}
        </span>
      )}
    </span>
  );
}

/** The standard "what is this figure?" affordance: a small circled i. */
export function InfoTooltip({ text }: { text: string }) {
  return (
    <Tooltip label={text} triggerLabel="More information">
      <span
        aria-hidden="true"
        className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line bg-ivory-100 text-[10px] font-bold text-muted"
      >
        i
      </span>
    </Tooltip>
  );
}
