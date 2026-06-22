import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { listDocuments } from "@/server/services/documents";
import { Badge, DubaiDate, EmptyState, PageHeader, Table, Td } from "@/components/ui";
import { UploadForm } from "../properties/[id]/UploadForm";
import { archiveDocumentAction } from "../actions";

export default async function VaultPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; archived?: string }>;
}) {
  const { kind, archived } = await searchParams;
  const ctx = await requireCtx();
  const docs = await listDocuments(ctx, {
    kind: kind as never,
    includeArchived: archived === "1",
  });

  return (
    <>
      <PageHeader
        title="Document vault"
        subtitle="Private storage · SHA-256 verified · every access logged"
      />
      <div className="mb-6">
        <UploadForm scopeType="WORKSPACE" scopeId={ctx.workspaceId} back="/vault" />
      </div>
      <div className="mb-3 text-sm">
        <Link href="/vault" className={!archived ? "font-medium text-navy-900" : "text-navy-500"}>
          Active
        </Link>
        <span className="mx-2 text-navy-300">·</span>
        <Link href="/vault?archived=1" className={archived ? "font-medium text-navy-900" : "text-navy-500"}>
          Include archived
        </Link>
      </div>
      {docs.length === 0 ? (
        <EmptyState
          title="The vault is empty"
          message="Upload a document above — every file is SHA-256 verified and every access logged."
        />
      ) : (
        <Table stack headers={["File", "Kind", "Scope", "Uploaded", "Size", ""]}>
          {docs.map((d) => (
            <tr key={d.id} className={d.archivedAt ? "opacity-50" : ""}>
              <Td label="File">
                <Link href={`/vault/${d.id}`} className="font-medium text-navy-900 hover:underline">
                  {d.fileName}
                </Link>
                <div className="figure text-xs text-navy-300">{d.sha256.slice(0, 16)}…</div>
              </Td>
              <Td label="Kind">
                <Badge value={d.kind} />
              </Td>
              <Td label="Scope" className="text-xs">
                {d.scopeType}
              </Td>
              <Td label="Uploaded" className="whitespace-nowrap">
                <DubaiDate value={d.createdAt} />
              </Td>
              <Td label="Size" className="figure">
                {(d.sizeBytes / 1024).toFixed(1)} KB
              </Td>
              <Td>
                {!d.archivedAt && (
                  <form action={archiveDocumentAction}>
                    <input type="hidden" name="id" value={d.id} />
                    <button className="text-xs text-navy-300 hover:text-claret-500">Archive</button>
                  </form>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
