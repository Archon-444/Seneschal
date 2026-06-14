import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import { getDocument, getDocumentAccessLog, getDocumentUrl } from "@/server/services/documents";
import { Badge, BackLink, Card, LinkButton, PageHeader, resolveScopeLink, ScopeLink, Table, Td } from "@/components/ui";

export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();

  let doc;
  try {
    doc = await getDocument(ctx, id);
  } catch {
    notFound();
  }
  const [{ url }, log] = await Promise.all([getDocumentUrl(ctx, id), getDocumentAccessLog(ctx, id)]);

  return (
    <>
      <BackLink href="/vault" label="Document vault" />
      <PageHeader
        title={doc!.fileName}
        subtitle={`${doc!.kind.replace(/_/g, " ")} · ${(doc!.sizeBytes / 1024).toFixed(1)} KB`}
        actions={<LinkButton href={url} variant="primary">Download (signed link, 5 min)</LinkButton>}
      />
      {resolveScopeLink(doc!.scopeType, doc!.scopeId) && (
        <p className="mb-6 text-sm text-muted">
          Belongs to: <ScopeLink scopeType={doc!.scopeType} scopeId={doc!.scopeId} />
        </p>
      )}
      <Card className="mb-6 max-w-2xl">
        <div className="text-xs font-medium uppercase tracking-wide text-navy-300">SHA-256 at ingest</div>
        <div className="figure mt-1 break-all text-sm text-navy-700">{doc!.sha256}</div>
      </Card>

      <h2 className="font-display mb-3 text-xl text-navy-900">Access log</h2>
      <Table headers={["When (UTC)", "Action", "Actor", "Via link", "IP"]}>
        {log.map((entry) => (
          <tr key={entry.id}>
            <Td className="figure whitespace-nowrap">
              {entry.createdAt.toISOString().replace("T", " ").slice(0, 19)}
            </Td>
            <Td><Badge value={entry.action} /></Td>
            <Td className="text-xs">{entry.actorUserId ?? "—"}</Td>
            <Td className="text-xs">{entry.secureLinkId ? "yes" : "—"}</Td>
            <Td className="figure text-xs">{entry.ip ?? "—"}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
