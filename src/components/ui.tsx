import Link from "next/link";
import type { ReactNode } from "react";
import { formatDubaiDate, formatDubaiDateTime } from "@/server/calculators/dates";
import { badgeTone, BADGE_LABELS } from "./badgeTones";

// Shared UI primitives — Seneschal design language: ivory surfaces, navy ink,
// gold accents, Fraunces display, Public Sans body, mono figures. Restyling
// here propagates to every screen. Type treatments use the .t-* scale and
// money/dates always render mono via .figure (see globals.css).

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="t-eyebrow mb-2 text-gold-700">{children}</p>;
}

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="font-display t-title text-navy-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  children,
  className = "",
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}) {
  const hoverClass = hover
    ? "transition hover:border-gold-500 hover:shadow-md"
    : "";
  return (
    <div
      className={`rounded-xl border border-line bg-white p-5 shadow-sm ${hoverClass} ${className}`}
    >
      {children}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  tone = "default",
  variant = "default",
  href,
}: {
  label: string;
  value: ReactNode;
  /** Optional caption under the figure — context, not a second metric. */
  sub?: string;
  tone?: "default" | "warn" | "danger" | "good";
  variant?: "default" | "risk";
  href?: string;
}) {
  const toneClass = {
    default: "text-navy-900",
    warn: "text-amber-700",
    danger: "text-claret-500",
    good: "text-verde-700",
  }[tone];
  // The ledger "tick": a short hairline-gold rule under every figure — the one
  // recurring signature mark, quiet enough to live on every screen.
  const inner =
    variant === "risk" ? (
      <div
        className={`rounded-xl border border-navy-900 bg-navy-900 p-5 text-white shadow-sm ${href ? "transition hover:brightness-110" : ""}`}
      >
        <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-gold-500">{label}</div>
        <div className="figure t-kpi mt-2">{value}</div>
        <div className="mt-3 h-px w-7 bg-gold-500/60" />
        {sub && <div className="mt-2 text-[11px] text-white/55">{sub}</div>}
      </div>
    ) : (
      <Card hover={!!href}>
        <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted">{label}</div>
        <div className={`figure t-kpi mt-2 ${toneClass}`}>{value}</div>
        <div className="mt-3 h-px w-7 bg-gold-500/40" />
        {sub && <div className="mt-2 text-[11px] text-muted">{sub}</div>}
      </Card>
    );
  return href ? (
    <Link href={href} className="block">{inner}</Link>
  ) : (
    inner
  );
}

export function Badge({
  value,
  dot = true,
  label,
}: {
  value: string;
  dot?: boolean;
  label?: string;
}) {
  const tone = badgeTone(value);
  const text = label ?? BADGE_LABELS[value] ?? value.replace(/_/g, " ");
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${tone}`}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {text}
    </span>
  );
}

/** Zero-state. `message` describes the empty; optional `title` + `action` turn
 *  it into an invitation to act. */
export function EmptyState({
  message,
  title,
  action,
}: {
  message: string;
  title?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-ivory-100 p-10 text-center">
      {title && <p className="mb-1 text-sm font-semibold text-navy-900">{title}</p>}
      <p className="text-sm text-muted">{message}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Shared table. `stack` opts each row into a labeled card below `sm` — pass a
 *  `label` to each <Td> for the mobile row label. Row hover comes from .ui-table. */
export function Table({
  headers,
  children,
  stack = false,
}: {
  headers: string[];
  children: ReactNode;
  stack?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
      <table className={`ui-table w-full text-sm ${stack ? "table-stack" : ""}`}>
        <thead>
          <tr className="border-b border-line bg-ivory-100 text-left">
            {headers.map((h) => (
              <th key={h} scope="col" className="t-th px-4 py-2.5 text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({
  children,
  className = "",
  label,
}: {
  children: ReactNode;
  className?: string;
  /** Mobile row label, surfaced by the `stack` table treatment. */
  label?: string;
}) {
  return (
    <td data-label={label} className={`px-4 py-2.5 align-top text-navy-700 ${className}`}>
      {children}
    </td>
  );
}

/** Date-chipped reminder row (dashboard "Coming up"). `hot` = deadline at risk. */
export function Reminder({
  date,
  title,
  sub,
  hot = false,
}: {
  date: string;
  title: ReactNode;
  sub?: ReactNode;
  hot?: boolean;
}) {
  const chip = hot ? "bg-claret-100 text-claret-700" : "bg-gold-100 text-gold-700";
  return (
    <div className="flex items-start gap-3 border-b border-dashed border-line py-2.5 last:border-0">
      <span className={`figure min-w-16 rounded-md px-2 py-1 text-center text-[11.5px] font-semibold ${chip}`}>
        {date}
      </span>
      <div>
        <div className="text-sm font-semibold text-navy-900">{title}</div>
        {sub && <div className="text-xs text-muted">{sub}</div>}
      </div>
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  ...props
}: { children: ReactNode; variant?: "primary" | "secondary" | "danger" } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles = {
    primary: "bg-navy-900 text-ivory-50 hover:brightness-110",
    secondary: "border border-line bg-white text-navy-700 hover:bg-ivory-100",
    danger: "bg-claret-500 text-white hover:bg-claret-700",
  }[variant];
  return (
    <button
      className={`rounded-lg px-4 py-2.5 text-sm font-bold transition disabled:opacity-50 ${styles}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = "secondary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  const styles = {
    primary: "bg-navy-900 text-ivory-50 hover:brightness-110",
    secondary: "border border-line bg-white text-navy-700 hover:bg-ivory-100",
  }[variant];
  return (
    <Link href={href} className={`inline-block rounded-lg px-4 py-2.5 text-sm font-bold transition ${styles}`}>
      {children}
    </Link>
  );
}

export function Field({
  label,
  children,
  hint,
  required,
  error,
  errorId,
}: {
  label: string;
  children: ReactNode;
  /** Short helper text under the control. */
  hint?: string;
  required?: boolean;
  /** Validation error — replaces the hint. Pair with `errorId`: give the
   *  control `aria-invalid` and `aria-describedby={errorId}` so screen
   *  readers announce the message with the field. */
  error?: string;
  errorId?: string;
}) {
  return (
    <label className="block">
      <span className="t-label mb-1 block text-muted">
        {label}
        {required && (
          <span className="ml-0.5 text-gold-700" aria-hidden="true">
            *
          </span>
        )}
      </span>
      {children}
      {error ? (
        <span id={errorId} className="t-caption mt-1 block text-claret-700">
          {error}
        </span>
      ) : (
        hint && <span className="t-caption mt-1 block text-muted">{hint}</span>
      )}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line bg-ivory-100 px-3 py-2.5 text-sm text-navy-900 focus:border-gold-500 focus:bg-white focus:outline-none";

export function Money({ amount }: { amount: string | number }) {
  const n = typeof amount === "string" ? Number(amount) : amount;
  return <span className="figure">AED {n.toLocaleString("en-AE", { minimumFractionDigits: 0 })}</span>;
}

/** Server-rendered search box: a GET form that sets ?q= on the current page. */
export function SearchForm({
  q,
  placeholder = "Search…",
  hidden,
}: {
  q?: string;
  placeholder?: string;
  hidden?: Record<string, string>;
}) {
  return (
    <form method="get" className="mb-4 flex gap-2">
      {hidden &&
        Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input
        name="q"
        defaultValue={q ?? ""}
        placeholder={placeholder}
        className={`${inputClass} max-w-sm`}
      />
      <Button type="submit" variant="secondary">Search</Button>
      {q ? <LinkButton href="?">Clear</LinkButton> : null}
    </form>
  );
}

/** Map a scope (scopeType/scopeId) to the record's page. Single source of truth
 *  so every screen links the same way. Returns null when there's no destination. */
export function resolveScopeLink(scopeType: string, scopeId: string | null): string | null {
  if (!scopeId) return null;
  switch (scopeType) {
    case "TENANCY":
      return `/renewals/${scopeId}`;
    case "PROPERTY":
      return `/properties/${scopeId}`;
    case "CLIENT":
      return `/clients/${scopeId}`;
    case "PROOF_REQUEST":
      return `/proofs/${scopeId}`;
    case "PAYMENT_ITEM":
      return "/payments";
    default:
      return null;
  }
}

/** A scope rendered as a link to its record, or plain text when unlinkable. */
export function ScopeLink({
  scopeType,
  scopeId,
  label,
}: {
  scopeType: string;
  scopeId: string | null;
  label?: string;
}) {
  const href = resolveScopeLink(scopeType, scopeId);
  const text = label ?? scopeType.replace(/_/g, " ").toLowerCase();
  return href ? (
    <Link href={href} className="text-navy-700 hover:underline">{text}</Link>
  ) : (
    <span className="text-navy-500">{text}</span>
  );
}

/** Consistent "← back to list" affordance for detail pages. */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="mb-4 inline-block text-sm text-muted hover:text-navy-900">
      ← {label}
    </Link>
  );
}

/** Calm, document-grade failure card. Used by route error boundaries
 *  (see RouteError) and anywhere a section can't load. Errors don't apologize. */
export function ErrorState({
  title = "Something didn't load",
  message = "Please try again.",
  onRetry,
  retryLabel = "Try again",
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-white p-10 text-center shadow-sm">
      <p className="font-display text-lg font-semibold text-navy-900">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{message}</p>
      {onRetry && (
        <div className="mt-5 flex justify-center">
          <Button onClick={onRetry}>{retryLabel}</Button>
        </div>
      )}
    </div>
  );
}

/** Right-aligned cluster for inline row / section actions. */
export function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>;
}

/** A date rendered in Dubai convention, mono per the design language. Reuse this
 *  instead of hand-rolling a formatter or importing the calculator into a page. */
export function DubaiDate({ value, className = "" }: { value: Date | string; className?: string }) {
  const d = typeof value === "string" ? new Date(value) : value;
  return <span className={`figure ${className}`}>{formatDubaiDate(d)}</span>;
}

/** A real timestamp (time slot, e.g. a viewing) rendered in Dubai-local time, mono. */
export function DubaiDateTime({
  value,
  className = "",
}: {
  value: Date | string;
  className?: string;
}) {
  const d = typeof value === "string" ? new Date(value) : value;
  return <span className={`figure ${className}`}>{formatDubaiDateTime(d)}</span>;
}

/** A titled form section: Card + Eyebrow heading (generalizes onboarding/new). */
export function FormSection({
  eyebrow,
  title,
  children,
  className = "",
}: {
  eyebrow?: string;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      {title && <h2 className="font-display mb-3 text-lg font-semibold text-navy-900">{title}</h2>}
      {children}
    </Card>
  );
}

/** Responsive field grid: one column on mobile, `cols` from `sm` up. */
export function FormGrid({
  children,
  cols = 2,
  className = "",
}: {
  children: ReactNode;
  cols?: 1 | 2 | 3;
  className?: string;
}) {
  const colClass = cols === 1 ? "sm:grid-cols-1" : cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";
  return <div className={`grid grid-cols-1 gap-4 ${colClass} ${className}`}>{children}</div>;
}

/** Consistent submit row; pass a helper note alongside the button(s). */
export function FormActions({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      {children}
      {note && <span className="t-caption text-muted">{note}</span>}
    </div>
  );
}

/** Renders a server action's returned error/success. Wire ONLY to forms whose
 *  action already returns a status (useActionState) — never add an error channel
 *  to a void action just to surface this. */
export function FormStatus({ error, success }: { error?: string | null; success?: string | null }) {
  if (!error && !success) return null;
  return error ? (
    <p role="alert" className="rounded-lg bg-claret-100 px-3 py-2 text-sm text-claret-700">
      {error}
    </p>
  ) : (
    <p role="status" className="rounded-lg bg-verde-100 px-3 py-2 text-sm text-verde-700">
      {success}
    </p>
  );
}
