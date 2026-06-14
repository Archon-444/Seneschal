import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { listRenewalPipeline } from "@/server/services/renewals";
import { formatDubaiDate } from "@/server/calculators/dates";
import { Badge, Card, EmptyState, KpiCard, Money, PageHeader, Table, Td } from "@/components/ui";

// Renewal pipeline (Renewal Risk Desk). Every unit approaching renewal, with its
// notice gate, index-based position and where the decision stands. Figures are
// estimates anchored to the captured index — review before action.

export default async function RenewalsPage() {
  const ctx = await requireCtx();
  const rows = await listRenewalPipeline(ctx, { withinDays: 120 });

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
              <Td>{r.gapPct != null ? `${Math.round(r.gapPct * 100)}% below` : <span className="text-muted">no index yet</span>}</Td>
              <Td>{r.valueAtRisk != null ? <Money amount={r.valueAtRisk} /> : "—"}</Td>
              <Td>{r.stage ? <Badge value={r.stage} /> : <span className="text-xs text-muted">{r.gatePassed ? "lapsed" : "not started"}</span>}</Td>
            </tr>
          ))}
        </Table>
      )}

      <Card className="mt-6 border-gold-300 bg-gold-50/40">
        <p className="text-xs text-muted">
          Index-based position, estimated from a manually-captured DLD Smart Rental Index figure under
          Decree No. (43) of 2013. Seneschal is not a broker or legal adviser — review official
          sources before serving a notice or agreeing terms.
        </p>
      </Card>
    </>
  );
}
