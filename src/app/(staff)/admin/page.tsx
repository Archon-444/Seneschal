import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/server/auth/request";
import { platformStats } from "@/server/admin/platformStats";
import { Badge, Card, KpiCard, PageHeader, Table, Td } from "@/components/ui";
import { formatDubaiDate } from "@/server/calculators/dates";

// Platform console (F-Admin §3, §7). Unreachable without isPlatformAdmin. Shows
// lifecycle/billing/aggregate HEALTH only — counts, statuses, timestamps. No customer
// data: the cross-workspace risk-flag/notification/member-email row reads were removed in
// the F-Admin teardown; this reads `platformStats` scalars exclusively.

export default async function AdminPage() {
  let ctx;
  try {
    ctx = await requirePlatformAdmin();
  } catch {
    redirect("/dashboard");
  }
  const stats = await platformStats(ctx!);

  const totals = stats.reduce(
    (acc, s) => ({
      active: acc.active + (s.archived ? 0 : 1),
      seats: acc.seats + s.seatsUsed,
      openFlags: acc.openFlags + s.openRiskFlags,
      failedSends: acc.failedSends + s.notifications.failed,
    }),
    { active: 0, seats: 0, openFlags: 0, failedSends: 0 },
  );

  return (
    <>
      <PageHeader
        title="Platform console"
        subtitle="Lifecycle, billing & aggregate health across every workspace — never customer data."
      />
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Active workspaces" value={String(totals.active)} />
        <KpiCard label="Seats in use" value={String(totals.seats)} />
        <KpiCard
          label="Open risk flags"
          value={String(totals.openFlags)}
          tone={totals.openFlags > 0 ? "warn" : "default"}
        />
        <KpiCard
          label="Failed sends"
          value={String(totals.failedSends)}
          tone={totals.failedSends > 0 ? "danger" : "default"}
        />
      </div>

      {stats.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">No workspaces provisioned yet.</p>
        </Card>
      ) : (
        <Table
          headers={[
            "Workspace",
            "Type",
            "Seats",
            "Properties",
            "Active tenancies",
            "Open proofs",
            "Open flags",
            "Sends ok/fail/queued",
            "Subscription",
            "Last activity",
          ]}
        >
          {stats.map((s) => (
            <tr key={s.workspaceId}>
              <Td>
                {s.name}
                {s.archived && <span className="ml-2 text-xs text-muted">(archived)</span>}
              </Td>
              <Td>
                <Badge value={s.type} />
              </Td>
              <Td className="figure">{s.seatsUsed}</Td>
              <Td className="figure">{s.properties}</Td>
              <Td className="figure">{s.tenanciesByStatus.ACTIVE ?? 0}</Td>
              <Td className="figure">{s.openProofRequests}</Td>
              <Td className="figure">{s.openRiskFlags}</Td>
              <Td className="figure text-xs">
                {s.notifications.sent}/{s.notifications.failed}/{s.notifications.queued}
              </Td>
              <Td>
                {s.subscriptionStatus ? (
                  <Badge value={s.subscriptionStatus.toUpperCase()} />
                ) : (
                  <span className="text-muted">—</span>
                )}
              </Td>
              <Td className="figure text-xs">
                {s.lastActivityAt ? formatDubaiDate(s.lastActivityAt) : "—"}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
