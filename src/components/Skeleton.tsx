import type { ReactNode } from "react";

// Shimmer placeholders for route loading.tsx files. The .skeleton animation is
// neutralized under prefers-reduced-motion (see globals.css). Server-safe.

export function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={`skeleton h-4 ${className}`} />;
}

export function SkeletonKpiRow({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-line bg-white p-5 shadow-sm">
          <div className="skeleton h-3 w-20" />
          <div className="skeleton mt-3 h-8 w-2/3" />
          <div className="mt-3 h-px w-7 bg-gold-500/40" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
      <div className="border-b border-line bg-ivory-100 px-4 py-3">
        <div className="skeleton h-3 w-32" />
      </div>
      <div className="divide-y divide-line">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-4 px-4 py-3">
            {Array.from({ length: cols }).map((_, c) => (
              <div key={c} className="skeleton h-3 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Generic page skeleton: a header line, an optional KPI row, then a table. */
export function SkeletonPage({ kpis = true, children }: { kpis?: boolean; children?: ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="skeleton h-3 w-24" />
        <div className="skeleton h-7 w-64" />
      </div>
      {kpis && <SkeletonKpiRow />}
      {children ?? <SkeletonTable />}
    </div>
  );
}
