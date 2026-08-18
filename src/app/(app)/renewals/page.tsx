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
  inputClass,
  KpiCard,
  LinkButton,
  Money,
  PageHeader,
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
          <p className="mb-4 text-sm text-muted">
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
        subtitle="A task-led queue showing the next safe action, its reason, and the recorded notice gate."
        actions={canWrite ? <LinkButton href="/renewals?view=benchmarks">Community benchmarks</LinkButton> : undefined}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Renewals in this view" value={rows.length} />
        <KpiCard label="Gates closing ≤30 days" value={gatesClosing} variant="risk" />
        <KpiCard label="Est. permissible uplift" value={<Money amount={upliftInPipeline} />} tone="good" />
        <KpiCard label="Open renewal cases" value={openCases} />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Renewal views" className="flex flex-wrap gap-2">
          {VIEWS.map((item) => {
            const active = item.value === view;
            return (
              <Link
                key={item.value}
                href={renewalHref(item.value, sort)}
                aria-current={active ? "page" : undefined}
                className={`rounded-full border px-3 py-1.5 text-xs font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-500 ${
                  active
                    ? "border-navy-900 bg-navy-900 text-white"
                    : "border-line bg-white text-navy-700 hover:border-gold-500"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <form method="get" className="flex items-end gap-2">
          {view !== "all" && <input type="hidden" name="view" value={view} />}
          <label className="text-xs font-semibold text-navy-700">
            Sort
            <select name="sort" defaultValue={sort} className={`${inputClass} ml-2 w-auto py-1.5`}>
              {SORTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <button className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold text-navy-700 hover:bg-ivory-100">
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
        <Table stack headers={["Unit · owner", "Next action", "Notice gate", "Renewal", "Index position", "Est. uplift / yr"]}>
          {rows.map((row) => (
            <tr key={row.tenancyId}>
              <Td label="Unit · owner">
                <Link href={`/renewals/${row.tenancyId}`} className="font-medium text-navy-900 hover:underline">
                  {row.unit || "Unit"}
                </Link>
                {row.ownerName && <div className="text-xs text-muted">{row.ownerName}</div>}
              </Td>
              <Td label="Next action">
                <Link href={row.nextAction.href} className="font-semibold text-navy-900 hover:underline">
                  {row.nextAction.label}
                </Link>
                <div className="mt-0.5 max-w-xs text-xs text-muted">{row.nextAction.reason}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {row.nextAction.urgency !== "NONE" && <Badge value={row.nextAction.urgency} />}
                  {row.stage && <span className="text-[11px] text-muted">Stage: {row.stage.replace(/_/g, " ").toLowerCase()}</span>}
                </div>
              </Td>
              <Td label="Notice gate" className="whitespace-nowrap">
                <DubaiDate value={row.noticeGateAt} />
                {row.gatePassed ? (
                  <span className="ml-2 rounded bg-claret-100 px-1.5 py-0.5 text-[10px] font-bold text-claret-700">gate passed</span>
                ) : (
                  <span className={`ml-2 text-xs ${row.daysToGate <= 30 ? "text-claret-700" : "text-muted"}`}>{row.daysToGate}d</span>
                )}
              </Td>
              <Td label="Renewal" className="whitespace-nowrap"><DubaiDate value={row.renewalDate} /></Td>
              <Td label="Index position">
                {row.gapPct != null ? (
                  <>{Math.round(row.gapPct * 100)}% below{row.isBenchmark && <span className="text-muted"> (benchmark)</span>}</>
                ) : (
                  <span className="text-muted">no source yet</span>
                )}
              </Td>
              <Td label="Est. uplift / yr">{row.valueAtRisk != null ? <Money amount={row.valueAtRisk} /> : "—"}</Td>
            </tr>
          ))}
        </Table>
      )}

      <Card className="mt-6 border-gold-300 bg-gold-100/40">
        <p className="text-xs text-muted">
          Index-based position is an estimate from a recorded DLD Smart Rental Index figure under Decree No. (43) of
          2013. Seneschal is not a broker or legal adviser — review official sources before serving a notice or agreeing terms.
        </p>
      </Card>
    </>
  );
}
