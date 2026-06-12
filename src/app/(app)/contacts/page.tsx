import { requireCtx } from "@/server/auth/request";
import { listContacts } from "@/server/services/contacts";
import { Badge, Button, Card, EmptyState, Field, inputClass, PageHeader, Table, Td } from "@/components/ui";
import { createContactAction } from "../actions";

const KINDS = ["TENANT", "OWNER", "AGENT", "VENDOR", "CONTRACTOR", "CLIENT", "PARTNER", "BUILDING_MANAGEMENT", "ACCOUNTANT", "LAWYER", "OTHER"];

export default async function ContactsPage() {
  const ctx = await requireCtx();
  const contacts = await listContacts(ctx);

  return (
    <>
      <PageHeader title="Contacts" subtitle="Tenants, agents, vendors and counterparties" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {contacts.length === 0 ? (
            <EmptyState message="No contacts yet." />
          ) : (
            <Table headers={["Name", "Kind", "Email", "Phone"]}>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <span className="font-medium text-navy-900">{c.name}</span>
                    {c.company && <div className="text-xs text-navy-300">{c.company}</div>}
                  </Td>
                  <Td><Badge value={c.kind} /></Td>
                  <Td>{c.email ?? "—"}</Td>
                  <Td className="figure">{c.phone ?? "—"}</Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
        <Card>
          <h2 className="font-display mb-3 text-lg text-navy-900">Add contact</h2>
          <form action={createContactAction} className="space-y-3">
            <Field label="Name">
              <input name="name" required className={inputClass} />
            </Field>
            <Field label="Kind">
              <select name="kind" className={inputClass}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>{k.replace(/_/g, " ")}</option>
                ))}
              </select>
            </Field>
            <Field label="Email">
              <input name="email" type="email" className={inputClass} />
            </Field>
            <Field label="Phone">
              <input name="phone" className={inputClass} />
            </Field>
            <Field label="Company">
              <input name="company" className={inputClass} />
            </Field>
            <Button type="submit">Add</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
