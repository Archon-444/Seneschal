import type { ReactNode } from "react";

// Shimmer placeholders for route loading.tsx files. The .skeleton animation is
// neutralized under prefers-reduced-motion (see globals.css). Server-safe.

export function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={`skeleton h-4 ${className}`} />;
}

/** Matches <StatStrip>: one bordered row of figures divided by hairlines. */
export function SkeletonKpiRow({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 divide-y divide-line overflow-hidden rounded border border-line bg-white sm:grid-cols-3 sm:divide-y-0 sm:divide-x lg:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="px-3.5 py-2.5">
          <div className="skeleton h-3 w-24" />
          <div className="skeleton mt-2 h-5 w-10" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded border border-line bg-white">
      <div className="border-b border-line bg-ivory-100 px-3 py-2.5">
        <div className="skeleton h-3 w-32" />
      </div>
      <div className="divide-y divide-line">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-4 px-3 py-2.5">
            {Array.from({ length: cols }).map((_, c) => (
              <div key={c} className="skeleton h-3 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Kept for callers that still import it; the dashboard now lists deadlines in
 *  a table, so this renders the same shape as SkeletonTable. */
export function SkeletonTimeline({ rows = 5 }: { rows?: number }) {
  return <SkeletonTable rows={rows} cols={4} />;
}

/** Generic page skeleton: a header line, an optional KPI row, then a table. */
export function SkeletonPage({ kpis = true, children }: { kpis?: boolean; children?: ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="skeleton h-6 w-56" />
      {kpis && <SkeletonKpiRow />}
      {children ?? <SkeletonTable />}
    </div>
  );
}
