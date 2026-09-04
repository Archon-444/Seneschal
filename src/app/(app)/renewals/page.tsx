import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { hasCapability } from "@/server/authz";
import {
  listBenchmarks,
  listRenewalPipeline,
  type RenewalPipelineSort,
  type RenewalPipelineView,
} from "@/server/services/renewals";
import {
  Badge,
  Card,
  DubaiDate,
  EmptyState,
  Field,
  Footnote,
  inputClass,
  LinkButton,
  Money,
  PageHeader,
  Segmented,
  Stat,
  StatStrip,
  Table,
  Td,
} from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { captureBenchmarkAction } from "../actions";

const VIEWS: { value: RenewalPipelineView; label: string }[] = [
  { value: "all", label: "All" },
  { value: "urgent", label: "Urgent" },
  { value: "missing-index", label: "Missing source" },
  { value: "awaiting-evidence", label: "Awaiting evidence" },
  { value: "awaiting-tenant", label: "Awaiting tenant" },
  { value: "ready-to-complete", label: "Ready to complete" },
  { value: "completed", label: "Completed" },
];

const SORTS: { value: RenewalPipelineSort; label: string }[] = [
  { value: "notice-gate", label: "Notice gate" },
  { value: "urgency", label: "Urgency" },
  { value: "renewal-date", label: "Renewal date" },
  { value: "uplift", label: "Estimated uplift" },
  { value: "property", label: "Property" },
];

function renewalHref(view: RenewalPipelineView, sort: RenewalPipelineSort) {
  const params = new URLSearchParams();
  if (view !== "all") params.set("view", view);
  if (sort !== "notice-gate") params.set("sort", sort);
  const query = params.toString();
  return `/renewals${query ? `?${query}` : ""}`;
}

export default async function RenewalsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; sort?: string }>;
}) {
  const ctx = await requireCtx();
  const params = await searchParams;
  const canWrite = hasCapability(ctx, "renewals.write");
  const benchmarksView = params.view === "benchmarks" && canWrite;
  const view = VIEWS.some((item) => item.value === params.view)
    ? (params.view as RenewalPipelineView)
    : "all";
  const sort = SORTS.some((item) => item.value === params.sort)
    ? (params.sort as RenewalPipelineSort)
    : "notice-gate";

  if (benchmarksView) {
    const benchmarks = await listBenchmarks(ctx);
    return (
      <>
        <PageHeader
          eyebrow="Renewal sources"
          title="Community benchmarks"
          subtitle="Fallback index figures used only when a tenancy-specific source has not been captured."
          actions={<LinkButton href="/renewals">Back to renewals</LinkButton>}
        />
        <Card>
          <p className="mb-3 text-[13px] text-muted">
            Building-specific figures take precedence over community-wide figures. Record the official source and
            review it before relying on an estimated position.
          </p>
          <form action={captureBenchmarkAction} className="flex flex-wrap items-end gap-3">
            <Field label="Community" required>
              <input name="community" required className={inputClass} placeholder="Dubai Marina" />
            </Field>
            <Field label="Building (optional)">
              <input name="building" className={inputClass} placeholder="Marina Heights" />
            </Field>
            <Field label="Index average market rent (AED/yr)" required>
              <input
                name="marketRentAvg"
                type="number"
                min="1"
                step="1"
                required
                className={inputClass}
                placeholder="e.g. 96000"
              />
            </Field>
            <SubmitButton pendingLabel="Saving…">Save benchmark</SubmitButton>
          </form>
        </Card>
        <div className="mt-6">
          {benchmarks.length === 0 ? (
            <EmptyState title="No benchmarks captured" message="Add a reviewed community or building figure above." />
          ) : (
            <Table stack headers={["Community", "Building", "Index avg", "Captured"]}>
              {benchmarks.map((benchmark) => (
                <tr key={benchmark.id}>
                  <Td label="Community">{benchmark.community}</Td>
                  <Td label="Building">{benchmark.building ?? <span className="text-muted">community-wide</span>}</Td>
                  <Td label="Index avg"><Money amount={String(benchmark.marketRentAvg)} /></Td>
                  <Td label="Captured" className="whitespace-nowrap"><DubaiDate value={benchmark.capturedAt} /></Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      </>
    );
  }

  const rows = await listRenewalPipeline(ctx, { withinDays: 120, view, sort });
  const gatesClosing = rows.filter((row) => !row.gatePassed && row.daysToGate <= 30).length;
  const upliftInPipeline = rows.reduce((sum, row) => sum + (row.valueAtRisk ?? 0), 0);
  const openCases = rows.filter(
    (row) => row.stage !== null && !["RENEWED", "DECLINED", "LAPSED"].includes(row.stage),
  ).length;

  return (
    <>
      <PageHeader
        title="Renewals"
        subtitle={`${rows.length} in this view · ${gatesClosing} gate${gatesClosing === 1 ? "" : "s"} closing within 30 days`}
        actions={canWrite ? <LinkButton href="/renewals?view=benchmarks">Community benchmarks</LinkButton> : undefined}
      />

      <StatStrip className="mb-4">
        <Stat label="Renewals in this view" value={rows.length} />
        <Stat label="Gates closing ≤ 30 days" value={gatesClosing} tone={gatesClosing > 0 ? "danger" : "default"} />
        <Stat label="Est. permissible uplift" value={<Money amount={upliftInPipeline} />} sub="estimate only" />
        <Stat label="Open renewal cases" value={openCases} />
      </StatStrip>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          ariaLabel="Renewal views"
          items={VIEWS.map((item) => ({ href: renewalHref(item.value, sort), label: item.label, active: item.value === view }))}
        />
        <form method="get" className="flex items-center gap-2">
          {view !== "all" && <input type="hidden" name="view" value={view} />}
          <label className="flex items-center gap-2 text-[12.5px] text-navy-700">
            Sort
            <select name="sort" defaultValue={sort} className={`${inputClass} h-7 w-auto py-0 pr-7`}>
              {SORTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <button className="h-7 rounded border border-line bg-white px-2.5 text-[12.5px] font-medium text-navy-900 hover:bg-ivory-100">
            Apply
          </button>
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={view === "all" ? "Nothing due" : "No renewals in this view"}
          message={view === "all" ? "No tenancies are within 120 days of renewal." : "Try another operational view or return to the full queue."}
          action={view === "all" ? undefined : <LinkButton href="/renewals">Reset view</LinkButton>}
        />
      ) : (
        <Table
          stack
          headers={["Unit", "Owner", "Next action", "Urgency", "Notice gate", "Days", "Renewal", "Index position", "Est. uplift / yr"]}
        >
          {rows.map((row) => (
            <tr key={row.tenancyId}>
              <Td label="Unit" className="whitespace-nowrap">
                <Link href={`/renewals/${row.tenancyId}`} className="font-medium text-navy-900 hover:underline">
                  {row.unit || "Unit"}
                </Link>
              </Td>
              <Td label="Owner" className="whitespace-nowrap text-navy-700">{row.ownerName ?? "—"}</Td>
              <Td label="Next action" className="whitespace-nowrap">
                <Link href={row.nextAction.href} title={row.nextAction.reason} className="text-navy-900 hover:underline">
                  {row.nextAction.label}
                </Link>
              </Td>
              <Td label="Urgency">{row.nextAction.urgency !== "NONE" ? <Badge value={row.nextAction.urgency} /> : <span className="text-muted">—</span>}</Td>
              <Td label="Notice gate" className="whitespace-nowrap"><DubaiDate value={row.noticeGateAt} /></Td>
              <Td label="Days" className="text-right">
                {row.gatePassed ? (
                  <span className="figure text-claret-500" title="Notice gate passed">−{Math.abs(row.daysToGate)}</span>
                ) : (
                  <span className={`figure ${row.daysToGate <= 30 ? "text-navy-900" : "text-muted"}`}>{row.daysToGate}</span>
                )}
              </Td>
              <Td label="Renewal" className="whitespace-nowrap"><DubaiDate value={row.renewalDate} /></Td>
              <Td label="Index position" className="whitespace-nowrap">
                {row.gapPct != null ? (
                  <>{Math.round(row.gapPct * 100)}% below{row.isBenchmark && <span className="text-muted"> (benchmark)</span>}</>
                ) : (
                  <span className="text-muted">no source yet</span>
                )}
              </Td>
              <Td label="Est. uplift / yr" className="whitespace-nowrap text-right">{row.valueAtRisk != null ? <Money amount={row.valueAtRisk} /> : <span className="text-muted">—</span>}</Td>
            </tr>
          ))}
        </Table>
      )}

      <Footnote>
        Index-based position is an estimate from a recorded DLD Smart Rental Index figure under Decree No. (43) of
        2013. Seneschal is not a broker or legal adviser. Review official sources before serving a notice or agreeing terms.
      </Footnote>
    </>
  );
}
