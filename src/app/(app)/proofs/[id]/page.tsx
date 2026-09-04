import { notFound } from "next/navigation";
import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { hasCapability } from "@/server/authz";
import { getProofRequest } from "@/server/services/proofs";
import { listSecureLinks } from "@/server/services/secureLinks";
import { listDocuments } from "@/server/services/documents";
import { getEvidenceTimeline } from "@/server/services/evidenceReadModel";
import { formatDubaiDate } from "@/server/calculators/dates";
import { BackLink, Badge, Card, DubaiDate, Field, inputClass, LinkButton, PageHeader, resolveScopeLink, ScopeLink, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { decideProofAction, resendProofAction, revokeLinkAction } from "../../actions";
import { EvidenceEventCard } from "@/components/evidence/EvidenceEventCard";

export default async function ProofDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const canWrite = hasCapability(ctx, "proofs.write");
  const canDecide = hasCapability(ctx, "proofs.decide");
  const canReadEvidence = hasCapability(ctx, "evidence.read");

  let request;
  try {
    request = await getProofRequest(ctx, id);
  } catch {
    notFound();
  }
  const [links, docs, evidence] = await Promise.all([
    listSecureLinks(ctx, "PROOF_REQUEST", id),
    listDocuments(ctx, { scopeType: "PROOF_REQUEST", scopeId: id }),
    canReadEvidence ? getEvidenceTimeline(ctx, { proof: id, pageSize: 100, sort: "asc" }) : Promise.resolve(null),
  ]);
  const decidable = request!.status === "SUBMITTED" || request!.status === "OVERDUE";

  return (
    <>
      <BackLink href="/proofs" label="All proof requests" />
      <PageHeader
        title={request!.title}
        subtitle={`Due ${request!.dueAt ? formatDubaiDate(request!.dueAt) : "—"}`}
        actions={canWrite ? (
          <form action={resendProofAction}>
            <input type="hidden" name="id" value={id} />
            <SubmitButton variant="secondary" pendingLabel="Sending…">Send new link</SubmitButton>
          </form>
        ) : undefined}
      />
      <Card className="mb-6 max-w-3xl">
        <div className="flex items-center gap-3">
          <Badge value={request!.status} />
          <span className="text-sm text-navy-700">{request!.requiredEvidence}</span>
        </div>
        {resolveScopeLink(request!.scopeType, request!.scopeId) && (
          <p className="mt-2 text-sm text-muted">
            Scope: <ScopeLink scopeType={request!.scopeType} scopeId={request!.scopeId} />
          </p>
        )}
        {request!.decisionNote && (
          <p className="mt-2 text-sm text-navy-500">Decision note: {request!.decisionNote}</p>
        )}
      </Card>

      {decidable && canDecide && (
        <Card className="mb-6 max-w-3xl">
          <h2 className="mb-3 text-[15px] font-semibold text-navy-900">Review submission</h2>
          <form action={decideProofAction} className="flex items-end gap-3">
            <input type="hidden" name="id" value={id} />
            <Field label="Note">
              <input name="note" className={inputClass} />
            </Field>
            <button name="decision" value="APPROVED" className="rounded bg-verde-700 px-4 py-2 text-sm font-medium text-white hover:bg-verde-500">
              Approve
            </button>
            <button name="decision" value="REJECTED" className="rounded bg-claret-500 px-4 py-2 text-sm font-medium text-white hover:bg-claret-700">
              Reject & re-open
            </button>
          </form>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-[15px] font-semibold text-navy-900">Submitted documents</h2>
          <Table stack headers={["File", "Uploaded"]}>
            {docs.map((d) => (
              <tr key={d.id}>
                <Td label="File">
                  <Link href={`/vault/${d.id}`} className="text-navy-900 hover:underline">{d.fileName}</Link>
                </Td>
                <Td label="Uploaded"><DubaiDate value={d.createdAt} /></Td>
              </tr>
            ))}
          </Table>

          <h2 className="font-semibold mt-6 mb-3 text-lg text-navy-900">Secure links</h2>
          <Table stack headers={["Created", "Expires", "Uses", "State", ""]}>
            {links.map((l) => (
              <tr key={l.id}>
                <Td label="Created"><DubaiDate value={l.createdAt} /></Td>
                <Td label="Expires"><DubaiDate value={l.expiresAt} /></Td>
                <Td label="Uses" className="figure">{l.useCount}{l.maxUses ? `/${l.maxUses}` : ""}</Td>
                <Td label="State">
                  <Badge value={l.revokedAt ? "REJECTED" : l.expiresAt < new Date() ? "OVERDUE" : "ACTIVE"} />
                </Td>
                <Td>
                  {!l.revokedAt && canWrite && (
                    <form action={revokeLinkAction}>
                      <input type="hidden" name="linkId" value={l.id} />
                      <input type="hidden" name="proofId" value={id} />
                      <button className="text-xs text-claret-500 hover:underline">Revoke</button>
                    </form>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
          <p className="mt-2 text-xs text-navy-300">Tokens are never stored or shown again — only hashes.</p>
        </div>
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-semibold text-navy-900">Evidence trail</h2>
            {canReadEvidence && <LinkButton href={`/evidence?proof=${id}`}>Open filtered evidence</LinkButton>}
          </div>
          {!canReadEvidence || !evidence ? (
            <p className="text-sm text-muted">Your role can review the proof request, but the evidence ledger requires evidence-read access.</p>
          ) : evidence.events.length === 0 ? (
            <p className="text-sm text-muted">No proof evidence is recorded yet.</p>
          ) : (
            <ol className="space-y-4">{evidence.events.map((event) => <li key={event.id}><EvidenceEventCard event={event} /></li>)}</ol>
          )}
        </div>
      </div>
    </>
  );
}
