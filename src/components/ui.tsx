import Link from "next/link";
import type { ReactNode } from "react";

// Shared UI primitives — Seneschal design language: ivory surfaces, navy ink,
// gold accents, Fraunces display, Public Sans body, mono figures. Restyling
// here propagates to every screen.

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.14em] text-gold-700">
      {children}
    </p>
  );
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
        <h1 className="font-display text-[30px] font-semibold text-navy-900">{title}</h1>
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
  tone = "default",
  variant = "default",
  href,
}: {
  label: string;
  value: ReactNode;
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
  const inner =
    variant === "risk" ? (
      <div
        className={`rounded-xl border border-navy-900 bg-navy-900 p-5 text-white shadow-sm ${href ? "transition hover:brightness-125" : ""}`}
      >
        <div className="text-xs font-bold uppercase tracking-wider text-gold-500">{label}</div>
        <div className="figure mt-1 text-3xl font-semibold">{value}</div>
      </div>
    ) : (
      <Card hover={!!href}>
        <div className="text-xs font-bold uppercase tracking-wider text-muted">{label}</div>
        <div className={`figure mt-1 text-3xl ${toneClass}`}>{value}</div>
      </Card>
    );
  return href ? (
    <Link href={href} className="block">{inner}</Link>
  ) : (
    inner
  );
}

const BADGE_TONES: Record<string, string> = {
  // payment + generic statuses
  SCHEDULED: "bg-navy-50 text-navy-500",
  REQUESTED: "bg-amber-100 text-amber-700",
  RECEIVED: "bg-verde-100 text-verde-700",
  DEPOSITED: "bg-verde-100 text-verde-700",
  CLEARED: "bg-verde-100 text-verde-700",
  LATE: "bg-claret-100 text-claret-700",
  BOUNCED: "bg-claret-100 text-claret-700",
  CANCELLED: "bg-ivory-200 text-muted",
  OPEN: "bg-navy-50 text-navy-500",
  SENT: "bg-amber-100 text-amber-700",
  SUBMITTED: "bg-amber-100 text-amber-700",
  WAITING_PROOF: "bg-amber-100 text-amber-700",
  APPROVED: "bg-verde-100 text-verde-700",
  REJECTED: "bg-claret-100 text-claret-700",
  OVERDUE: "bg-claret-100 text-claret-700",
  CLOSED: "bg-ivory-200 text-muted",
  ACTIVE: "bg-verde-100 text-verde-700",
  ARCHIVED: "bg-ivory-200 text-muted",
  COMMITTED: "bg-verde-100 text-verde-700",
  ROLLED_BACK: "bg-claret-100 text-claret-700",
  PENDING: "bg-navy-50 text-navy-500",
  EXTRACTED: "bg-amber-100 text-amber-700",
  CONFLICT: "bg-claret-100 text-claret-700",
  ACCEPTED: "bg-verde-100 text-verde-700",
  // severities
  INFO: "bg-navy-50 text-navy-500",
  WARN: "bg-amber-100 text-amber-700",
  CRITICAL: "bg-claret-100 text-claret-700",
  ACKNOWLEDGED: "bg-navy-50 text-navy-500",
};

export function Badge({ value, dot = true }: { value: string; dot?: boolean }) {
  const tone = BADGE_TONES[value] ?? "bg-navy-50 text-navy-500";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${tone}`}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {value.replace(/_/g, " ")}
    </span>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-ivory-100 p-10 text-center text-sm text-muted">
      {message}
    </div>
  );
}

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-ivory-100 text-left">
            {headers.map((h) => (
              <th
                key={h}
                className="px-4 py-2.5 text-[10.5px] font-bold uppercase tracking-wider text-muted"
              >
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

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 align-top text-navy-700 ${className}`}>{children}</td>;
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

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-muted">{label}</span>
      {children}
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
        className="w-full max-w-sm rounded-lg border border-line bg-white px-3 py-2 text-sm text-navy-900 focus:border-gold-500 focus:outline-none"
      />
      <Button type="submit" variant="secondary">Search</Button>
      {q ? <LinkButton href="?">Clear</LinkButton> : null}
    </form>
  );
}
