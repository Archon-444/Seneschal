import { requireCtx } from "@/server/auth/request";
import { listEvidence, EVIDENCE_LABELS } from "@/server/services/evidenceQuery";
import { EmptyState, PageHeader } from "@/components/ui";
import Link from "next/link";

// Screen 14 — evidence timeline (T8.2). P9 taxonomy labels; loads 500 events.

export default async function EvidencePage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;
  const ctx = await requireCtx();
  const events = await listEvidence(ctx, {
    types: type ? [type as never] : undefined,
    limit: 500,
  });
  const typesPresent = [...new Set(events.map((e) => e.type))];

  return (
    <>
      <PageHeader title="Evidence timeline" subtitle="Append-only. Corrections are new events referencing the old." />
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Link href="/evidence" className={`rounded px-2 py-1 ${!type ? "bg-navy-800 text-ivory-50" : "bg-white text-navy-500"}`}>
          All
        </Link>
        {typesPresent.map((t) => (
          <Link key={t} href={`/evidence?type=${t}`} className={`rounded px-2 py-1 ${type === t ? "bg-navy-800 text-ivory-50" : "bg-white text-navy-500"}`}>
            {EVIDENCE_LABELS[t] ?? t}
          </Link>
        ))}
      </div>
      {events.length === 0 ? (
        <EmptyState message="No evidence recorded yet." />
      ) : (
        <ol className="relative ml-3 max-w-3xl space-y-5 border-l border-ivory-300 pl-6">
          {events.map((e) => (
            <li key={e.id}>
              <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-gold-500" />
              <div className="text-sm font-medium text-navy-900">{EVIDENCE_LABELS[e.type] ?? e.type}</div>
              <div className="figure text-xs text-navy-300">
                {e.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC · {e.actorType}
                {e.onBehalfOfId ? " (on behalf of)" : ""} · scope {e.scopeType}
              </div>
              {e.payload != null && (
                <pre className="mt-1 max-w-xl overflow-x-auto rounded bg-ivory-100 p-2 text-[11px] text-navy-500">
                  {JSON.stringify(e.payload, null, 1)}
                </pre>
              )}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
