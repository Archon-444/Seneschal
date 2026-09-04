import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { hasCapability } from "@/server/authz";
import { activationStatus, dashboardKpis } from "@/server/services/dashboard";
import { deadlineNextAction, listDeadlines } from "@/server/services/deadlines";
import { listRiskFlags } from "@/server/services/risk";
import { listRenewalPipeline } from "@/server/services/renewals";
import { formatDubaiDate, todayInDubai } from "@/server/calculators/dates";
import {
  Badge,
  EmptyState,
  Footnote,
  LinkButton,
  Money,
  PageHeader,
  Panel,
  ScopeLink,
  Stat,
  StatStrip,
  Table,
  Td,
} from "@/components/ui";
import { GettingStarted } from "./GettingStarted";

const RENEWAL_DEADLINE_KINDS = ["NOTICE_GATE", "CONTRACT_EXPIRY", "RENEWAL_DATE", "TENANT_RESPONSE_DUE"];

function daysCell(days: number, gatePassed: boolean) {
  return (
    <span className={`figure ${gatePassed ? "text-claret-500" : days <= 30 ? "text-navy-900" : "text-muted"}`}>
      {gatePassed ? `−${Math.abs(days)}` : days}
    </span>
  );
}

export default async function DashboardPage() {
  const ctx = await requireCtx();
  const canOnboard = hasCapability(ctx, "clients.write");
  const canReadDeadlines = hasCapability(ctx, "deadlines.read");
  const canReadPayments = hasCapability(ctx, "payments.read");
  const canReadProofs = hasCapability(ctx, "proofs.read");
  const canReadRenewals = hasCapability(ctx, "renewals.read");
  const canReadRisk = hasCapability(ctx, "riskflags.read");
  const canReport = hasCapability(ctx, "reports.read");
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
        title="Overview"
        subtitle={`${formatDubaiDate(today)} · Asia/Dubai`}
        actions={canReport ? <LinkButton href="/reports">Generate monthly report</LinkButton> : undefined}
      />

      {activation && (
        <GettingStarted
          hasClient={activation.hasClient}
          hasTenancy={activation.hasTenancy}
          hasTeam={activation.hasTeam}
          showTeamStep={hasCapability(ctx, "members.read")}
        />
      )}

      {/* One strip: the figures that cost money if ignored first, then standing counts. */}
      <StatStrip className="mb-4">
        {canReadDeadlines && kpis.overdueDeadlines != null && (
          <Stat
            label="Overdue deadlines"
            value={kpis.overdueDeadlines}
            tone={kpis.overdueDeadlines > 0 ? "danger" : "default"}
            href="/calendar"
          />
        )}
        {canReadPayments && kpis.latePayments != null && (
          <Stat
            label="Late / bounced cheques"
            value={kpis.latePayments}
            tone={kpis.latePayments > 0 ? "danger" : "default"}
            href="/payments?status=problem"
          />
        )}
        {canReadRisk && kpis.openFlags != null && (
          <Stat label="Open risk flags" value={kpis.openFlags} tone={kpis.openFlags > 0 ? "warn" : "default"} href="/risk" />
        )}
        {canReadDeadlines && kpis.upcomingDeadlines != null && (
          <Stat label="Deadlines · next 30 days" value={kpis.upcomingDeadlines} href="/calendar" />
        )}
        {canReadProofs && kpis.openProofs != null && (
          <Stat label="Open proof requests" value={kpis.openProofs} href="/proofs" />
        )}
        <Stat label="Properties / active tenancies" value={`${kpis.properties} / ${kpis.tenancies}`} href="/properties" />
        {canReadRenewals && (
          <Stat
            label="Est. permissible uplift · 120 days"
            value={<Money amount={upliftAtRisk} />}
            sub="captured-index renewals · estimate only"
            href="/renewals"
          />
        )}
      </StatStrip>

      {canReadRenewals && (
        <Panel
          className="mb-4"
          title="Next actions"
          meta={renewalActions.length > 0 ? `${renewalActions.length} of ${pipeline.length} renewals need a step` : undefined}
          actions={
            <Link href="/renewals?sort=urgency" className="text-[12.5px] font-medium text-navy-700 hover:underline">
              Full queue
            </Link>
          }
        >
          {renewalActions.length === 0 ? (
            <div className="p-3">
              <EmptyState message="No renewal action is currently due." />
            </div>
          ) : (
            <Table bare stack headers={["Action", "Unit", "Owner", "Notice gate", "Days", "Urgency", "Responsible"]}>
              {renewalActions.map((row) => (
                <tr key={row.tenancyId}>
                  <Td label="Action" className="whitespace-nowrap">
                    <Link
                      href={row.nextAction.href}
                      title={row.nextAction.reason}
                      className="font-medium text-navy-900 hover:underline"
                    >
                      {row.nextAction.label}
                    </Link>
                  </Td>
                  <Td label="Unit" className="whitespace-nowrap">{row.unit || "Unit"}</Td>
                  <Td label="Owner" className="whitespace-nowrap text-navy-700">{row.ownerName ?? "—"}</Td>
                  <Td label="Notice gate" className="figure whitespace-nowrap">{formatDubaiDate(row.noticeGateAt)}</Td>
                  <Td label="Days" className="text-right">{daysCell(row.daysToGate, row.gatePassed)}</Td>
                  <Td label="Urgency"><Badge value={row.nextAction.urgency} /></Td>
                  <Td label="Responsible" className="text-muted"><span className="block max-w-[14rem] truncate" title={row.nextAction.responsibleLayer ?? undefined}>{row.nextAction.responsibleLayer ?? "—"}</span></Td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
      )}

      {(canReadDeadlines || canReadRisk) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {canReadDeadlines && (
            <Panel
              title="Upcoming"
              meta="next 30 days"
              actions={<Link href="/calendar" className="text-[12.5px] font-medium text-navy-700 hover:underline">Calendar</Link>}
            >
              {upcoming.length === 0 ? (
                <div className="p-3">
                  <EmptyState message="No upcoming deadlines. The calendar is clear." />
                </div>
              ) : (
                <Table bare stack headers={["Due", "Item", "Unit", "Urgency"]}>
                  {upcoming.map((d) => {
                    const hot = d.kind === "NOTICE_GATE";
                    const renewal = d.tenancyId ? pipeline.find((row) => row.tenancyId === d.tenancyId) : null;
                    const canonical = renewal && RENEWAL_DEADLINE_KINDS.includes(d.kind) ? renewal.nextAction : null;
                    const fallback = deadlineNextAction(d);
                    const label = canonical ? canonical.label : fallback.label;
                    const reason = canonical ? canonical.reason : fallback.reason;
                    const href = canonical ? canonical.href : fallback.href;
                    const urgency = canonical ? canonical.urgency : hot ? "CRITICAL" : "SCHEDULED";
                    const unit = d.tenancy?.property
                      ? `${d.tenancy.property.community}${d.tenancy.property.unitNo ? ` · ${d.tenancy.property.unitNo}` : ""}`
                      : "—";
                    return (
                      <tr key={d.id}>
                        <Td label="Due" className="figure whitespace-nowrap">{formatDubaiDate(d.dueAt)}</Td>
                        <Td label="Item" className="whitespace-nowrap">
                          <Link href={href} title={reason} className="font-medium text-navy-900 hover:underline">
                            {label}
                          </Link>
                        </Td>
                        <Td label="Unit" className="whitespace-nowrap text-navy-700">{unit}</Td>
                        <Td label="Urgency"><Badge value={urgency} /></Td>
                      </tr>
                    );
                  })}
                </Table>
              )}
            </Panel>
          )}
          {canReadRisk && (
            <Panel
              title="Open risk flags"
              meta={flags.length > 0 ? String(flags.length) : undefined}
              actions={<Link href="/risk" className="text-[12.5px] font-medium text-navy-700 hover:underline">All flags</Link>}
            >
              {flags.length === 0 ? (
                <div className="p-3">
                  <EmptyState message="No open risk flags." />
                </div>
              ) : (
                <Table bare headers={["Raised", "Code", "Scope", "Severity"]}>
                  {flags.slice(0, 8).map((f) => (
                    <tr key={f.id}>
                      <Td className="figure whitespace-nowrap">{formatDubaiDate(f.raisedAt)}</Td>
                      <Td className="whitespace-nowrap font-medium">
                        {f.code.charAt(0) + f.code.slice(1).toLowerCase().replace(/_/g, " ")}
                      </Td>
                      <Td className="whitespace-nowrap"><ScopeLink scopeType={f.scopeType} scopeId={f.scopeId} /></Td>
                      <Td><Badge value={f.severity} /></Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Panel>
          )}
        </div>
      )}

      <Footnote>
        Seneschal keeps the record and the evidence. It does not hold funds, broker deals, or give legal advice.
        Figures are rule-based; review before acting.
      </Footnote>
    </>
  );
}
