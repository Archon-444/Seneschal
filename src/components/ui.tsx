import Link from "next/link";
import type { ReactNode } from "react";
import { formatDubaiDate, formatDubaiDateTime } from "@/server/calculators/dates";
import { badgeTone, BADGE_LABELS } from "./badgeTones";

// Shared UI primitives — Seneschal design language, ERP register: neutral
// surfaces, navy ink, one sans family, mono figures, 1px borders, 4px radii,
// no shadows, dense rows. Restyling here propagates to every screen. Type
// treatments use the .t-* scale and money/dates always render mono via
// .figure (see globals.css).

/** Small muted label above a title or form section. Sentence case. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="t-eyebrow mb-1">{children}</p>;
}

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
}: {
  title: string;
  /** Short factual context (a count, a range, a reference) — not a tagline. */
  subtitle?: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="t-title text-navy-900">{title}</h1>
          {subtitle && <p className="max-w-3xl text-[13px] text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
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
  const hoverClass = hover ? "transition hover:border-navy-500" : "";
  // Tailwind utilities have stylesheet order, not call-site order. Omitting the
  // default surface when a caller supplies one ensures semantic navy/tinted
  // cards are not accidentally rendered white with light-on-white text.
  const surfaceClass = /(?:^|\s)bg-[^\s]+/.test(className) ? "" : "bg-white";
  return (
    <div className={`rounded border border-line ${surfaceClass} p-4 ${hoverClass} ${className}`}>
      {children}
    </div>
  );
}

/** Bordered panel with an optional header row — the container for a titled
 *  table or list. `meta` sits beside the title in muted text; `actions` right. */
export function Panel({
  title,
  meta,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded border border-line bg-white ${className}`}>
      {(title || actions) && (
        <div className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-3 py-1.5">
          {title && <h2 className="text-[13px] font-semibold text-navy-900">{title}</h2>}
          {meta && <span className="text-[12.5px] text-muted">{meta}</span>}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

type StatTone = "default" | "warn" | "danger" | "good";
const STAT_TONE: Record<StatTone, string> = {
  default: "text-navy-900",
  warn: "text-amber-700",
  danger: "text-claret-500",
  good: "text-verde-700",
};

/** One figure with a label. Lives inside a StatStrip (or, via KpiCard, alone). */
export function Stat({
  label,
  value,
  sub,
  tone = "default",
  href,
  className = "",
}: {
  label: string;
  value: ReactNode;
  /** Optional caption under the figure — context, not a second metric. */
  sub?: string;
  tone?: StatTone;
  href?: string;
  className?: string;
}) {
  const inner = (
    <>
      <div className="text-[12px] text-muted">{label}</div>
      <div className={`figure t-kpi mt-1 ${STAT_TONE[tone]}`}>{value}</div>
      {sub && <div className="mt-1 text-[11.5px] text-muted">{sub}</div>}
    </>
  );
  const base = `block min-w-0 px-3.5 py-2.5 ${className}`;
  return href ? (
    <Link href={href} className={`${base} transition hover:bg-ivory-100`}>{inner}</Link>
  ) : (
    <div className={base}>{inner}</div>
  );
}

/** A single bordered row of Stats divided by hairlines — replaces KPI card grids. */
export function StatStrip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`grid grid-cols-2 divide-y divide-line overflow-hidden rounded border border-line bg-white sm:grid-cols-3 sm:divide-y-0 sm:divide-x lg:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] ${className}`}
    >
      {children}
    </div>
  );
}

/** Legacy stand-alone stat tile. Same API as before; renders as a bordered Stat.
 *  Prefer <StatStrip><Stat/>…</StatStrip> for rows of figures. */
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
  sub?: string;
  tone?: StatTone;
  variant?: "default" | "risk";
  href?: string;
}) {
  return (
    <Stat
      label={label}
      value={value}
      sub={sub}
      tone={variant === "risk" ? "danger" : tone}
      href={href}
      className="rounded border border-line bg-white"
    />
  );
}

export function Badge({
  value,
  dot = false,
  label,
}: {
  value: string;
  dot?: boolean;
  label?: string;
}) {
  const tone = badgeTone(value);
  const text = label ?? BADGE_LABELS[value] ?? value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ");
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-sm px-1.5 py-px text-[11px] font-semibold leading-4 ${tone}`}>
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
    <div className="rounded border border-dashed border-line bg-ivory-100 p-8 text-center">
      {title && <p className="mb-1 text-sm font-semibold text-navy-900">{title}</p>}
      <p className="text-sm text-muted">{message}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Shared table. Dense 34px rows, sentence-case headers. `stack` opts each row
 *  into a labeled card below `sm` — pass a `label` to each <Td> for the mobile
 *  row label. `bare` drops the outer border for use inside a <Panel>. */
export function Table({
  headers,
  children,
  stack = false,
  bare = false,
}: {
  headers: string[];
  children: ReactNode;
  stack?: boolean;
  bare?: boolean;
}) {
  return (
    <div className={`overflow-x-auto ${bare ? "" : "rounded border border-line bg-white"}`}>
      <table className={`ui-table w-full text-[13px] ${stack ? "table-stack" : ""}`}>
        <thead>
          <tr className="border-b border-line bg-ivory-100 text-left">
            {headers.map((h) => (
              <th key={h} scope="col" className="t-th h-8 whitespace-nowrap px-3 text-muted">
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
    <td data-label={label} className={`px-3 py-1.5 align-middle text-navy-900 ${className}`}>
      {children}
    </td>
  );
}

/** Segmented view switcher (a row of links, one active). */
export function Segmented({
  items,
  ariaLabel,
}: {
  items: { href: string; label: string; active: boolean; count?: number }[];
  ariaLabel: string;
}) {
  return (
    <nav aria-label={ariaLabel} className="inline-flex max-w-full overflow-x-auto rounded border border-line bg-white">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={`flex h-7 items-center gap-1.5 whitespace-nowrap border-r border-line px-2.5 text-[12.5px] last:border-r-0 ${
            item.active ? "bg-navy-900 font-medium text-white" : "text-navy-700 hover:bg-ivory-100"
          }`}
        >
          {item.label}
          {item.count != null && (
            <span className={`figure text-[11px] ${item.active ? "text-white/75" : "text-muted"}`}>{item.count}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}

/** Date-chipped reminder row. `hot` = deadline at risk. */
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
  const chip = hot ? "bg-claret-100 text-claret-700" : "bg-navy-50 text-navy-700";
  return (
    <div className="flex items-start gap-3 border-b border-line py-2 last:border-0">
      <span className={`figure min-w-16 rounded-sm px-2 py-0.5 text-center text-[11.5px] font-medium ${chip}`}>
        {date}
      </span>
      <div>
        <div className="text-[13px] font-medium text-navy-900">{title}</div>
        {sub && <div className="text-xs text-muted">{sub}</div>}
      </div>
    </div>
  );
}

const BUTTON_BASE =
  "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded border px-3 text-[13px] font-medium transition disabled:opacity-50";
const BUTTON_VARIANT = {
  primary: "border-navy-900 bg-navy-900 text-white hover:bg-navy-800",
  secondary: "border-line bg-white text-navy-900 hover:bg-ivory-100",
  danger: "border-claret-500 bg-claret-500 text-white hover:bg-claret-700",
} as const;

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: { children: ReactNode; variant?: keyof typeof BUTTON_VARIANT } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = "secondary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  const className = `${BUTTON_BASE} ${BUTTON_VARIANT[variant]}`;
  // API routes are file downloads (evidence pack, CSV export), not client-navigable
  // pages. next/link prefetches every href it is given, so pointing it at one makes
  // the router fetch that route as an RSC payload, which it cannot serve: the
  // evidence-pack route 500s on every renewal page render. A plain anchor is the
  // correct element for a download, and it also avoids a client-side navigation
  // attempt on click that the router cannot satisfy.
  if (href.startsWith("/api/")) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
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
      <span className="t-label mb-1 block text-navy-700">
        {label}
        {required && (
          <span className="ml-0.5 text-claret-500" aria-hidden="true">
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
  "w-full rounded border border-line bg-white px-2.5 py-1.5 text-[13px] text-navy-900 placeholder:text-muted focus:border-navy-500 focus:outline-none";

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
    <form method="get" className="mb-3 flex gap-2">
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
    <Link href={href} className="mb-3 inline-block text-[12.5px] text-muted hover:text-navy-900">
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
    <div className="rounded border border-line bg-white p-8 text-center">
      <p className="text-[15px] font-semibold text-navy-900">{title}</p>
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

/** A titled form section: Card + small heading (generalizes onboarding/new). */
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
      {title && <h2 className="mb-3 text-[15px] font-semibold text-navy-900">{title}</h2>}
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
  return <div className={`grid grid-cols-1 gap-3 ${colClass} ${className}`}>{children}</div>;
}

/** Consistent submit row; pass a helper note alongside the button(s). */
export function FormActions({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
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
    <p role="alert" className="rounded border border-claret-100 bg-claret-100 px-3 py-2 text-sm text-claret-700">
      {error}
    </p>
  ) : (
    <p role="status" className="rounded border border-verde-100 bg-verde-100 px-3 py-2 text-sm text-verde-700">
      {success}
    </p>
  );
}

/** Legal / scope footnote under a screen. One muted line, never a card. */
export function Footnote({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-[11.5px] leading-relaxed text-muted">{children}</p>;
}
