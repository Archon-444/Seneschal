import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/server/auth/request";
import { platformStats } from "@/server/admin/platformStats";
import { Badge, DubaiDate, EmptyState, KpiCard, LinkButton, PageHeader, Table, Td } from "@/components/ui";
import { archiveAction, suspendAction, unarchiveAction, unsuspendAction } from "./actions";

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
        actions={
          <LinkButton href="/admin/new" variant="primary">
            Provision workspace
          </LinkButton>
        }
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
        <EmptyState title="No workspaces yet" message="Provision the first workspace to get started." />
      ) : (
        <Table
          stack
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
            "",
          ]}
        >
          {stats.map((s) => (
            <tr key={s.workspaceId}>
              <Td label="Workspace">
                {s.name}
                {s.archived && <span className="ml-2 text-xs text-claret-700">(archived)</span>}
                {!s.archived && s.suspended && <span className="ml-2 text-xs text-amber-700">(suspended)</span>}
              </Td>
              <Td label="Type">
                <Badge value={s.type} />
              </Td>
              <Td label="Seats" className="figure">{s.seatsUsed}</Td>
              <Td label="Properties" className="figure">{s.properties}</Td>
              <Td label="Active tenancies" className="figure">{s.tenanciesByStatus.ACTIVE ?? 0}</Td>
              <Td label="Open proofs" className="figure">{s.openProofRequests}</Td>
              <Td label="Open flags" className="figure">{s.openRiskFlags}</Td>
              <Td label="Sends ok/fail/queued" className="figure text-xs">
                {s.notifications.sent}/{s.notifications.failed}/{s.notifications.queued}
              </Td>
              <Td label="Subscription">
                {s.subscriptionStatus ? (
                  <Badge value={s.subscriptionStatus.toUpperCase()} />
                ) : (
                  <span className="text-muted">—</span>
                )}
              </Td>
              <Td label="Last activity" className="text-xs">
                {s.lastActivityAt ? <DubaiDate value={s.lastActivityAt} /> : "—"}
              </Td>
              <Td>
                <div className="flex flex-wrap justify-end gap-1.5 text-xs">
                  {s.archived ? (
                    // Archive is recoverable — an archived workspace offers only Unarchive.
                    <form action={unarchiveAction}>
                      <input type="hidden" name="workspaceId" value={s.workspaceId} />
                      <button className="rounded-md border border-line px-2 py-1 text-verde-700 hover:bg-verde-100">
                        Unarchive
                      </button>
                    </form>
                  ) : (
                    <>
                      <form action={s.suspended ? unsuspendAction : suspendAction}>
                        <input type="hidden" name="workspaceId" value={s.workspaceId} />
                        <button className="rounded-md border border-line px-2 py-1 text-navy-700 hover:bg-ivory-100">
                          {s.suspended ? "Unsuspend" : "Suspend"}
                        </button>
                      </form>
                      <form action={archiveAction}>
                        <input type="hidden" name="workspaceId" value={s.workspaceId} />
                        <button className="rounded-md border border-line px-2 py-1 text-claret-700 hover:bg-claret-100">
                          Archive
                        </button>
                      </form>
                    </>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
