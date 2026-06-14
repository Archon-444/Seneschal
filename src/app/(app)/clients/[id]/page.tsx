import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import { getClient } from "@/server/services/clients";
import { listProperties } from "@/server/services/properties";
import { listDeadlines } from "@/server/services/deadlines";
import { listRenewalPipeline } from "@/server/services/renewals";
import { listPayments } from "@/server/services/payments";
import { formatDubaiDate, todayInDubai } from "@/server/calculators/dates";
import { Badge, BackLink, EmptyState, KpiCard, LinkButton, Money, PageHeader, Table, Td } from "@/components/ui";

// Screen 17 — client-scoped dashboard. CLIENT_VIEWER lands here; fiduciaries
// use it as the per-client view. Scoping enforced by authz (T1.4 suite).

export default async function ClientDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();

  let client;
  try {
    client = await getClient(ctx, id);
  } catch {
    notFound();
  }
  const [properties, deadlines, payments, renewalRows] = await Promise.all([
    listProperties(ctx, { clientPrincipalId: id }),
    listDeadlines(ctx, { clientPrincipalId: id }),
    listPayments(ctx),
    listRenewalPipeline(ctx, { clientPrincipalId: id }),
  ]);
  const today = todayInDubai();
  const clientPropertyIds = new Set(properties.map((p) => p.id));
  const clientPayments = payments.filter((p) => clientPropertyIds.has(p.tenancy.propertyId));
  const upcoming = deadlines.filter((d) => d.dueAt >= today);
  const overdue = deadlines.filter((d) => d.dueAt < today);

  return (
    <>
      <BackLink href="/clients" label="All clients" />
      <PageHeader
        title={client!.displayName}
        subtitle="Client dashboard"
        actions={<LinkButton href={`/api/v1/clients/${id}/export.csv`}>Export CSV</LinkButton>}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Properties" value={properties.length} />
        <KpiCard label="Upcoming deadlines" value={upcoming.length} tone={upcoming.length ? "warn" : "good"} />
        <KpiCard label="Overdue deadlines" value={overdue.length} tone={overdue.length ? "danger" : "good"} />
        <KpiCard
          label="Late cheques"
          value={clientPayments.filter((p) => p.status === "LATE" || p.status === "BOUNCED").length}
        />
      </div>

      <h2 className="font-display mt-8 mb-3 text-xl text-navy-900">Properties</h2>
      {properties.length === 0 ? (
        <EmptyState message="No properties for this client." />
      ) : (
        <Table headers={["Property", "Tenancy ends", "Rent"]}>
          {properties.map((p) => {
            const t = p.tenancies[0];
            return (
              <tr key={p.id}>
                <Td>
                  <Link href={`/properties/${p.id}`} className="text-navy-900 hover:underline">
                    {p.community}{p.unitNo ? ` · ${p.unitNo}` : ""}
                  </Link>
                </Td>
                <Td className="figure">{t ? formatDubaiDate(t.endDate) : "vacant"}</Td>
                <Td>{t ? <Money amount={String(t.annualRent)} /> : "—"}</Td>
              </tr>
            );
          })}
        </Table>
      )}

      {renewalRows.length > 0 && (
        <>
          <h2 className="font-display mt-8 mb-3 text-xl text-navy-900">Renewals outlook</h2>
          <Table headers={["Unit", "Notice gate", "Est. permissible uplift", "Stage"]}>
            {renewalRows.map((r) => (
              <tr key={r.tenancyId}>
                <Td>
                  <Link href={`/renewals/${r.tenancyId}`} className="text-navy-900 hover:underline">
                    {r.unit || "Unit"}
                  </Link>
                </Td>
                <Td className="figure whitespace-nowrap">
                  {formatDubaiDate(r.noticeGateAt)}{r.gatePassed ? " · passed" : ` · ${r.daysToGate}d`}
                </Td>
                <Td>{r.valueAtRisk != null ? <Money amount={r.valueAtRisk} /> : "—"}</Td>
                <Td>{r.stage ? <Badge value={r.stage} /> : <span className="text-xs text-muted">—</span>}</Td>
              </tr>
            ))}
          </Table>
        </>
      )}

      <h2 className="font-display mt-8 mb-3 text-xl text-navy-900">Cheques</h2>
      {clientPayments.length === 0 ? (
        <EmptyState message="No payment items." />
      ) : (
        <Table headers={["Due", "Property", "Amount", "Status"]}>
          {clientPayments.slice(0, 20).map((p) => (
            <tr key={p.id}>
              <Td className="figure whitespace-nowrap">{formatDubaiDate(p.dueDate)}</Td>
              <Td>{p.tenancy.property.community}{p.tenancy.property.unitNo ? ` · ${p.tenancy.property.unitNo}` : ""}</Td>
              <Td><Money amount={String(p.amount)} /></Td>
              <Td><Badge value={p.status} /></Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
