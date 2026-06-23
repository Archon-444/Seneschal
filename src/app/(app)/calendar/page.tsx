import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { listDeadlines, deadlineLabel, isManualDeadline } from "@/server/services/deadlines";
import { listProperties } from "@/server/services/properties";
import { isoDate, todayInDubai } from "@/server/calculators/dates";
import {
  Badge,
  DubaiDate,
  EmptyState,
  Field,
  FormSection,
  inputClass,
  PageHeader,
  Table,
  Td,
} from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { addCalendarEntryAction, completeDeadlineAction } from "../actions";

// Screen 9 — month view + upcoming/overdue list, Dubai-local display (T3.3).
// Entries come from tenancies (notice gate, expiry, renewal, cheques — incl.
// those from a scanned/onboarded Ejari) and from manual entries added here.

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; kind?: string }>;
}) {
  const { month, kind } = await searchParams;
  const ctx = await requireCtx();
  const today = todayInDubai();
  const [year, mon] = month
    ? month.split("-").map(Number)
    : [today.getUTCFullYear(), today.getUTCMonth() + 1];
  const monthStart = new Date(Date.UTC(year, mon - 1, 1));
  const monthEnd = new Date(Date.UTC(year, mon, 0));

  const [all, properties] = await Promise.all([
    listDeadlines(ctx, kind ? { kind: kind as never } : undefined),
    listProperties(ctx),
  ]);
  const inMonth = all.filter((d) => d.dueAt >= monthStart && d.dueAt <= monthEnd);
  const overdue = all.filter((d) => d.dueAt < today);
  const upcoming = all.filter((d) => d.dueAt >= today).slice(0, 15);

  const propertyCell = (d: (typeof all)[number]) => {
    const pid = d.propertyId ?? d.tenancy?.propertyId;
    const label = d.tenancy?.property
      ? `${d.tenancy.property.community} · ${d.tenancy.property.unitNo ?? ""}`
      : "—";
    return pid ? (
      <Link href={`/properties/${pid}`} className="hover:underline">
        {label}
      </Link>
    ) : (
      <span className="text-muted">{label}</span>
    );
  };

  // Notice-gate entries deep-link to the renewal report; other entries stay plain.
  const entryCell = (d: (typeof all)[number]) => {
    const badge = <Badge value={deadlineLabel(d)} />;
    return d.kind === "NOTICE_GATE" && d.tenancyId ? (
      <Link href={`/renewals/${d.tenancyId}`}>{badge}</Link>
    ) : (
      badge
    );
  };

  const byDay = new Map<string, typeof all>();
  for (const d of inMonth) {
    const key = isoDate(d.dueAt);
    byDay.set(key, [...(byDay.get(key) ?? []), d]);
  }

  const firstWeekday = (monthStart.getUTCDay() + 6) % 7; // Monday-first
  const daysInMonth = monthEnd.getUTCDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const prev = mon === 1 ? `${year - 1}-12` : `${year}-${String(mon - 1).padStart(2, "0")}`;
  const next = mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, "0")}`;
  const monthLabel = monthStart.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const isManual = (d: (typeof all)[number]) => isManualDeadline(d);
  const navLink = "focus-ring rounded-md border border-line bg-white px-2.5 py-1 text-navy-500 hover:bg-ivory-100 hover:text-navy-900";

  return (
    <>
      <PageHeader title="Calendar" subtitle="All dates shown in Dubai local convention" />

      <FormSection title="Add a calendar entry" className="mb-6">
        <form action={addCalendarEntryAction} className="flex flex-wrap items-end gap-3">
          <Field label="Title" required>
            <input name="title" required className={inputClass} placeholder="e.g. Service charge due" />
          </Field>
          <Field label="Date" required>
            <input name="dueAt" type="date" required className={inputClass} />
          </Field>
          <Field label="Kind">
            <select name="kind" className={inputClass}>
              <option value="CUSTOM">Custom</option>
              <option value="SERVICE_CHARGE_DUE">Service charge due</option>
              <option value="INSURANCE_EXPIRY">Insurance expiry</option>
              <option value="DOCUMENT_EXPIRY">Document expiry</option>
              <option value="EJARI_RENEWAL">Ejari renewal</option>
              <option value="APPROVAL_DUE">Approval due</option>
            </select>
          </Field>
          <Field label="Property (optional)">
            <select name="propertyId" className={inputClass}>
              <option value="">—</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.community}
                  {p.unitNo ? ` · ${p.unitNo}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <SubmitButton pendingLabel="Adding…">Add entry</SubmitButton>
        </form>
      </FormSection>

      <div className="mb-4 flex items-center gap-3">
        <Link href={`/calendar?month=${prev}`} aria-label="Previous month" className={navLink}>
          ←
        </Link>
        <span className="font-display text-xl text-navy-900">{monthLabel}</span>
        <Link href={`/calendar?month=${next}`} aria-label="Next month" className={navLink}>
          →
        </Link>
        <Link href="/calendar" className="ml-1 text-xs text-muted hover:text-navy-900">
          Today
        </Link>
      </div>

      <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-ivory-300 bg-white text-sm shadow-sm">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div
            key={d}
            className="border-b border-ivory-200 bg-ivory-100 px-2 py-1.5 text-xs font-semibold uppercase text-navy-500"
          >
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          const key = day
            ? `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`
            : "";
          const items = day ? (byDay.get(key) ?? []) : [];
          const shown = items.slice(0, 3);
          const extra = items.length - shown.length;
          const isToday = key === isoDate(today);
          return (
            <div
              key={i}
              className={`min-h-20 border-b border-r border-ivory-200 p-1.5 ${isToday ? "bg-gold-100/50 ring-1 ring-inset ring-gold-500/40" : ""}`}
            >
              {day && (
                <>
                  <span
                    className={`figure inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs ${isToday ? "bg-gold-500 font-bold text-navy-900" : "text-navy-300"}`}
                  >
                    {day}
                  </span>
                  {shown.map((d) => (
                    <div
                      key={d.id}
                      className={`mt-1 truncate rounded px-1 py-0.5 text-[10px] ${isManual(d) ? "bg-gold-100 text-gold-700" : "bg-navy-50 text-navy-700"}`}
                      title={deadlineLabel(d)}
                    >
                      {deadlineLabel(d)}
                    </div>
                  ))}
                  {extra > 0 && (
                    <div className="mt-1 text-[10px] font-semibold text-muted">+{extra} more</div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="font-display mb-3 text-xl text-claret-700">Overdue</h2>
          {overdue.length === 0 ? (
            <EmptyState message="Nothing overdue." />
          ) : (
            <Table stack headers={["Due", "Entry", "Property", ""]}>
              {overdue.map((d) => (
                <tr key={d.id} className="bg-claret-100/40">
                  <Td label="Due" className="whitespace-nowrap font-semibold text-claret-700">
                    <DubaiDate value={d.dueAt} />
                  </Td>
                  <Td label="Entry">{entryCell(d)}</Td>
                  <Td label="Property">{propertyCell(d)}</Td>
                  <Td>{isManual(d) ? <DoneButton id={d.id} /> : null}</Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
        <div>
          <h2 className="font-display mb-3 text-xl text-navy-900">Upcoming</h2>
          {upcoming.length === 0 ? (
            <EmptyState message="No upcoming deadlines." />
          ) : (
            <Table stack headers={["Due", "Entry", "Property", ""]}>
              {upcoming.map((d) => (
                <tr key={d.id}>
                  <Td label="Due" className="whitespace-nowrap">
                    <DubaiDate value={d.dueAt} />
                  </Td>
                  <Td label="Entry">{entryCell(d)}</Td>
                  <Td label="Property">{propertyCell(d)}</Td>
                  <Td>{isManual(d) ? <DoneButton id={d.id} /> : null}</Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      </div>
    </>
  );
}

function DoneButton({ id }: { id: string }) {
  return (
    <form action={completeDeadlineAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value="DONE" />
      <button className="text-xs text-navy-500 underline-offset-2 hover:text-verde-700 hover:underline">
        Mark done
      </button>
    </form>
  );
}
