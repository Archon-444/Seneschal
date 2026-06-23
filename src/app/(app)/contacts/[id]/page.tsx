import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import { getContactDetail } from "@/server/services/contacts";
import { hasActiveMessagingConsent } from "@/server/services/consent";
import { roleHas } from "@/server/capabilities";
import { Badge, BackLink, Card, DubaiDate, EmptyState, Money, PageHeader, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import {
  grantMessagingConsentAction,
  revokeMessagingConsentAction,
  verifyLandlordAction,
  revokeLandlordVerificationAction,
} from "../../actions";

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
  const canMessage = roleHas(ctx.role, "messaging.manage");
  const messagingOptedIn = contact.phone ? await hasActiveMessagingConsent({ contactId: contact.id }) : false;
  const canVerify = roleHas(ctx.role, "landlords.verify") && contact.kind === "OWNER";
  const isVerified = !!contact.verifiedAt;

  const roleFor = (t: (typeof tenancies)[number]) =>
    t.landlordContactId === id ? "Landlord" : t.tenantContactId === id ? "Tenant" : "Party";

  return (
    <>
      <BackLink href="/contacts" label="All contacts" />
      <PageHeader
        eyebrow={contact.kind}
        title={contact.name}
        subtitle={contact.company ?? undefined}
        actions={isVerified ? <Badge value="VERIFIED LANDLORD" /> : undefined}
      />

      {canVerify && (
        <Card className="mb-6 max-w-3xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-navy-900">Landlord verification</div>
              <div className="text-xs text-muted">
                {isVerified ? (
                  <>Verified{contact.verifiedAt ? <> on <DubaiDate value={contact.verifiedAt} /></> : ""} — owns/controls the units they list.</>
                ) : (
                  "Not yet verified. Confirm identity and ownership before their listings carry the verified mark."
                )}
              </div>
            </div>
            <form action={isVerified ? revokeLandlordVerificationAction : verifyLandlordAction}>
              <input type="hidden" name="contactId" value={contact.id} />
              <SubmitButton variant={isVerified ? "secondary" : "primary"} pendingLabel="Saving…">
                {isVerified ? "Revoke verification" : "Verify landlord"}
              </SubmitButton>
            </form>
          </div>
        </Card>
      )}

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

      {canMessage && contact.phone && (
        <Card className="mb-6 max-w-3xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-navy-900">WhatsApp messaging</div>
              <div className="text-xs text-muted">
                {messagingOptedIn
                  ? "Opted in — eligible for WhatsApp where enabled. Email otherwise."
                  : "Not opted in — notifications go by email."}
              </div>
            </div>
            <form action={messagingOptedIn ? revokeMessagingConsentAction : grantMessagingConsentAction}>
              <input type="hidden" name="contactId" value={contact.id} />
              <SubmitButton variant={messagingOptedIn ? "secondary" : "primary"} pendingLabel="Saving…">
                {messagingOptedIn ? "Revoke consent" : "Record opt-in"}
              </SubmitButton>
            </form>
          </div>
        </Card>
      )}

      <h2 className="font-display mb-3 text-xl text-navy-900">Contracts</h2>
      {tenancies.length === 0 ? (
        <EmptyState title="No contracts" message="This contact is not a party to any tenancy yet." />
      ) : (
        <Table stack headers={["Role", "Property", "Term", "Rent", "Ejari"]}>
          {tenancies.map((t) => (
            <tr key={t.id}>
              <Td label="Role"><Badge value={roleFor(t).toUpperCase()} /></Td>
              <Td label="Property">
                <Link href={`/properties/${t.propertyId}`} className="text-navy-900 hover:underline">
                  {t.property.community}{t.property.unitNo ? ` · ${t.property.unitNo}` : ""}
                </Link>
              </Td>
              <Td label="Term" className="whitespace-nowrap text-xs">
                <DubaiDate value={t.startDate} /> → <DubaiDate value={t.endDate} />
              </Td>
              <Td label="Rent"><Money amount={String(t.annualRent)} /></Td>
              <Td label="Ejari" className="figure text-xs">{t.ejariNo ?? "—"}</Td>
            </tr>
          ))}
        </Table>
      )}

      {proofRequests.length > 0 && (
        <>
          <h2 className="font-display mt-8 mb-3 text-xl text-navy-900">Assigned proof requests</h2>
          <Table stack headers={["Request", "Due", "Status"]}>
            {proofRequests.map((r) => (
              <tr key={r.id}>
                <Td label="Request">
                  <Link href={`/proofs/${r.id}`} className="text-navy-900 hover:underline">{r.title}</Link>
                </Td>
                <Td label="Due">{r.dueAt ? <DubaiDate value={r.dueAt} /> : "—"}</Td>
                <Td label="Status"><Badge value={r.status} /></Td>
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
