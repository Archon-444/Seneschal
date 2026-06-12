import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { listProofRequests } from "@/server/services/proofs";
import { listContacts } from "@/server/services/contacts";
import { listClients } from "@/server/services/clients";
import { listProperties } from "@/server/services/properties";
import { formatDubaiDate } from "@/server/calculators/dates";
import { Badge, Button, Card, EmptyState, Field, inputClass, PageHeader, Table, Td } from "@/components/ui";
import { createProofRequestAction } from "../actions";

export default async function ProofsPage() {
  const ctx = await requireCtx();
  const [requests, contacts, clients, properties] = await Promise.all([
    listProofRequests(ctx),
    listContacts(ctx),
    listClients(ctx),
    listProperties(ctx),
  ]);
  const contactName = (id: string) => contacts.find((c) => c.id === id)?.name ?? "—";

  return (
    <>
      <PageHeader title="Proof requests" subtitle="Ask for evidence; the other side needs no account" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {requests.length === 0 ? (
            <EmptyState message="No proof requests yet. Create one to start collecting evidence." />
          ) : (
            <Table headers={["Request", "Assignee", "Due", "Status"]}>
              {requests.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <Link href={`/proofs/${r.id}`} className="font-medium text-navy-900 hover:underline">
                      {r.title}
                    </Link>
                  </Td>
                  <Td>{contactName(r.assignedContactId)}</Td>
                  <Td className="figure whitespace-nowrap">{r.dueAt ? formatDubaiDate(r.dueAt) : "—"}</Td>
                  <Td><Badge value={r.status} /></Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
        <Card>
          <h2 className="font-display mb-3 text-lg text-navy-900">New proof request</h2>
          <form action={createProofRequestAction} className="space-y-3">
            <Field label="Title">
              <input name="title" required className={inputClass} placeholder="Upload proof: cheque 4 received" />
            </Field>
            <Field label="Required evidence">
              <textarea name="requiredEvidence" required rows={2} className={inputClass} placeholder="Photo of deposit slip or bank confirmation" />
            </Field>
            <Field label="Related to">
              {/* every proof request carries a resolvable scope so client-scoped
                  viewers and reports can see it (Codex P2 on PR #2) */}
              <select name="scope" required className={inputClass}>
                <option value="">Select…</option>
                {clients.map((c) => (
                  <option key={c.id} value={`CLIENT:${c.id}`}>Client — {c.displayName}</option>
                ))}
                {properties.map((p) => (
                  <option key={p.id} value={`PROPERTY:${p.id}`}>
                    Property — {p.community}{p.unitNo ? ` · ${p.unitNo}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Assign to contact">
              <select name="assignedContactId" required className={inputClass}>
                <option value="">Select…</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.kind})</option>
                ))}
              </select>
            </Field>
            <Field label="Due date">
              <input name="dueAt" type="date" className={inputClass} />
            </Field>
            <Button type="submit">Create & send secure link</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
