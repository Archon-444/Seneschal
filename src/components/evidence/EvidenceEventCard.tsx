import Link from "next/link";
import { formatDubaiDateTime } from "@/server/calculators/dates";
import { RecordedStamp } from "@/components/ui";
import type { PresentedEvidenceEvent } from "@/server/services/evidencePresenter";

export function EvidenceEventCard({ event, print = false }: { event: PresentedEvidenceEvent; print?: boolean }) {
  return (
    <article id={`event-${event.id}`} className="scroll-mt-28 rounded-sm border border-line bg-white p-5 print:break-inside-avoid">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg text-navy-900">{event.title}</h2>
          <p className="mt-1 text-sm text-navy-700">{event.summary}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <RecordedStamp />
          <time dateTime={event.occurredAt.toISOString()} className="figure whitespace-nowrap text-xs font-semibold text-navy-500">
            {formatDubaiDateTime(event.occurredAt)} <span className="font-sans font-normal text-muted">Dubai</span>
          </time>
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="font-bold uppercase tracking-wide text-muted">Actor</dt>
          <dd className="mt-0.5 text-navy-700">{event.actorLabel}</dd>
        </div>
        {event.onBehalfOfLabel && (
          <div>
            <dt className="font-bold uppercase tracking-wide text-muted">On behalf of</dt>
            <dd className="mt-0.5 text-navy-700">{event.onBehalfOfLabel}</dd>
          </div>
        )}
        <div>
          <dt className="font-bold uppercase tracking-wide text-muted">Scope</dt>
          <dd className="mt-0.5">
            {event.scopeHref ? <Link href={event.scopeHref} className="font-semibold text-navy-500 hover:underline">{event.scopeLabel}</Link> : <span className="text-navy-700">{event.scopeLabel}</span>}
          </dd>
        </div>
      </dl>

      {(event.relatedLinks.length > 0 || event.provenance.length > 0) && (
        <div className="mt-4 grid gap-3 border-t border-line pt-3 text-xs lg:grid-cols-2">
          {event.relatedLinks.length > 0 && (
            <div>
              <div className="font-bold uppercase tracking-wide text-muted">Related records</div>
              <ul className="mt-1 space-y-1">
                {event.relatedLinks.map((item, index) => (
                  <li key={`${item.label}-${index}`} className="text-navy-700">
                    {item.detail && <span className="text-muted">{item.detail}: </span>}
                    {item.href ? <Link href={item.href} className="font-semibold text-navy-500 hover:underline">{item.label}</Link> : item.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {event.provenance.length > 0 && (
            <div>
              <div className="font-bold uppercase tracking-wide text-muted">Provenance</div>
              <ul className="mt-1 space-y-1 text-navy-700">
                {event.provenance.map((item) => <li key={item} className="break-words">{item}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {event.correctionState.map((correction) => (
        <div key={`${correction.kind}-${correction.eventIds.join("-")}`} className="mt-3 rounded-sm border border-amber-500/40 bg-amber-100/40 p-3 text-xs text-amber-700">
          <div className="font-semibold">{correction.label}</div>
          <div className="mt-1 flex flex-wrap gap-3">
            {correction.eventIds.map((id) => <Link key={id} href={`/evidence?event=${encodeURIComponent(id)}#event-${id}`} className="hover:underline">Event {id.slice(0, 8)}…</Link>)}
          </div>
        </div>
      ))}

      {!print && (
        <details className="mt-4 rounded-sm border border-line bg-ivory-100/60 print:hidden">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold text-navy-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-verde-500 [&::-webkit-details-marker]:hidden">
            Technical details <span aria-hidden className="ml-1 text-muted">⌄</span>
          </summary>
          <pre className="max-w-full whitespace-pre-wrap break-all border-t border-line p-3 text-[11px] leading-relaxed text-navy-700">
            {JSON.stringify(event.technicalDetails, null, 2)}
          </pre>
        </details>
      )}
    </article>
  );
}
