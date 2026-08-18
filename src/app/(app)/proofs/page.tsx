import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { hasCapability } from "@/server/authz";
import { listProofRequests, proofRequestOptions } from "@/server/services/proofs";
import { Badge, DubaiDate, EmptyState, PageHeader, Table, Td } from "@/components/ui";
import { ProofRequestForm } from "./ProofRequestForm";

export default async function ProofsPage() {
  const ctx = await requireCtx();
  const canWrite = hasCapability(ctx, "proofs.write");
  const [requests, options] = await Promise.all([
    listProofRequests(ctx),
    canWrite ? proofRequestOptions(ctx) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader title="Proof requests" subtitle="Ask for evidence; the other side needs no account" />
      <div className={canWrite ? "grid gap-6 lg:grid-cols-3" : "max-w-5xl"}>
        <div className={canWrite ? "lg:col-span-2" : undefined}>
          {requests.length === 0 ? (
            <EmptyState
              title="No proof requests yet"
              message={canWrite
                ? "Create one to start collecting evidence — the other side needs no account."
                : "No proof requests are visible in your assigned scope."}
            />
          ) : (
            <Table stack headers={["Request", "Assignee", "Due", "Status"]}>
              {requests.map((r) => (
                <tr key={r.id}>
                  <Td label="Request">
                    <Link href={`/proofs/${r.id}`} className="font-medium text-navy-900 hover:underline">
                      {r.title}
                    </Link>
                  </Td>
                  <Td label="Assignee">{r.assignedContactName}</Td>
                  <Td label="Due" className="whitespace-nowrap">
                    {r.dueAt ? <DubaiDate value={r.dueAt} /> : "—"}
                  </Td>
                  <Td label="Status">
                    <Badge value={r.status} />
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
        {canWrite && <ProofRequestForm options={options} />}
      </div>
    </>
  );
}
