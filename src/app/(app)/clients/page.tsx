import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { listClients } from "@/server/services/clients";
import { listProperties } from "@/server/services/properties";
import { Button, Card, EmptyState, Field, inputClass, PageHeader, Table, Td } from "@/components/ui";
import { createClientAction, generateReportAction } from "../actions";

export default async function ClientsPage() {
  const ctx = await requireCtx();
  const [clients, properties] = await Promise.all([listClients(ctx), listProperties(ctx)]);

  return (
    <>
      <PageHeader title="Clients" subtitle="Principals under fiduciary oversight" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {clients.length === 0 ? (
            <EmptyState message="No clients yet." />
          ) : (
            <Table headers={["Client", "Properties", "Monthly report"]}>
              {clients.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <Link href={`/clients/${c.id}`} className="font-medium text-navy-900 hover:underline">
                      {c.displayName}
                    </Link>
                  </Td>
                  <Td className="figure">
                    {properties.filter((p) => p.clientPrincipalId === c.id).length}
                  </Td>
                  <Td>
                    <form action={generateReportAction}>
                      <input type="hidden" name="clientPrincipalId" value={c.id} />
                      <button className="text-sm text-navy-500 underline-offset-2 hover:text-navy-900 hover:underline">
                        Generate
                      </button>
                    </form>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </div>
        <Card>
          <h2 className="font-display mb-3 text-lg text-navy-900">Add client</h2>
          <form action={createClientAction} className="space-y-3">
            <Field label="Display name">
              <input name="displayName" required className={inputClass} />
            </Field>
            <Field label="Notes">
              <textarea name="notes" rows={2} className={inputClass} />
            </Field>
            <Button type="submit">Add</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
