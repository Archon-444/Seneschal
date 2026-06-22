import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { listClients } from "@/server/services/clients";
import { listProperties } from "@/server/services/properties";
import { EmptyState, Field, FormSection, inputClass, PageHeader, SearchForm, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { createClientAction, generateReportAction } from "../actions";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const ctx = await requireCtx();
  const [clients, properties] = await Promise.all([listClients(ctx, { q }), listProperties(ctx)]);

  return (
    <>
      <PageHeader title="Clients" subtitle="Principals under fiduciary oversight" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SearchForm q={q} placeholder="Search clients…" />
          {clients.length === 0 ? (
            <EmptyState
              title={q ? "No matches" : "No clients yet"}
              message={q ? `No clients match “${q}”.` : "Add your first client with the form."}
            />
          ) : (
            <Table stack headers={["Client", "Properties", "Monthly report"]}>
              {clients.map((c) => (
                <tr key={c.id}>
                  <Td label="Client">
                    <Link href={`/clients/${c.id}`} className="font-medium text-navy-900 hover:underline">
                      {c.displayName}
                    </Link>
                  </Td>
                  <Td label="Properties" className="figure">
                    {properties.filter((p) => p.clientPrincipalId === c.id).length}
                  </Td>
                  <Td label="Monthly report">
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
        <FormSection title="Add client">
          <form action={createClientAction} className="space-y-3">
            <Field label="Display name" required>
              <input name="displayName" required className={inputClass} />
            </Field>
            <Field label="Notes">
              <textarea name="notes" rows={2} className={inputClass} />
            </Field>
            <SubmitButton pendingLabel="Adding…">Add</SubmitButton>
          </form>
        </FormSection>
      </div>
    </>
  );
}
