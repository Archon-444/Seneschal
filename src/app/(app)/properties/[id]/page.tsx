import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import { hasCapability } from "@/server/authz";
import { getProperty } from "@/server/services/properties";
import { getRenewalRisk } from "@/server/services/renewals";
import { listDocuments } from "@/server/services/documents";
import { getEvidenceTimeline } from "@/server/services/evidenceReadModel";
import { daysBetween, todayInDubai } from "@/server/calculators/dates";
import { Badge, BackLink, Card, DubaiDate, EmptyState, Field, inputClass, LinkButton, Money, PageHeader, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import {
  createMoveInAction,
  acknowledgeMoveInOperatorAction,
  addMoveInPhotoAction,
} from "../../actions";
import { PaymentRow } from "./PaymentRow";
import { UploadForm } from "./UploadForm";
import { EvidenceEventCard } from "@/components/evidence/EvidenceEventCard";

const TABS = ["tenancy", "payments", "documents", "evidence"] as const;

export default async function PropertyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab = "tenancy" } = await searchParams;
  const ctx = await requireCtx();
  const canWriteTenancies = hasCapability(ctx, "tenancies.write");
  const canReadMoveIn = hasCapability(ctx, "movein.read");
  const canWriteMoveIn = hasCapability(ctx, "movein.write");
  const canAcknowledgeMoveIn = hasCapability(ctx, "movein.acknowledge");
  const canWritePayments = hasCapability(ctx, "payments.write");
  const canWriteDocuments = hasCapability(ctx, "documents.write");
  const canReadEvidence = hasCapability(ctx, "evidence.read");

  let property;
  try {
    property = await getProperty(ctx, id);
  } catch {
    notFound();
  }
  const tenancy = property!.tenancies.find((t) => !t.archivedAt);
  const [docs, evidence] = await Promise.all([
    listDocuments(ctx, { scopeType: "PROPERTY", scopeId: id }).then(async (propertyDocs) =>
      tenancy
        ? [...propertyDocs, ...(await listDocuments(ctx, { scopeType: "TENANCY", scopeId: tenancy.id }))]
        : propertyDocs,
    ),
    canReadEvidence ? getEvidenceTimeline(ctx, { property: id, pageSize: 100 }) : Promise.resolve(null),
  ]);
  const tenancyFull = tenancy
    ? await import("@/server/services/tenancies").then((m) => m.getTenancy(ctx, tenancy.id))
    : null;
  // Landlord, tenant and the renewal risk report only depend on tenancyFull and
  // are independent of each other — resolve them together, not in series.
  const { getContact } = await import("@/server/services/contacts");
  const [landlord, tenant, renewalRisk] = await Promise.all([
    tenancyFull?.landlordContactId
      ? getContact(ctx, tenancyFull.landlordContactId).catch(() => null)
      : Promise.resolve(null),
    tenancyFull?.tenantContactId
      ? getContact(ctx, tenancyFull.tenantContactId).catch(() => null)
      : Promise.resolve(null),
    tenancyFull ? getRenewalRisk(ctx, tenancyFull.id).catch(() => null) : Promise.resolve(null),
  ]);

  const { listMyMoveIns } = await import("@/server/services/moveIn");
  const moveIns = tenancyFull && canReadMoveIn ? await listMyMoveIns(ctx) : [];
  const moveIn = tenancyFull ? moveIns.find((m) => m.tenancyId === tenancyFull.id) ?? null : null;

  const title = `${property!.community}${property!.building ? ` · ${property!.building}` : ""}${property!.unitNo ? ` · ${property!.unitNo}` : ""}`;
  const daysToEnd = tenancyFull ? daysBetween(todayInDubai(), tenancyFull.endDate) : null;
  const approachingRenewal = daysToEnd != null && daysToEnd >= 0 && daysToEnd <= 120;
  const pos = renewalRisk?.position ?? null;
  const rentVsMarketPct = pos ? Math.round((1 - pos.currentRent / pos.marketRentAvg) * 100) : 0;

  return (
    <>
      <BackLink href="/properties" label="All properties" />
      <PageHeader
        title={title}
        subtitle={`${property!.propertyType ?? "property"}${property!.bedrooms != null ? ` · ${property!.bedrooms || "Studio"} BR` : ""}`}
        actions={
          !tenancy && canWriteTenancies ? (
            <LinkButton href={`/tenancies/new?propertyId=${id}`} variant="primary">Add tenancy</LinkButton>
          ) : tenancyFull && hasCapability(ctx, "evidence.export") ? (
            <LinkButton href={`/api/v1/tenancies/${tenancyFull.id}/evidence-pack.pdf`}>
              Download evidence pack
            </LinkButton>
          ) : undefined
        }
      />

      {approachingRenewal && (
        <Link
          href={`/renewals/${tenancyFull!.id}`}
          className="mb-6 inline-flex items-center gap-1 rounded border border-line bg-ivory-100 px-3 py-1.5 text-sm font-medium text-gold-700 hover:bg-gold-100"
        >
          Approaching renewal · {daysToEnd} days to expiry — view risk report →
        </Link>
      )}

      {tenancyFull && canReadMoveIn && (
        <Card className="mb-6 max-w-3xl">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-navy-900">Move-in handover</h2>
            {moveIn ? <Badge value={moveIn.status} /> : null}
          </div>
          {!moveIn && canWriteMoveIn ? (
            <form action={createMoveInAction} className="space-y-2">
              <input type="hidden" name="tenancyId" value={tenancyFull.id} />
              <input type="hidden" name="propertyId" value={id} />
              <Field label="Condition notes">
                <input name="notes" className={inputClass} placeholder="e.g. two scratches on the kitchen counter" />
              </Field>
              <SubmitButton variant="secondary" pendingLabel="Recording…">Record move-in</SubmitButton>
            </form>
          ) : moveIn ? (
            <div className="space-y-3 text-sm">
              <div className="text-xs text-muted">
                Landlord:{" "}
                {moveIn.landlordAckAt ? <>acknowledged <DubaiDate value={moveIn.landlordAckAt} /></> : "pending"} ·{" "}
                Tenant:{" "}
                {moveIn.tenantAckAt ? <>acknowledged <DubaiDate value={moveIn.tenantAckAt} /></> : "pending"}
              </div>
              <div className="flex flex-wrap gap-2">
                {canAcknowledgeMoveIn && !moveIn.landlordAckAt && (
                  <AckButton id={moveIn.id} propertyId={id} party="LANDLORD" label="Acknowledge as landlord" />
                )}
                {canAcknowledgeMoveIn && !moveIn.tenantAckAt && (
                  <AckButton id={moveIn.id} propertyId={id} party="TENANT" label="Acknowledge as tenant" />
                )}
              </div>
              {canWriteMoveIn && <form action={addMoveInPhotoAction} className="flex items-end gap-2">
                <input type="hidden" name="id" value={moveIn.id} />
                <input type="hidden" name="propertyId" value={id} />
                <input name="file" type="file" required className={inputClass + " max-w-xs"} />
                <SubmitButton variant="secondary" pendingLabel="Uploading…">Add photo</SubmitButton>
              </form>}
              {!canWriteMoveIn && !canAcknowledgeMoveIn && (
                <p className="text-xs text-muted">
                  Move-in changes and acknowledgements are completed by an authorized operator or party.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">
              No move-in record has been created. An authorized operator can record the handover.
            </p>
          )}
        </Card>
      )}

      {(property!.usage || property!.makaniNo || property!.dewaPremiseNo || property!.plotNo || property!.sizeSqm) && (
        <div className="mb-6 flex flex-wrap gap-x-8 gap-y-2 rounded border border-line bg-ivory-100 px-4 py-3 text-sm">
          {property!.usage && <AssetFact label="Usage" value={property!.usage} />}
          {property!.plotNo && <AssetFact label="Plot" value={property!.plotNo} />}
          {property!.makaniNo && <AssetFact label="Makani" value={property!.makaniNo} />}
          {property!.dewaPremiseNo && <AssetFact label="DEWA premises" value={property!.dewaPremiseNo} />}
          {property!.sizeSqm != null && <AssetFact label="Area" value={`${Number(property!.sizeSqm)} s.m`} />}
        </div>
      )}

      <div className="mb-6 flex gap-1 border-b border-ivory-300">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/properties/${id}?tab=${t}`}
            className={`rounded-t-md px-4 py-2 text-sm capitalize ${
              tab === t ? "border border-b-0 border-ivory-300 bg-white font-medium text-navy-900" : "text-navy-500 hover:text-navy-900"
            }`}
          >
            {t}
          </Link>
        ))}
      </div>

      {tab === "tenancy" && (
        tenancyFull ? (
          <Card className="max-w-3xl">
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm lg:grid-cols-3">
              <Detail label="Status"><Badge value={tenancyFull.status} /></Detail>
              <Detail label="Term">
                <DubaiDate value={tenancyFull.startDate} /> → <DubaiDate value={tenancyFull.endDate} />
              </Detail>
              <Detail label="Annual rent"><Money amount={String(tenancyFull.annualRent)} /></Detail>
              <Detail label="Deposit">{tenancyFull.depositAmount ? <Money amount={String(tenancyFull.depositAmount)} /> : "—"}</Detail>
              <Detail label="Ejari">
                {tenancyFull.ejariNo ?? <span className="text-claret-500">missing</span>}
              </Detail>
              <Detail label="Notice period">
                <span className="figure">{tenancyFull.noticePeriodDays} days</span>
                {tenancyFull.noticePeriodDays !== 90 && (
                  <span className="ml-1 text-xs text-amber-700">(contract override)</span>
                )}
              </Detail>
              <Detail label="Landlord">
                {landlord ? (
                  <Link href={`/contacts/${landlord.id}`} className="hover:underline">{landlord.name}</Link>
                ) : "—"}
              </Detail>
              <Detail label="Tenant">
                {tenant ? (
                  <Link href={`/contacts/${tenant.id}`} className="hover:underline">{tenant.name}</Link>
                ) : "—"}
              </Detail>
            </div>
            {pos && (
              <div className="mt-6 rounded border border-line bg-ivory-100 p-4">
                <h3 className="font-semibold mb-2 text-lg text-navy-900">Market position</h3>
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
                  <MarketFact label="Rent vs market" value={`${Math.abs(rentVsMarketPct)}% ${rentVsMarketPct >= 0 ? "below" : "above"}`} />
                  <MarketFact label="Increase band (Decree 43)" value={`${pos.bandPct}%`} />
                  <MarketFact label="Index-based ceiling est." value={<Money amount={pos.ceiling} />} />
                  <MarketFact label="Estimated value at risk" value={<><Money amount={pos.valueAtRisk} />/yr</>} />
                </div>
                <p className="mt-3 text-xs text-muted">
                  Estimated from the captured index{renewalRisk!.latestIndex?.isBenchmark ? " (community benchmark)" : ""} · not
                  legal advice · source captured <DubaiDate value={renewalRisk!.latestIndex!.capturedAt} />.{" "}
                  <Link href={`/renewals/${tenancyFull.id}`} className="text-navy-700 underline underline-offset-2">Full report →</Link>
                </p>
              </div>
            )}
            <h3 className="font-semibold mt-6 mb-2 text-lg text-navy-900">Open deadlines</h3>
            <Table stack headers={["Due", "Kind", "Rule"]}>
              {tenancyFull.deadlines.map((d) => (
                <tr key={d.id}>
                  <Td label="Due" className="whitespace-nowrap"><DubaiDate value={d.dueAt} /></Td>
                  <Td label="Kind"><Badge value={d.kind} /></Td>
                  <Td label="Rule" className="text-xs text-navy-300">
                    {(d.computedFrom as { rule?: string } | null)?.rule ?? "—"}
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        ) : (
          <EmptyState title="No active tenancy" message="Add one to generate the deadline calendar." />
        )
      )}

      {tab === "payments" && (
        tenancyFull ? (
          <>
            <Table stack headers={["#", "Due", "Amount", "Instrument", "Cheque no", "Bank", "Status", "Actions"]}>
              {tenancyFull.paymentItems.map((item) => (
                <PaymentRow key={item.id} item={{
                  id: item.id,
                  seq: item.seq,
                  dueDate: item.dueDate,
                  amount: String(item.amount),
                  instrument: item.instrument,
                  chequeNo: item.chequeNo,
                  bank: item.bank,
                  status: item.status,
                }} propertyId={id} canWrite={canWritePayments} />
              ))}
            </Table>
            <p className="mt-3 text-xs text-navy-300">
              Record-keeping only — Seneschal never holds funds.
            </p>
          </>
        ) : (
          <EmptyState title="No payment schedule" message="There's no tenancy on this unit yet." />
        )
      )}

      {tab === "documents" && (
        <div className="space-y-6">
          {canWriteDocuments ? (
            <UploadForm scopeType={tenancy ? "TENANCY" : "PROPERTY"} scopeId={tenancy?.id ?? id} back={`/properties/${id}?tab=documents`} />
          ) : (
            <Card className="text-sm text-muted">
              Documents can be uploaded by an authorized operator. You can review the files already on record below.
            </Card>
          )}
          {docs.length === 0 ? (
            <EmptyState title="No documents" message="No documents on file for this property." />
          ) : (
            <Table stack headers={["File", "Kind", "Uploaded", "SHA-256"]}>
              {docs.map((d) => (
                <tr key={d.id}>
                  <Td label="File">
                    <Link href={`/vault/${d.id}`} className="text-navy-900 hover:underline">{d.fileName}</Link>
                  </Td>
                  <Td label="Kind"><Badge value={d.kind} /></Td>
                  <Td label="Uploaded" className="whitespace-nowrap"><DubaiDate value={d.createdAt} /></Td>
                  <Td label="SHA-256" className="figure text-xs text-navy-300">{d.sha256.slice(0, 16)}…</Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      )}

      {tab === "evidence" && (
        !canReadEvidence || !evidence ? (
          <EmptyState title="Evidence detail is restricted" message="Your role can review the property record, but the evidence ledger requires evidence-read access." />
        ) : evidence.events.length === 0 ? (
          <EmptyState title="No evidence yet" message="Actions on this property will appear here." />
        ) : (
          <div>
            <div className="mb-4 flex justify-end"><LinkButton href={`/evidence?property=${id}`}>Open filtered evidence</LinkButton></div>
            <ol className="space-y-4">{evidence.events.map((event) => <li key={event.id}><EvidenceEventCard event={event} /></li>)}</ol>
          </div>
        )
      )}
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-0.5 text-navy-900">{children}</div>
    </div>
  );
}

function MarketFact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] text-muted">{label}</div>
      <div className="figure mt-0.5 text-navy-900">{value}</div>
    </div>
  );
}

function AssetFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[12px] text-muted">{label}</span>
      <div className="figure text-navy-900">{value}</div>
    </div>
  );
}

function AckButton({ id, propertyId, party, label }: { id: string; propertyId: string; party: "LANDLORD" | "TENANT"; label: string }) {
  return (
    <form action={acknowledgeMoveInOperatorAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="party" value={party} />
      <SubmitButton variant="secondary" pendingLabel="Saving…">{label}</SubmitButton>
    </form>
  );
}
