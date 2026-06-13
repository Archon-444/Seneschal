import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import { getProperty } from "@/server/services/properties";
import { listDocuments } from "@/server/services/documents";
import { listEvidence, EVIDENCE_LABELS } from "@/server/services/evidenceQuery";
import { formatDubaiDate } from "@/server/calculators/dates";
import { Badge, Card, EmptyState, LinkButton, Money, PageHeader, Table, Td } from "@/components/ui";
import { PaymentRow } from "./PaymentRow";
import { UploadForm } from "./UploadForm";

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
    listEvidence(ctx, { propertyId: id, limit: 100 }),
  ]);
  const tenancyFull = tenancy
    ? await import("@/server/services/tenancies").then((m) => m.getTenancy(ctx, tenancy.id))
    : null;

  const title = `${property!.community}${property!.building ? ` · ${property!.building}` : ""}${property!.unitNo ? ` · ${property!.unitNo}` : ""}`;

  return (
    <>
      <PageHeader
        title={title}
        subtitle={`${property!.propertyType ?? "property"}${property!.bedrooms != null ? ` · ${property!.bedrooms || "Studio"} BR` : ""}`}
        actions={!tenancy ? <LinkButton href={`/tenancies/new?propertyId=${id}`} variant="primary">Add tenancy</LinkButton> : undefined}
      />

      {(property!.usage || property!.makaniNo || property!.dewaPremiseNo || property!.plotNo || property!.sizeSqm) && (
        <div className="mb-6 flex flex-wrap gap-x-8 gap-y-2 rounded-lg border border-line bg-ivory-100 px-4 py-3 text-sm">
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
                <span className="figure">{formatDubaiDate(tenancyFull.startDate)} → {formatDubaiDate(tenancyFull.endDate)}</span>
              </Detail>
              <Detail label="Annual rent"><Money amount={String(tenancyFull.annualRent)} /></Detail>
              <Detail label="Deposit">{tenancyFull.depositAmount ? <Money amount={String(tenancyFull.depositAmount)} /> : "—"}</Detail>
              <Detail label="Ejari">
                {tenancyFull.ejariNo ?? <span className="text-claret-500">missing</span>}
              </Detail>
              <Detail label="Notice period">
                <span className="figure">{tenancyFull.noticePeriodDays} days</span>
                {tenancyFull.noticePeriodDays !== 90 && (
                  <span className="ml-1 text-xs text-gold-700">(contract override)</span>
                )}
              </Detail>
            </div>
            <h3 className="font-display mt-6 mb-2 text-lg text-navy-900">Open deadlines</h3>
            <Table headers={["Due", "Kind", "Rule"]}>
              {tenancyFull.deadlines.map((d) => (
                <tr key={d.id}>
                  <Td className="figure whitespace-nowrap">{formatDubaiDate(d.dueAt)}</Td>
                  <Td><Badge value={d.kind} /></Td>
                  <Td className="text-xs text-navy-300">
                    {(d.computedFrom as { rule?: string } | null)?.rule ?? "—"}
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        ) : (
          <EmptyState message="No active tenancy. Add one to generate the deadline calendar." />
        )
      )}

      {tab === "payments" && (
        tenancyFull ? (
          <>
            <Table headers={["#", "Due", "Amount", "Instrument", "Cheque no", "Bank", "Status", "Actions"]}>
              {tenancyFull.paymentItems.map((item) => (
                <PaymentRow key={item.id} item={{
                  id: item.id,
                  seq: item.seq,
                  dueDate: formatDubaiDate(item.dueDate),
                  amount: String(item.amount),
                  instrument: item.instrument,
                  chequeNo: item.chequeNo,
                  bank: item.bank,
                  status: item.status,
                }} propertyId={id} />
              ))}
            </Table>
            <p className="mt-3 text-xs text-navy-300">
              Record-keeping only — Seneschal never holds funds.
            </p>
          </>
        ) : (
          <EmptyState message="No tenancy — no payment schedule." />
        )
      )}

      {tab === "documents" && (
        <div className="space-y-6">
          <UploadForm scopeType={tenancy ? "TENANCY" : "PROPERTY"} scopeId={tenancy?.id ?? id} back={`/properties/${id}?tab=documents`} />
          {docs.length === 0 ? (
            <EmptyState message="No documents on file for this property." />
          ) : (
            <Table headers={["File", "Kind", "Uploaded", "SHA-256"]}>
              {docs.map((d) => (
                <tr key={d.id}>
                  <Td>
                    <Link href={`/vault/${d.id}`} className="text-navy-900 hover:underline">{d.fileName}</Link>
                  </Td>
                  <Td><Badge value={d.kind} /></Td>
                  <Td className="figure whitespace-nowrap">{formatDubaiDate(d.createdAt)}</Td>
                  <Td className="figure text-xs text-navy-300">{d.sha256.slice(0, 16)}…</Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      )}

      {tab === "evidence" && (
        evidence.length === 0 ? (
          <EmptyState message="No evidence recorded yet." />
        ) : (
          <ol className="relative ml-3 space-y-4 border-l border-ivory-300 pl-6">
            {evidence.map((e) => (
              <li key={e.id}>
                <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-gold-500" />
                <div className="text-sm font-medium text-navy-900">
                  {EVIDENCE_LABELS[e.type] ?? e.type}
                </div>
                <div className="figure text-xs text-navy-300">
                  {e.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC · {e.actorType}
                </div>
              </li>
            ))}
          </ol>
        )
      )}
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-navy-300">{label}</div>
      <div className="mt-0.5 text-navy-900">{children}</div>
    </div>
  );
}

function AssetFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      <div className="figure text-navy-900">{value}</div>
    </div>
  );
}
