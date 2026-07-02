"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

// Transient client-action feedback (confirm-then-submit flows, background
// completions). Additive to FormStatus — persistent server-rendered form
// status stays with FormStatus; toasts are for moments where a lingering
// inline block would read as clutter. Animation is neutralized under
// prefers-reduced-motion by the global rule in globals.css.

type ToastTone = "success" | "error" | "info";
type ToastItem = { id: number; tone: ToastTone; message: string };
type ShowToast = (toast: { tone?: ToastTone; message: string; duration?: number }) => void;

const ToastContext = createContext<ShowToast | null>(null);

export function useToast(): { show: ShowToast } {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used within <ToastProvider>");
  return { show };
}

const DOT: Record<ToastTone, string> = {
  success: "bg-verde-500",
  error: "bg-claret-500",
  info: "bg-gold-500",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ShowToast>(
    ({ tone = "info", message, duration }) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, tone, message }]);
      // Errors linger longer so they can be read; everything auto-dismisses.
      const ms = duration ?? (tone === "error" ? 8000 : 5000);
      setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-full max-w-xs flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className="seneschal-toast pointer-events-auto flex items-start gap-2.5 rounded-xl border border-line bg-white px-4 py-3 shadow-md"
          >
            <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[t.tone]}`} />
            <p className="flex-1 text-sm text-navy-900">{t.message}</p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
              className="-mr-1 rounded px-1 text-muted transition hover:text-navy-900"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
