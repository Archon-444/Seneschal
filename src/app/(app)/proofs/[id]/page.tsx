import { notFound } from "next/navigation";
import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { getProofRequest } from "@/server/services/proofs";
import { listSecureLinks } from "@/server/services/secureLinks";
import { listDocuments } from "@/server/services/documents";
import { listEvidence, EVIDENCE_LABELS } from "@/server/services/evidenceQuery";
import { formatDubaiDate } from "@/server/calculators/dates";
import { BackLink, Badge, Button, Card, Field, inputClass, PageHeader, resolveScopeLink, ScopeLink, Table, Td } from "@/components/ui";
import { decideProofAction, resendProofAction, revokeLinkAction } from "../../actions";

export default async function ProofDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();

  let request;
  try {
    request = await getProofRequest(ctx, id);
  } catch {
    notFound();
  }
  const [links, docs, evidence] = await Promise.all([
    listSecureLinks(ctx, "PROOF_REQUEST", id),
    listDocuments(ctx, { scopeType: "PROOF_REQUEST", scopeId: id }),
    listEvidence(ctx, { scopeType: "PROOF_REQUEST", scopeId: id }),
  ]);
  const decidable = request!.status === "SUBMITTED" || request!.status === "OVERDUE";

  return (
    <>
      <BackLink href="/proofs" label="All proof requests" />
      <PageHeader
        title={request!.title}
        subtitle={`Due ${request!.dueAt ? formatDubaiDate(request!.dueAt) : "—"}`}
        actions={
          <form action={resendProofAction}>
            <input type="hidden" name="id" value={id} />
            <Button type="submit" variant="secondary">Send new link</Button>
          </form>
        }
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

      {decidable && (
        <Card className="mb-6 max-w-3xl">
          <h2 className="font-display mb-3 text-lg text-navy-900">Review submission</h2>
          <form action={decideProofAction} className="flex items-end gap-3">
            <input type="hidden" name="id" value={id} />
            <Field label="Note">
              <input name="note" className={inputClass} />
            </Field>
            <button name="decision" value="APPROVED" className="rounded-md bg-verde-700 px-4 py-2 text-sm font-medium text-white hover:bg-verde-500">
              Approve
            </button>
            <button name="decision" value="REJECTED" className="rounded-md bg-claret-500 px-4 py-2 text-sm font-medium text-white hover:bg-claret-700">
              Reject & re-open
            </button>
          </form>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="font-display mb-3 text-lg text-navy-900">Submitted documents</h2>
          <Table headers={["File", "Uploaded"]}>
            {docs.map((d) => (
              <tr key={d.id}>
                <Td>
                  <Link href={`/vault/${d.id}`} className="text-navy-900 hover:underline">{d.fileName}</Link>
                </Td>
                <Td className="figure">{formatDubaiDate(d.createdAt)}</Td>
              </tr>
            ))}
          </Table>

          <h2 className="font-display mt-6 mb-3 text-lg text-navy-900">Secure links</h2>
          <Table headers={["Created", "Expires", "Uses", "State", ""]}>
            {links.map((l) => (
              <tr key={l.id}>
                <Td className="figure">{formatDubaiDate(l.createdAt)}</Td>
                <Td className="figure">{formatDubaiDate(l.expiresAt)}</Td>
                <Td className="figure">{l.useCount}{l.maxUses ? `/${l.maxUses}` : ""}</Td>
                <Td>
                  <Badge value={l.revokedAt ? "REJECTED" : l.expiresAt < new Date() ? "OVERDUE" : "ACTIVE"} />
                </Td>
                <Td>
                  {!l.revokedAt && (
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
          <h2 className="font-display mb-3 text-lg text-navy-900">Evidence trail</h2>
          <ol className="relative ml-3 space-y-4 border-l border-ivory-300 pl-6">
            {evidence.map((e) => (
              <li key={e.id}>
                <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-gold-500" />
                <div className="text-sm font-medium text-navy-900">{EVIDENCE_LABELS[e.type] ?? e.type}</div>
                <div className="figure text-xs text-navy-300">
                  {e.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC · {e.actorType}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </>
  );
}
