import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { listProofRequests } from "@/server/services/proofs";
import { listContacts } from "@/server/services/contacts";
import { listClients } from "@/server/services/clients";
import { listProperties } from "@/server/services/properties";
import { Badge, DubaiDate, EmptyState, Field, FormSection, inputClass, PageHeader, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
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
            <EmptyState
              title="No proof requests yet"
              message="Create one to start collecting evidence — the other side needs no account."
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
                  <Td label="Assignee">{contactName(r.assignedContactId)}</Td>
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
        <FormSection title="New proof request">
          <form action={createProofRequestAction} className="space-y-3">
            <Field label="Title" required>
              <input name="title" required className={inputClass} placeholder="Upload proof: cheque 4 received" />
            </Field>
            <Field label="Required evidence" required>
              <textarea
                name="requiredEvidence"
                required
                rows={2}
                className={inputClass}
                placeholder="Photo of deposit slip or bank confirmation"
              />
            </Field>
            <Field label="Related to" required>
              {/* every proof request carries a resolvable scope so client-scoped
                  viewers and reports can see it (Codex P2 on PR #2) */}
              <select name="scope" required className={inputClass}>
                <option value="">Select…</option>
                {clients.map((c) => (
                  <option key={c.id} value={`CLIENT:${c.id}`}>
                    Client — {c.displayName}
                  </option>
                ))}
                {properties.map((p) => (
                  <option key={p.id} value={`PROPERTY:${p.id}`}>
                    Property — {p.community}
                    {p.unitNo ? ` · ${p.unitNo}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Assign to contact" required>
              <select name="assignedContactId" required className={inputClass}>
                <option value="">Select…</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.kind})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Due date">
              <input name="dueAt" type="date" className={inputClass} />
            </Field>
            <SubmitButton pendingLabel="Creating…">Create &amp; send secure link</SubmitButton>
          </form>
        </FormSection>
      </div>
    </>
  );
}
