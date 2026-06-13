import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { listPayments } from "@/server/services/payments";
import { formatDubaiDate } from "@/server/calculators/dates";
import { Badge, EmptyState, LinkButton, Money, PageHeader, Table, Td } from "@/components/ui";

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const ctx = await requireCtx();
  const all = await listPayments(ctx);
  // "problem" filter (from the dashboard cheques indicator) = late or bounced
  const problemOnly = status === "problem";
  const payments = problemOnly ? all.filter((p) => p.status === "LATE" || p.status === "BOUNCED") : all;

  return (
    <>
      <PageHeader
        title="Payments register"
        subtitle="Record-keeping only — no funds held"
        actions={problemOnly ? <LinkButton href="/payments">Show all</LinkButton> : undefined}
      />
      {problemOnly && (
        <p className="mb-4 text-sm text-claret-700">Showing late &amp; bounced cheques only.</p>
      )}
      {payments.length === 0 ? (
        <EmptyState message={problemOnly ? "No late or bounced cheques." : "No payment items yet."} />
      ) : (
        <Table headers={["Due", "Property", "#", "Amount", "Cheque", "Bank", "Status"]}>
          {payments.map((p) => (
            <tr key={p.id} className={p.status === "LATE" || p.status === "BOUNCED" ? "bg-claret-100/30" : ""}>
              <Td className="figure whitespace-nowrap">{formatDubaiDate(p.dueDate)}</Td>
              <Td>
                <Link href={`/properties/${p.tenancy.propertyId}?tab=payments`} className="hover:underline">
                  {p.tenancy.property.community}{p.tenancy.property.unitNo ? ` · ${p.tenancy.property.unitNo}` : ""}
                </Link>
              </Td>
              <Td className="figure">{p.seq}</Td>
              <Td><Money amount={String(p.amount)} /></Td>
              <Td className="figure">{p.chequeNo ?? "—"}</Td>
              <Td>{p.bank ?? "—"}</Td>
              <Td><Badge value={p.status} /></Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
