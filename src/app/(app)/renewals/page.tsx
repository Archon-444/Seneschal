import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { listRenewalPipeline, listBenchmarks } from "@/server/services/renewals";
import { roleHas } from "@/server/capabilities";
import { formatDubaiDate } from "@/server/calculators/dates";
import { Badge, Button, Card, EmptyState, Field, inputClass, KpiCard, Money, PageHeader, Table, Td } from "@/components/ui";
import { captureBenchmarkAction } from "../actions";

// Renewal pipeline (Renewal Risk Desk). Every unit approaching renewal, with its
// notice gate, index-based position and where the decision stands. Figures are
// estimates anchored to the captured index — review before action.

export default async function RenewalsPage() {
  const ctx = await requireCtx();
  const [rows, benchmarks] = await Promise.all([
    listRenewalPipeline(ctx, { withinDays: 120 }),
    listBenchmarks(ctx),
  ]);
  const canWrite = roleHas(ctx.role, "renewals.write");

  const gatesClosing = rows.filter((r) => !r.gatePassed && r.daysToGate <= 30).length;
  const upliftInPipeline = rows.reduce((sum, r) => sum + (r.valueAtRisk ?? 0), 0);
  const openCases = rows.filter((r) => r.stage !== null).length;

  return (
    <>
      <PageHeader
        title="Renewals"
        subtitle="Units approaching renewal — notice gates, estimated uplift, and where each decision stands."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Renewals · next 120 days" value={rows.length} />
        <KpiCard label="Gates closing ≤30 days" value={gatesClosing} variant="risk" />
        <KpiCard label="Est. permissible uplift" value={<Money amount={upliftInPipeline} />} tone="good" />
        <KpiCard label="Open renewal cases" value={openCases} />
      </div>

      {rows.length === 0 ? (
        <EmptyState message="No tenancies are within 120 days of renewal." />
      ) : (
        <Table headers={["Unit · owner", "Notice gate", "Renewal", "Index position", "Est. uplift / yr", "Stage"]}>
          {rows.map((r) => (
            <tr key={r.tenancyId}>
              <Td>
                <Link href={`/renewals/${r.tenancyId}`} className="font-medium text-navy-900 hover:underline">
                  {r.unit || "Unit"}
                </Link>
                {r.ownerName && <div className="text-xs text-muted">{r.ownerName}</div>}
              </Td>
              <Td className="whitespace-nowrap">
                <span className="figure">{formatDubaiDate(r.noticeGateAt)}</span>
                {r.gatePassed ? (
                  <span className="ml-2 rounded bg-claret-100 px-1.5 py-0.5 text-[10px] font-bold text-claret-700">
                    gate passed
                  </span>
                ) : (
                  <span className={`ml-2 text-xs ${r.daysToGate <= 30 ? "text-claret-700" : "text-muted"}`}>
                    {r.daysToGate}d
                  </span>
                )}
              </Td>
              <Td className="figure whitespace-nowrap">{formatDubaiDate(r.renewalDate)}</Td>
              <Td>
                {r.gapPct != null ? (
                  <>
                    {Math.round(r.gapPct * 100)}% below
                    {r.isBenchmark && <span className="text-muted"> (benchmark)</span>}
                  </>
                ) : (
                  <span className="text-muted">no index yet</span>
                )}
              </Td>
              <Td>{r.valueAtRisk != null ? <Money amount={r.valueAtRisk} /> : "—"}</Td>
              <Td>{r.stage ? <Badge value={r.stage} /> : <span className="text-xs text-muted">{r.gatePassed ? "lapsed" : "not started"}</span>}</Td>
            </tr>
          ))}
        </Table>
      )}

      {canWrite && (
        <Card className="mt-8">
          <h2 className="font-display mb-1 text-lg text-navy-900">Community benchmarks</h2>
          <p className="mb-3 text-xs text-muted">
            A captured index figure reused across units in a community (or a specific building) when a
            tenancy has no figure of its own. Building-specific is preferred over community-wide.
          </p>
          <form action={captureBenchmarkAction} className="flex flex-wrap items-end gap-3">
            <Field label="Community">
              <input name="community" required className={inputClass} placeholder="Dubai Marina" />
            </Field>
            <Field label="Building (optional)">
              <input name="building" className={inputClass} placeholder="Marina Heights" />
            </Field>
            <Field label="Index average market rent (AED/yr)">
              <input name="marketRentAvg" type="number" min="1" step="1" required className={inputClass} placeholder="e.g. 96000" />
            </Field>
            <Button type="submit">Save benchmark</Button>
          </form>
          {benchmarks.length > 0 && (
            <div className="mt-4">
              <Table headers={["Community", "Building", "Index avg", "Captured"]}>
                {benchmarks.map((b) => (
                  <tr key={b.id}>
                    <Td>{b.community}</Td>
                    <Td>{b.building ?? <span className="text-muted">community-wide</span>}</Td>
                    <Td><Money amount={String(b.marketRentAvg)} /></Td>
                    <Td className="figure whitespace-nowrap">{formatDubaiDate(b.capturedAt)}</Td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Card>
      )}

      <Card className="mt-6 border-gold-300 bg-gold-100/40">
        <p className="text-xs text-muted">
          Index-based position, estimated from a manually-captured DLD Smart Rental Index figure under
          Decree No. (43) of 2013. Seneschal is not a broker or legal adviser — review official
          sources before serving a notice or agreeing terms.
        </p>
      </Card>
    </>
  );
}
