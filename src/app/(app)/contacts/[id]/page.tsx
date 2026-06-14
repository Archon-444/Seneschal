import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import { getContactDetail } from "@/server/services/contacts";
import { formatDubaiDate } from "@/server/calculators/dates";
import { Badge, BackLink, Card, EmptyState, Money, PageHeader, Table, Td } from "@/components/ui";

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();

  let detail;
  try {
    detail = await getContactDetail(ctx, id);
  } catch {
    notFound();
  }
  const { contact, tenancies, proofRequests } = detail!;

  const roleFor = (t: (typeof tenancies)[number]) =>
    t.landlordContactId === id ? "Landlord" : t.tenantContactId === id ? "Tenant" : "Party";

  return (
    <>
      <BackLink href="/contacts" label="All contacts" />
      <PageHeader eyebrow={contact.kind} title={contact.name} subtitle={contact.company ?? undefined} />

      <Card className="mb-6 max-w-3xl">
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm lg:grid-cols-3">
          <Detail label="Emirates ID">{contact.emiratesId ?? "—"}</Detail>
          <Detail label="Nationality">{contact.nationality ?? "—"}</Detail>
          <Detail label="Email">{contact.email ?? "—"}</Detail>
          <Detail label="Phone"><span className="figure">{contact.phone ?? "—"}</span></Detail>
          <Detail label="License no">{contact.licenseNo ?? "—"}</Detail>
          <Detail label="Licensing authority">{contact.licensingAuthority ?? "—"}</Detail>
        </div>
        {contact.notes && <p className="mt-4 text-sm text-muted">{contact.notes}</p>}
      </Card>

      <h2 className="font-display mb-3 text-xl text-navy-900">Contracts</h2>
      {tenancies.length === 0 ? (
        <EmptyState message="This contact is not a party to any tenancy yet." />
      ) : (
        <Table headers={["Role", "Property", "Term", "Rent", "Ejari"]}>
          {tenancies.map((t) => (
            <tr key={t.id}>
              <Td><Badge value={roleFor(t).toUpperCase()} /></Td>
              <Td>
                <Link href={`/properties/${t.propertyId}`} className="text-navy-900 hover:underline">
                  {t.property.community}{t.property.unitNo ? ` · ${t.property.unitNo}` : ""}
                </Link>
              </Td>
              <Td className="figure whitespace-nowrap text-xs">
                {formatDubaiDate(t.startDate)} → {formatDubaiDate(t.endDate)}
              </Td>
              <Td><Money amount={String(t.annualRent)} /></Td>
              <Td className="figure text-xs">{t.ejariNo ?? "—"}</Td>
            </tr>
          ))}
        </Table>
      )}

      {proofRequests.length > 0 && (
        <>
          <h2 className="font-display mt-8 mb-3 text-xl text-navy-900">Assigned proof requests</h2>
          <Table headers={["Request", "Due", "Status"]}>
            {proofRequests.map((r) => (
              <tr key={r.id}>
                <Td>
                  <Link href={`/proofs/${r.id}`} className="text-navy-900 hover:underline">{r.title}</Link>
                </Td>
                <Td className="figure">{r.dueAt ? formatDubaiDate(r.dueAt) : "—"}</Td>
                <Td><Badge value={r.status} /></Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-navy-900">{children}</div>
    </div>
  );
}
