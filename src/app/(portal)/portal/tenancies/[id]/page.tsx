import { redirect } from "next/navigation";
import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { isPersonaRole } from "@/server/authz";
import { getTenancy } from "@/server/services/tenancies";
import { listOffersForTenant } from "@/server/services/renewals";
import { listTenancyReceipts } from "@/server/services/payments";
import { listDocuments, getDocumentUrl } from "@/server/services/documents";
import { formatDubaiDate } from "@/server/calculators/dates";
import { Badge, Card, EmptyState, Field, inputClass, KpiCard, Money, PageHeader, Reminder, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { respondToOfferAction, uploadTenancyDocumentAction, viewReceiptAction } from "./actions";

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
  const offers = ctx.role === "TENANT" ? await listOffersForTenant(ctx, id) : [];
  const openOffer = offers.find((o) => o.status === "SENT" || o.status === "COUNTERED");
  // Receipt vault: map each payment item to its receipt document, if any.
  const receipts = await listTenancyReceipts(ctx, id);
  const receiptByItem = new Map(receipts.map((d) => [d.scopeId!, d]));

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

      {ctx.role === "TENANT" && offers.length > 0 && (
        <Card className="mb-6">
          <h2 className="font-display mb-3 text-lg text-navy-900">Renewal proposal</h2>
          <Table stack headers={["v", "From", "Annual rent", "Payment", "Status"]}>
            {offers.map((o) => (
              <tr key={o.id}>
                <Td label="v" className="figure">{o.version}</Td>
                <Td label="From">{o.party}</Td>
                <Td label="Annual rent"><Money amount={String(o.annualRent)} /></Td>
                <Td label="Payment">{o.paymentSchedule}</Td>
                <Td label="Status"><Badge value={o.status} /></Td>
              </tr>
            ))}
          </Table>
          {openOffer && openOffer.party === "LANDLORD" && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <form action={respondToOfferAction} className="rounded-md border border-line p-3">
                <input type="hidden" name="tenancyId" value={id} />
                <input type="hidden" name="offerId" value={openOffer.id} />
                <input type="hidden" name="action" value="ACCEPT" />
                <p className="mb-2 text-sm text-navy-700">Accept the proposed terms.</p>
                <SubmitButton pendingLabel="Accepting…">Accept</SubmitButton>
              </form>
              <form action={respondToOfferAction} className="rounded-md border border-line p-3">
                <input type="hidden" name="tenancyId" value={id} />
                <input type="hidden" name="offerId" value={openOffer.id} />
                <input type="hidden" name="action" value="COUNTER" />
                <p className="mb-2 text-sm text-navy-700">Counter with your own terms.</p>
                <div className="grid gap-2">
                  <Field label="Annual rent (AED)"><input name="annualRent" type="number" min="0" required className={inputClass} /></Field>
                  <Field label="Payment"><input name="paymentSchedule" required className={inputClass} placeholder="4 cheques" /></Field>
                  <SubmitButton variant="secondary" pendingLabel="Sending…">Send counter</SubmitButton>
                </div>
              </form>
            </div>
          )}
        </Card>
      )}

      <h2 className="mb-3 font-display text-xl text-navy-900">Payment schedule</h2>
      <p className="mb-3 text-xs text-muted">Record-keeping only — Seneschal never holds funds.</p>
      <Table stack headers={["#", "Due", "Amount", "Instrument", "Status", "Receipt"]}>
        {tenancy.paymentItems.map((p) => {
          const receipt = receiptByItem.get(p.id);
          return (
            <tr key={p.id}>
              <Td label="#" className="figure">{p.seq}</Td>
              <Td label="Due" className="figure">{formatDubaiDate(p.dueDate)}</Td>
              <Td label="Amount"><Money amount={String(p.amount)} /></Td>
              <Td label="Instrument">{p.instrument}{p.chequeNo ? ` · ${p.chequeNo}` : ""}</Td>
              <Td label="Status"><Badge value={p.status} /></Td>
              <Td label="Receipt">
                {receipt ? (
                  <form action={viewReceiptAction}>
                    <input type="hidden" name="documentId" value={receipt.id} />
                    <button type="submit" className="text-gold-700 hover:underline">View</button>
                  </form>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </Td>
            </tr>
          );
        })}
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
          {ctx.role === "TENANT" && (
            <Card className="mt-4">
              <h3 className="mb-2 text-sm font-medium text-navy-900">Add a document</h3>
              <form action={uploadTenancyDocumentAction} className="flex items-end gap-2">
                <input type="hidden" name="tenancyId" value={id} />
                <Field label="File">
                  <input name="file" type="file" required className={inputClass} />
                </Field>
                <SubmitButton pendingLabel="Uploading…">Upload</SubmitButton>
              </form>
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
