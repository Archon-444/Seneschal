import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { getEvidenceFilterOptions, getEvidenceTimeline } from "@/server/services/evidenceReadModel";
import {
  APPROVED_EVIDENCE_TYPES,
  EVIDENCE_CATEGORIES,
  titleForEvidenceType,
} from "@/server/services/evidencePresenter";
import { formatDubaiDateTime } from "@/server/calculators/dates";
import { EvidenceEventCard } from "@/components/evidence/EvidenceEventCard";
import { Pagination } from "@/components/Pagination";
import { EmptyState, inputClass, LinkButton, PageHeader } from "@/components/ui";

type EvidenceSearchParams = {
  type?: string;
  category?: string;
  actor?: string;
  from?: string;
  to?: string;
  client?: string;
  property?: string;
  tenancy?: string;
  renewal?: string;
  proof?: string;
  q?: string;
  page?: string;
  print?: string;
  event?: string;
};

function dubaiBoundary(value: string | undefined, end = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}+04:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function queryHref(current: EvidenceSearchParams, patch: Partial<EvidenceSearchParams>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...patch })) {
    if (value && key !== "page" && key !== "print") params.set(key, value);
  }
  const query = params.toString();
  return `/evidence${query ? `?${query}` : ""}`;
}

export default async function EvidencePage({ searchParams }: { searchParams: Promise<EvidenceSearchParams> }) {
  const params = await searchParams;
  const ctx = await requireCtx();
  const print = params.print === "1";
  const page = Math.max(1, Number(params.page) || 1);
  const [timeline, options] = await Promise.all([
    getEvidenceTimeline(ctx, {
      type: params.type,
      category: params.category,
      actor: params.actor,
      from: dubaiBoundary(params.from),
      to: dubaiBoundary(params.to, true),
      client: params.client,
      property: params.property,
      tenancy: params.tenancy,
      renewal: params.renewal,
      proof: params.proof,
      q: params.q,
      page: print ? 1 : page,
      pageSize: print ? 100 : 40,
      sort: print ? "asc" : "desc",
      event: params.event,
    }),
    getEvidenceFilterOptions(ctx),
  ]);
  const activeFilters = Object.entries(params).filter(([key, value]) => value && !["page", "print"].includes(key)).length;
  const paginationParams: Record<string, string | undefined> = { ...params, print: undefined };
  const printParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value && key !== "page" && key !== "print") printParams.set(key, value);
  printParams.set("print", "1");

  return (
    <div className={print ? "mx-auto max-w-4xl bg-white print:p-0" : ""}>
      <div className={print ? "print:hidden" : ""}>
        <PageHeader
          eyebrow="Fiduciary record"
          title="Evidence"
          subtitle="A human-readable projection of the append-only ledger. Corrections remain new linked events; originals are never hidden."
          actions={<LinkButton href={`/evidence?${printParams.toString()}`}>Print-ready view</LinkButton>}
        />
      </div>

      {print && (
        <header className="mb-8 border-b border-line pb-5">
          <div className="text-[12px] font-medium text-muted">Seneschal · record of activity</div>
          <h1 className="font-semibold mt-2 text-3xl text-navy-900">Evidence record</h1>
          <p className="mt-2 text-sm text-muted">
            Generated {formatDubaiDateTime(new Date())} Dubai · {timeline.total} matching append-only events.
            This is a record of activity and provenance, not a legal conclusion.
          </p>
          {timeline.totalPages > 1 && (
            <p className="mt-2 text-xs font-semibold text-amber-700">This bounded print view contains the first 100 chronological events. Use filters or the existing evidence-pack export for a narrower case record.</p>
          )}
          <div className="mt-4 print:hidden"><LinkButton href={queryHref(params, {})}>Back to interactive evidence</LinkButton></div>
        </header>
      )}

      {!print && (
        <>
          <nav aria-label="Evidence categories" className="mb-4 flex flex-wrap gap-2">
            <Link
              href={queryHref(params, { category: undefined, type: undefined })}
              aria-current={!params.category && !params.type ? "page" : undefined}
              className={`rounded border px-2.5 py-1 text-[12.5px] font-medium ${!params.category && !params.type ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-white text-navy-700 hover:bg-ivory-100"}`}
            >
              All records
            </Link>
            {EVIDENCE_CATEGORIES.map((category) => {
              const active = params.category === category.value && !params.type;
              return (
                <Link
                  key={category.value}
                  href={queryHref(params, { category: category.value, type: undefined })}
                  aria-current={active ? "page" : undefined}
                  className={`rounded border px-2.5 py-1 text-[12.5px] font-medium ${active ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-white text-navy-700 hover:bg-ivory-100"}`}
                >
                  {category.label}
                </Link>
              );
            })}
          </nav>

          <details open={activeFilters > 0} className="mb-6 rounded border border-line bg-white">
            <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-navy-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-500 [&::-webkit-details-marker]:hidden">
              Filters{activeFilters > 0 ? ` · ${activeFilters} active` : ""} <span aria-hidden className="ml-1 text-muted">⌄</span>
            </summary>
            <form method="get" className="grid gap-4 border-t border-line p-5 sm:grid-cols-2 lg:grid-cols-4">
              {params.category && <input type="hidden" name="category" value={params.category} />}
              <Filter label="Search event titles">
                <input name="q" defaultValue={params.q} className={inputClass} placeholder="e.g. notice served" />
              </Filter>
              <Filter label="Event type">
                <select name="type" defaultValue={params.type ?? ""} className={inputClass}>
                  <option value="">All event types</option>
                  {APPROVED_EVIDENCE_TYPES.map((type) => <option key={type} value={type}>{titleForEvidenceType(type)}</option>)}
                </select>
              </Filter>
              <Filter label="Actor layer">
                <select name="actor" defaultValue={params.actor ?? ""} className={inputClass}>
                  <option value="">All actor layers</option>
                  {options.actorTypes.map((actor) => <option key={actor} value={actor}>{actor.toLowerCase().replace(/_/g, " ")}</option>)}
                </select>
              </Filter>
              <Filter label="Client">
                <select name="client" defaultValue={params.client ?? ""} className={inputClass}>
                  <option value="">All clients</option>
                  {options.clients.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </Filter>
              <Filter label="From (Dubai date)"><input type="date" name="from" defaultValue={params.from} className={inputClass} /></Filter>
              <Filter label="To (Dubai date)"><input type="date" name="to" defaultValue={params.to} className={inputClass} /></Filter>
              <Filter label="Property">
                <select name="property" defaultValue={params.property ?? ""} className={inputClass}>
                  <option value="">All properties</option>
                  {options.properties.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </Filter>
              <Filter label="Tenancy">
                <select name="tenancy" defaultValue={params.tenancy ?? ""} className={inputClass}>
                  <option value="">All tenancies</option>
                  {options.tenancies.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </Filter>
              <Filter label="Renewal case">
                <select name="renewal" defaultValue={params.renewal ?? ""} className={inputClass}>
                  <option value="">All renewal cases</option>
                  {options.renewals.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </Filter>
              <Filter label="Proof request">
                <select name="proof" defaultValue={params.proof ?? ""} className={inputClass}>
                  <option value="">All proof requests</option>
                  {options.proofs.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </Filter>
              <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
                <button className="rounded bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110">Apply filters</button>
                {activeFilters > 0 && <LinkButton href="/evidence">Reset</LinkButton>}
              </div>
            </form>
          </details>
        </>
      )}

      {!print && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>{timeline.total.toLocaleString("en-AE")} matching events · newest first</span>
          <span>Dubai-local time · UTC retained in Technical details</span>
        </div>
      )}

      {timeline.events.length === 0 ? (
        <EmptyState
          title={activeFilters > 0 ? "No evidence matches these filters" : "No evidence yet"}
          message={activeFilters > 0 ? "The ledger is unchanged. Reset the filters to return to the full scoped record." : "Evidence receipts appear here as trusted actions are recorded."}
          action={activeFilters > 0 ? <LinkButton href="/evidence">Reset filters</LinkButton> : undefined}
        />
      ) : (
        <ol className="space-y-4">
          {timeline.events.map((event) => <li key={event.id}><EvidenceEventCard event={event} print={print} /></li>)}
        </ol>
      )}

      {!print && (
        <Pagination page={timeline.page} totalPages={timeline.totalPages} basePath="/evidence" searchParams={paginationParams} />
      )}
    </div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-xs font-semibold text-navy-700">{label}<span className="mt-1 block font-normal">{children}</span></label>;
}
