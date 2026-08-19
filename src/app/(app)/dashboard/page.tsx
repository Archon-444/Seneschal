import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { hasCapability } from "@/server/authz";
import { activationStatus, dashboardKpis } from "@/server/services/dashboard";
import { deadlineNextAction, listDeadlines } from "@/server/services/deadlines";
import { listRiskFlags } from "@/server/services/risk";
import { listRenewalPipeline } from "@/server/services/renewals";
import { formatDubaiDate, todayInDubai } from "@/server/calculators/dates";
import { Badge, Card, EmptyState, Eyebrow, KpiCard, Money, PageHeader, resolveScopeLink, Table, Td } from "@/components/ui";
import { GettingStarted } from "./GettingStarted";

export default async function DashboardPage() {
  const ctx = await requireCtx();
  const canOnboard = hasCapability(ctx, "clients.write");
  const canReadDeadlines = hasCapability(ctx, "deadlines.read");
  const canReadPayments = hasCapability(ctx, "payments.read");
  const canReadProofs = hasCapability(ctx, "proofs.read");
  const canReadRenewals = hasCapability(ctx, "renewals.read");
  const canReadRisk = hasCapability(ctx, "riskflags.read");
  const [kpis, deadlines, flags, pipeline, activation] = await Promise.all([
    dashboardKpis(ctx),
    canReadDeadlines ? listDeadlines(ctx) : Promise.resolve([]),
    canReadRisk ? listRiskFlags(ctx) : Promise.resolve([]),
    canReadRenewals ? listRenewalPipeline(ctx) : Promise.resolve([]),
    canOnboard ? activationStatus(ctx) : null,
  ]);
  const today = todayInDubai();
  const upliftAtRisk = pipeline.reduce((sum, r) => sum + (r.valueAtRisk ?? 0), 0);
  const upcoming = deadlines.filter((d) => d.dueAt >= today).slice(0, 8);
  const urgencyRank = { CRITICAL: 0, WARN: 1, NORMAL: 2, NONE: 3 } as const;
  const renewalActions = pipeline
    .filter((row) => row.nextAction.urgency !== "NONE")
    .sort(
      (a, b) =>
        urgencyRank[a.nextAction.urgency] - urgencyRank[b.nextAction.urgency] ||
        a.noticeGateAt.getTime() - b.noticeGateAt.getTime(),
    )
    .slice(0, 8);

  return (
    <>
      <PageHeader
        eyebrow="Workspace overview"
        title="Dashboard"
        subtitle="Know what is due. Know who owns it. Keep the proof."
      />

      {activation && (
        <GettingStarted
          hasClient={activation.hasClient}
          hasTenancy={activation.hasTenancy}
          hasTeam={activation.hasTeam}
          showTeamStep={hasCapability(ctx, "members.read")}
        />
      )}

      {/* Tier 1 — what costs money if it's ignored. Loud only when non-zero. */}
      <section className="mb-8">
        <Eyebrow>Needs attention</Eyebrow>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {canReadDeadlines && kpis.overdueDeadlines != null && <KpiCard
            label="Overdue deadlines" value={kpis.overdueDeadlines}
            variant={kpis.overdueDeadlines > 0 ? "risk" : "default"}
            tone={kpis.overdueDeadlines > 0 ? "danger" : "good"}
            sub={kpis.overdueDeadlines > 0 ? "past the gate" : "all clear"} href="/calendar"
          />}
          {canReadPayments && kpis.latePayments != null && <KpiCard
            label="Late / bounced cheques" value={kpis.latePayments}
            tone={kpis.latePayments > 0 ? "danger" : "good"}
            sub={kpis.latePayments > 0 ? "needs follow-up" : "all received"} href="/payments?status=problem"
          />}
          {canReadRisk && kpis.openFlags != null && <KpiCard
            label="Open risk flags" value={kpis.openFlags}
            tone={kpis.openFlags > 0 ? "warn" : "good"}
            sub={kpis.openFlags > 0 ? "to review" : "none open"} href="/risk"
          />}
          {canReadRenewals && <KpiCard
            label="Est. permissible uplift · 120 days" value={<Money amount={upliftAtRisk} />}
            tone="good" sub="captured-index renewals · estimate only" href="/renewals"
          />}
        </div>
      </section>

      {/* Tier 2 — standing figures. Quiet by design. */}
      <section className="mb-8">
        <Eyebrow>Portfolio</Eyebrow>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label="Properties" value={kpis.properties} href="/properties" />
          <KpiCard label="Active tenancies" value={kpis.tenancies} href="/properties" />
          {canReadDeadlines && kpis.upcomingDeadlines != null && <KpiCard label="Deadlines · 30 days" value={kpis.upcomingDeadlines} tone={kpis.upcomingDeadlines > 0 ? "warn" : "default"} href="/calendar" />}
          {canReadProofs && kpis.openProofs != null && <KpiCard label="Open proof requests" value={kpis.openProofs} href="/proofs" />}
        </div>
      </section>

      {canReadRenewals && <section className="mb-8">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <Eyebrow>Renewal queue</Eyebrow>
            <h2 className="font-display text-xl text-navy-900">Next actions</h2>
          </div>
          <Link href="/renewals?sort=urgency" className="text-sm text-navy-500 hover:text-navy-900">
            Full queue →
          </Link>
        </div>
        {renewalActions.length === 0 ? (
          <EmptyState message="No renewal action is currently due." />
        ) : (
          <Table stack headers={["Action", "Unit", "Notice gate", "Urgency"]}>
            {renewalActions.map((row) => (
              <tr key={row.tenancyId}>
                <Td label="Action">
                  <Link href={row.nextAction.href} className="font-semibold text-navy-900 hover:underline">
                    {row.nextAction.label}
                  </Link>
                  <div className="mt-0.5 max-w-xl text-xs text-muted">{row.nextAction.reason}</div>
                </Td>
                <Td label="Unit" className="text-xs">{row.unit || "Unit"}</Td>
                <Td label="Notice gate" className="figure whitespace-nowrap text-xs">
                  {formatDubaiDate(row.noticeGateAt)}
                </Td>
                <Td label="Urgency"><Badge value={row.nextAction.urgency} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </section>}

      {(canReadDeadlines || canReadRisk) && <div className="grid gap-6 lg:grid-cols-2">
        {canReadDeadlines && <div>
          <h2 className="font-display mb-3 text-xl text-navy-900">Upcoming</h2>
          {upcoming.length === 0 ? (
            <EmptyState message="No upcoming deadlines. The calendar is clear." />
          ) : (
            <Card>
              <ol className="relative ml-1 space-y-4 border-l border-line pl-5">
                {upcoming.map((d) => {
                  const hot = d.kind === "NOTICE_GATE";
                  const renewal = d.tenancyId ? pipeline.find((row) => row.tenancyId === d.tenancyId) : null;
                  const deadlinePresentation = deadlineNextAction(d);
                  const canonical = renewal && ["NOTICE_GATE", "CONTRACT_EXPIRY", "RENEWAL_DATE", "TENANT_RESPONSE_DUE"].includes(d.kind)
                    ? renewal.nextAction
                    : null;
                  const presentation = canonical
                    ? {
                        label: canonical.label,
                        reason: canonical.reason,
                        href: canonical.href,
                        urgency: canonical.urgency,
                        responsibleLayer: canonical.responsibleLayer,
                      }
                    : {
                        ...deadlinePresentation,
                        urgency: hot ? "CRITICAL" : "SCHEDULED",
                        responsibleLayer: undefined,
                      };
                  return (
                    <li key={d.id} className="relative">
                      <span
                        className={`absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white ${hot ? "bg-claret-500" : "bg-gold-500"}`}
                      />
                      <Link
                        href={presentation.href}
                        className="group -m-2 block rounded-lg p-2 transition hover:bg-ivory-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-500"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="figure text-[11px] uppercase tracking-wide text-navy-300">
                              {formatDubaiDate(d.dueAt)}
                            </div>
                            <div className="text-sm font-semibold text-navy-900 group-hover:underline">{presentation.label}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge value={presentation.urgency} />
                            <span aria-hidden className="text-navy-300 transition group-hover:translate-x-0.5">→</span>
                          </div>
                        </div>
                        {d.tenancy?.property && (
                          <div className="text-xs text-muted">
                            {d.tenancy.property.community}
                            {d.tenancy.property.unitNo ? ` · ${d.tenancy.property.unitNo}` : ""}
                          </div>
                        )}
                        <div className="mt-0.5 text-xs text-muted">{presentation.reason}</div>
                        {presentation.responsibleLayer && (
                          <div className="mt-1 text-[11px] text-navy-500">Responsible: {presentation.responsibleLayer}</div>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </Card>
          )}
        </div>}
        {canReadRisk && <div>
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
        </div>}
      </div>}

      <Card className="mt-8 bg-ivory-100 text-xs text-navy-500">
        Seneschal keeps the record and the evidence — it doesn’t hold funds, broker deals, or give legal
        advice. Figures are rule-based; review before acting.
      </Card>
    </>
  );
}
