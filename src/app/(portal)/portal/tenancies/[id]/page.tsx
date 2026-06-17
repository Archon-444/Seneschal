import { redirect } from "next/navigation";
import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { isPersonaRole } from "@/server/authz";
import { getTenancy } from "@/server/services/tenancies";
import { listDocuments, getDocumentUrl } from "@/server/services/documents";
import { formatDubaiDate } from "@/server/calculators/dates";
import { Badge, Card, EmptyState, KpiCard, Money, PageHeader, Reminder, Table, Td } from "@/components/ui";

function propLabel(p: { community: string; building: string | null; unitNo: string | null }): string {
  return [p.building, p.unitNo ? `Unit ${p.unitNo}` : null, p.community].filter(Boolean).join(" · ");
}

// TENANT-scoped tenancy detail (2B #15). getTenancy enforces the persona contact
// scope, so a tenant only ever reaches their own tenancy; a LANDLORD reaches one on
// a property they own. Read-only — this is the record kept on the tenant's behalf.
export default async function TenancyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  if (!isPersonaRole(ctx.role)) redirect("/portal");
  const { id } = await params;
  const tenancy = await getTenancy(ctx, id); // 404s if out of scope

  const docs = await listDocuments(ctx, { scopeType: "TENANCY", scopeId: id });
  const docLinks = await Promise.all(
    docs.map(async (d) => ({ doc: d, url: (await getDocumentUrl(ctx, d.id)).url })),
  );
  const nextPayment = tenancy.paymentItems.find((p) => p.status === "SCHEDULED" || p.status === "REQUESTED");

  return (
    <>
      <Link href="/portal" className="mb-2 inline-block text-sm text-muted hover:underline">← Portal</Link>
      <PageHeader
        eyebrow="Your tenancy"
        title={propLabel(tenancy.property)}
        subtitle={tenancy.ejariNo ? `Ejari ${tenancy.ejariNo}` : "Ejari not recorded"}
        actions={<Badge value={tenancy.status} />}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Annual rent" value={<Money amount={String(tenancy.annualRent)} />} />
        <KpiCard
          label="Term"
          value={<span className="text-lg">{formatDubaiDate(tenancy.startDate)} → {formatDubaiDate(tenancy.endDate)}</span>}
          sub={tenancy.depositAmount != null ? `Deposit AED ${Number(tenancy.depositAmount).toLocaleString("en-AE")}` : undefined}
        />
        <KpiCard
          label="Next payment"
          value={nextPayment ? <Money amount={String(nextPayment.amount)} /> : "—"}
          sub={nextPayment ? `Due ${formatDubaiDate(nextPayment.dueDate)}` : "Nothing scheduled"}
          tone="warn"
        />
      </div>

      <h2 className="mb-3 font-display text-xl text-navy-900">Payment schedule</h2>
      <Table headers={["#", "Due", "Amount", "Instrument", "Status"]}>
        {tenancy.paymentItems.map((p) => (
          <tr key={p.id}>
            <Td className="figure">{p.seq}</Td>
            <Td className="figure">{formatDubaiDate(p.dueDate)}</Td>
            <Td><Money amount={String(p.amount)} /></Td>
            <Td>{p.instrument}{p.chequeNo ? ` · ${p.chequeNo}` : ""}</Td>
            <Td><Badge value={p.status} /></Td>
          </tr>
        ))}
      </Table>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 font-display text-xl text-navy-900">Documents</h2>
          {docLinks.length === 0 ? (
            <EmptyState message="No documents on this tenancy yet." />
          ) : (
            <Card>
              <ul className="space-y-2 text-sm">
                {docLinks.map(({ doc, url }) => (
                  <li key={doc.id} className="flex items-center justify-between">
                    <span>{doc.fileName} <span className="text-muted">· {doc.kind.replace(/_/g, " ")}</span></span>
                    <a href={url} target="_blank" rel="noreferrer" className="text-gold-700 hover:underline">View</a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div>
          <h2 className="mb-3 font-display text-xl text-navy-900">Coming up</h2>
          {tenancy.deadlines.length === 0 ? (
            <EmptyState message="No upcoming deadlines." />
          ) : (
            <Card>
              {tenancy.deadlines.slice(0, 8).map((d) => (
                <Reminder key={d.id} date={formatDubaiDate(d.dueAt)} title={d.kind.replace(/_/g, " ")} />
              ))}
            </Card>
          )}
        </div>
      </section>
    </>
  );
}
