import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import { listListings } from "@/server/services/listings";
import { listProperties } from "@/server/services/properties";
import { Badge, EmptyState, Field, FormSection, inputClass, Money, PageHeader, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { createListingAction } from "./actions";

// Landlord listings index (1B). LANDLORD-only; the persona layout already bars
// operators, but a TENANT persona has no listings surface — send them home rather
// than tripping the capability error in listListings.
export default async function ListingsPage() {
  const ctx = await requireCtx();
  if (ctx.role !== "LANDLORD") redirect("/portal");

  const [rows, properties] = await Promise.all([listListings(ctx), listProperties(ctx)]);
  const vacant = properties.filter((p) => p.tenancies.length === 0);

  return (
    <>
      <PageHeader
        eyebrow="Supply"
        title="Listings"
        subtitle="Market your vacant units. Each listing carries a readiness score — a unit can only be published once it clears the gate (a valid RERA permit is mandatory). Seneschal never holds funds."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {rows.length === 0 ? (
            <EmptyState title="No listings yet" message="Create one from an owned vacant unit to start." />
          ) : (
            <Table stack headers={["Unit", "Asking rent", "Readiness", "Status"]}>
              {rows.map((l) => (
                <tr key={l.id}>
                  <Td label="Unit">
                    <Link href={`/portal/listings/${l.id}`} className="font-medium text-navy-900 hover:underline">
                      {propertyLabel(l.property)}
                    </Link>
                    {l.headline ? <div className="text-xs text-muted">{l.headline}</div> : null}
                  </Td>
                  <Td label="Asking rent">
                    {l.askingRent != null ? <Money amount={String(l.askingRent)} /> : "—"}
                  </Td>
                  <Td label="Readiness" className="figure">
                    {l.readinessScore ?? 0}/100
                  </Td>
                  <Td label="Status">
                    <Badge value={l.status} />
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </div>

        <FormSection title="New listing">
          {vacant.length === 0 ? (
            <p className="text-sm text-muted">
              All your units are currently occupied. Listings are for vacant units; one becomes available
              when its tenancy ends.
            </p>
          ) : (
            <form action={createListingAction} className="space-y-3">
              <Field label="Vacant unit" required>
                <select name="propertyId" required className={inputClass}>
                  <option value="">Select…</option>
                  {vacant.map((p) => (
                    <option key={p.id} value={p.id}>
                      {propertyLabel(p)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Headline">
                <input name="headline" className={inputClass} placeholder="Bright 2BR with Marina view" />
              </Field>
              <Field label="Asking rent (AED / year)">
                <input name="askingRent" type="number" min="0" className={inputClass} placeholder="95000" />
              </Field>
              <SubmitButton pendingLabel="Creating…">Create draft</SubmitButton>
            </form>
          )}
        </FormSection>
      </div>
    </>
  );
}

function propertyLabel(p: { community: string; building: string | null; unitNo: string | null }): string {
  return [p.building, p.unitNo ? `Unit ${p.unitNo}` : null, p.community].filter(Boolean).join(" · ");
}
