import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { dashboardKpis } from "@/server/services/dashboard";
import { listDeadlines } from "@/server/services/deadlines";
import { listRiskFlags } from "@/server/services/risk";
import { listRenewalPipeline } from "@/server/services/renewals";
import { formatDubaiDate, todayInDubai } from "@/server/calculators/dates";
import { Badge, Card, EmptyState, Eyebrow, KpiCard, Money, PageHeader, resolveScopeLink, Table, Td } from "@/components/ui";

export default async function DashboardPage() {
  const ctx = await requireCtx();
  const [kpis, deadlines, flags, pipeline] = await Promise.all([
    dashboardKpis(ctx),
    listDeadlines(ctx),
    listRiskFlags(ctx),
    listRenewalPipeline(ctx),
  ]);
  const today = todayInDubai();
  const upliftAtRisk = pipeline.reduce((sum, r) => sum + (r.valueAtRisk ?? 0), 0);
  const upcoming = deadlines.filter((d) => d.dueAt >= today).slice(0, 8);

  return (
    <>
      <PageHeader
        eyebrow="Workspace overview"
        title="Dashboard"
        subtitle="Know what is due. Know who owns it. Keep the proof."
      />

      {/* Tier 1 — what costs money if it's ignored. Loud only when non-zero. */}
      <section className="mb-8">
        <Eyebrow>Needs attention</Eyebrow>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard
            label="Overdue deadlines"
            value={kpis.overdueDeadlines}
            variant={kpis.overdueDeadlines > 0 ? "risk" : "default"}
            tone={kpis.overdueDeadlines > 0 ? "danger" : "good"}
            sub={kpis.overdueDeadlines > 0 ? "past the gate" : "all clear"}
            href="/calendar"
          />
          <KpiCard
            label="Late / bounced cheques"
            value={kpis.latePayments}
            tone={kpis.latePayments > 0 ? "danger" : "good"}
            sub={kpis.latePayments > 0 ? "needs follow-up" : "all received"}
            href="/payments?status=problem"
          />
          <KpiCard
            label="Open risk flags"
            value={kpis.openFlags}
            tone={kpis.openFlags > 0 ? "warn" : "good"}
            sub={kpis.openFlags > 0 ? "to review" : "none open"}
            href="/risk"
          />
          <KpiCard
            label="Est. permissible uplift · 120 days"
            value={<Money amount={upliftAtRisk} />}
            tone="good"
            sub="captured-index renewals · estimate only"
            href="/renewals"
          />
        </div>
      </section>

      {/* Tier 2 — standing figures. Quiet by design. */}
      <section className="mb-8">
        <Eyebrow>Portfolio</Eyebrow>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label="Properties" value={kpis.properties} href="/properties" />
          <KpiCard label="Active tenancies" value={kpis.tenancies} href="/properties" />
          <KpiCard label="Deadlines · 30 days" value={kpis.upcomingDeadlines} tone={kpis.upcomingDeadlines > 0 ? "warn" : "default"} href="/calendar" />
          <KpiCard label="Open proof requests" value={kpis.openProofs} href="/proofs" />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="font-display mb-3 text-xl text-navy-900">Upcoming</h2>
          {upcoming.length === 0 ? (
            <EmptyState message="No upcoming deadlines. The calendar is clear." />
          ) : (
            <Card>
              <ol className="relative ml-1 space-y-4 border-l border-line pl-5">
                {upcoming.map((d) => {
                  const hot = d.kind === "NOTICE_GATE";
                  return (
                    <li key={d.id} className="relative">
                      <span
                        className={`absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white ${hot ? "bg-claret-500" : "bg-gold-500"}`}
                      />
                      <div className="figure text-[11px] uppercase tracking-wide text-navy-300">
                        {formatDubaiDate(d.dueAt)}
                      </div>
                      <div className="text-sm font-semibold text-navy-900">{d.kind.replace(/_/g, " ")}</div>
                      {d.tenancy?.property && (
                        <div className="text-xs text-muted">
                          {d.tenancy.property.community}
                          {d.tenancy.property.unitNo ? ` · ${d.tenancy.property.unitNo}` : ""}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </Card>
          )}
        </div>
        <div>
          <h2 className="font-display mb-3 text-xl text-navy-900">Open risk flags</h2>
          {flags.length === 0 ? (
            <EmptyState message="No open risk flags." />
          ) : (
            <Table headers={["Raised", "Code", "Severity"]}>
              {flags.slice(0, 8).map((f) => {
                const accent =
                  f.severity === "CRITICAL" ? "border-claret-500" : f.severity === "WARN" ? "border-amber-500" : "border-line";
                const href = resolveScopeLink(f.scopeType, f.scopeId);
                return (
                  <tr key={f.id}>
                    <Td className={`figure whitespace-nowrap border-l-2 ${accent}`}>{formatDubaiDate(f.raisedAt)}</Td>
                    <Td>{href ? <Link href={href}><Badge value={f.code} /></Link> : <Badge value={f.code} />}</Td>
                    <Td><Badge value={f.severity} /></Td>
                  </tr>
                );
              })}
            </Table>
          )}
          <div className="mt-2 text-right">
            <Link href="/risk" className="text-sm text-navy-500 hover:text-navy-900">All flags →</Link>
          </div>
        </div>
      </div>

      <Card className="mt-8 bg-ivory-100 text-xs text-navy-500">
        Seneschal keeps the record and the evidence — it doesn’t hold funds, broker deals, or give legal
        advice. Figures are rule-based; review before acting.
      </Card>
    </>
  );
}
