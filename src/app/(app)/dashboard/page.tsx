import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { dashboardKpis } from "@/server/services/dashboard";
import { listDeadlines } from "@/server/services/deadlines";
import { listRiskFlags } from "@/server/services/risk";
import { formatDubaiDate, todayInDubai } from "@/server/calculators/dates";
import { Badge, Card, EmptyState, KpiCard, PageHeader, Reminder, Table, Td } from "@/components/ui";

export default async function DashboardPage() {
  const ctx = await requireCtx();
  const [kpis, deadlines, flags] = await Promise.all([
    dashboardKpis(ctx),
    listDeadlines(ctx),
    listRiskFlags(ctx),
  ]);
  const today = todayInDubai();
  const upcoming = deadlines.filter((d) => d.dueAt >= today).slice(0, 8);

  return (
    <>
      <PageHeader
        eyebrow="Workspace overview"
        title="Dashboard"
        subtitle="Know what is due. Know who owns it. Keep the proof."
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Properties" value={kpis.properties} />
        <KpiCard label="Active tenancies" value={kpis.tenancies} />
        <KpiCard label="Deadlines · 30 days" value={kpis.upcomingDeadlines} tone={kpis.upcomingDeadlines > 0 ? "warn" : "default"} />
        <KpiCard
          label="Overdue deadlines"
          value={kpis.overdueDeadlines}
          variant={kpis.overdueDeadlines > 0 ? "risk" : "default"}
          tone={kpis.overdueDeadlines > 0 ? "danger" : "good"}
        />
        <KpiCard label="Open risk flags" value={kpis.openFlags} tone={kpis.openFlags > 0 ? "warn" : "good"} />
        <KpiCard label="Open proof requests" value={kpis.openProofs} />
        <KpiCard label="Late / bounced cheques" value={kpis.latePayments} tone={kpis.latePayments > 0 ? "danger" : "good"} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="font-display mb-3 text-xl text-navy-900">Upcoming deadlines</h2>
          {upcoming.length === 0 ? (
            <EmptyState message="No upcoming deadlines. The calendar is clear." />
          ) : (
            <Card>
              {upcoming.map((d) => (
                <Reminder
                  key={d.id}
                  date={formatDubaiDate(d.dueAt).toUpperCase()}
                  hot={d.kind === "NOTICE_GATE"}
                  title={d.kind.replace(/_/g, " ")}
                  sub={
                    d.tenancy?.property
                      ? `${d.tenancy.property.community} · ${d.tenancy.property.unitNo ?? ""}`
                      : undefined
                  }
                />
              ))}
            </Card>
          )}
        </div>
        <div>
          <h2 className="font-display mb-3 text-xl text-navy-900">Open risk flags</h2>
          {flags.length === 0 ? (
            <EmptyState message="No open risk flags." />
          ) : (
            <Table headers={["Raised", "Code", "Severity"]}>
              {flags.slice(0, 8).map((f) => (
                <tr key={f.id}>
                  <Td className="figure whitespace-nowrap">{formatDubaiDate(f.raisedAt)}</Td>
                  <Td><Badge value={f.code} /></Td>
                  <Td><Badge value={f.severity} /></Td>
                </tr>
              ))}
            </Table>
          )}
          <div className="mt-2 text-right">
            <Link href="/risk" className="text-sm text-navy-500 hover:text-navy-900">All flags →</Link>
          </div>
        </div>
      </div>

      <Card className="mt-8 bg-ivory-100 text-xs text-navy-500">
        Seneschal keeps records and evidence. It does not hold funds, execute brokerage, or provide
        legal advice. Calculations are rule-based — review before action.
      </Card>
    </>
  );
}
