import Link from "next/link";
import type { ReactNode } from "react";

// Shared UI primitives — shadcn/ui-style, Seneschal design language:
// ivory surfaces, navy ink, gold accents, serif display, mono figures.

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl text-navy-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-navy-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-ivory-300 bg-white p-5 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function KpiCard({ label, value, tone = "default" }: { label: string; value: ReactNode; tone?: "default" | "warn" | "danger" | "good" }) {
  const toneClass = {
    default: "text-navy-900",
    warn: "text-gold-700",
    danger: "text-claret-500",
    good: "text-verde-700",
  }[tone];
  return (
    <Card>
      <div className="text-xs font-medium uppercase tracking-wide text-navy-300">{label}</div>
      <div className={`figure mt-1 text-3xl ${toneClass}`}>{value}</div>
    </Card>
  );
}

const BADGE_TONES: Record<string, string> = {
  // payment + generic statuses
  SCHEDULED: "bg-navy-50 text-navy-500",
  REQUESTED: "bg-gold-300/30 text-gold-700",
  RECEIVED: "bg-verde-100 text-verde-700",
  DEPOSITED: "bg-verde-100 text-verde-700",
  CLEARED: "bg-verde-100 text-verde-700",
  LATE: "bg-claret-100 text-claret-700",
  BOUNCED: "bg-claret-100 text-claret-700",
  CANCELLED: "bg-ivory-200 text-navy-300",
  OPEN: "bg-navy-50 text-navy-500",
  SENT: "bg-gold-300/30 text-gold-700",
  SUBMITTED: "bg-gold-300/30 text-gold-700",
  WAITING_PROOF: "bg-gold-300/30 text-gold-700",
  APPROVED: "bg-verde-100 text-verde-700",
  REJECTED: "bg-claret-100 text-claret-700",
  OVERDUE: "bg-claret-100 text-claret-700",
  CLOSED: "bg-ivory-200 text-navy-300",
  ACTIVE: "bg-verde-100 text-verde-700",
  ARCHIVED: "bg-ivory-200 text-navy-300",
  COMMITTED: "bg-verde-100 text-verde-700",
  ROLLED_BACK: "bg-claret-100 text-claret-700",
  PENDING: "bg-navy-50 text-navy-500",
  EXTRACTED: "bg-gold-300/30 text-gold-700",
  CONFLICT: "bg-claret-100 text-claret-700",
  ACCEPTED: "bg-verde-100 text-verde-700",
  // severities
  INFO: "bg-navy-50 text-navy-500",
  WARN: "bg-gold-300/30 text-gold-700",
  CRITICAL: "bg-claret-100 text-claret-700",
  ACKNOWLEDGED: "bg-navy-50 text-navy-500",
};

export function Badge({ value }: { value: string }) {
  const tone = BADGE_TONES[value] ?? "bg-navy-50 text-navy-500";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${tone}`}>
      {value.replace(/_/g, " ")}
    </span>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-ivory-300 bg-ivory-100 p-10 text-center text-sm text-navy-300">
      {message}
    </div>
  );
}

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-ivory-300 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ivory-200 bg-ivory-100 text-left">
            {headers.map((h) => (
              <th key={h} className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-navy-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ivory-200">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 align-top text-navy-700 ${className}`}>{children}</td>;
}

export function Button({
  children,
  variant = "primary",
  ...props
}: { children: ReactNode; variant?: "primary" | "secondary" | "danger" } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles = {
    primary: "bg-navy-800 text-ivory-50 hover:bg-navy-700",
    secondary: "border border-navy-100 bg-white text-navy-700 hover:bg-ivory-100",
    danger: "bg-claret-500 text-white hover:bg-claret-700",
  }[variant];
  return (
    <button
      className={`rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${styles}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = "secondary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  const styles = {
    primary: "bg-navy-800 text-ivory-50 hover:bg-navy-700",
    secondary: "border border-navy-100 bg-white text-navy-700 hover:bg-ivory-100",
  }[variant];
  return (
    <Link href={href} className={`inline-block rounded-md px-4 py-2 text-sm font-medium transition-colors ${styles}`}>
      {children}
    </Link>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-navy-500">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-md border border-ivory-300 bg-white px-3 py-2 text-sm text-navy-900 focus:border-navy-300 focus:outline-none";

export function Money({ amount }: { amount: string | number }) {
  const n = typeof amount === "string" ? Number(amount) : amount;
  return <span className="figure">AED {n.toLocaleString("en-AE", { minimumFractionDigits: 0 })}</span>;
}
