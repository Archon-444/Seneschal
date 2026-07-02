import Link from "next/link";

// Server-component-friendly pagination: plain links that set ?page=N on the
// current path, preserving other query params. Pair with paginate() below for
// in-memory slicing; lists large enough to need DB-level skip/take should move
// the slicing into their service instead (same component either way).

export function Pagination({
  page,
  totalPages,
  basePath,
  searchParams = {},
}: {
  page: number;
  totalPages: number;
  basePath: string;
  /** Current query params to preserve across page links. */
  searchParams?: Record<string, string | undefined>;
}) {
  if (totalPages <= 1) return null;
  const href = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v && k !== "page") params.set(k, v);
    }
    params.set("page", String(p));
    return `${basePath}?${params.toString()}`;
  };
  const linkClass =
    "rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-bold text-navy-700 transition hover:bg-ivory-100";
  const disabledClass =
    "rounded-lg border border-line bg-ivory-100 px-3 py-1.5 text-sm font-bold text-muted opacity-50";
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} className={linkClass}>
          ← Previous
        </Link>
      ) : (
        <span aria-hidden="true" className={disabledClass}>
          ← Previous
        </span>
      )}
      <span className="figure text-xs text-muted">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={href(page + 1)} className={linkClass}>
          Next →
        </Link>
      ) : (
        <span aria-hidden="true" className={disabledClass}>
          Next →
        </span>
      )}
    </nav>
  );
}

/** Slice a fetched list for the current page; clamps out-of-range pages. */
export function paginate<T>(
  items: T[],
  rawPage: number,
  pageSize: number,
): { pageItems: T[]; page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, Math.floor(rawPage) || 1), totalPages);
  return {
    pageItems: items.slice((page - 1) * pageSize, page * pageSize),
    page,
    totalPages,
  };
}
