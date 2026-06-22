import { requireCtx } from "@/server/auth/request";
import { listClients } from "@/server/services/clients";
import { Field, FormActions, FormGrid, FormSection, inputClass, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { createPropertyAction } from "../../actions";

export default async function NewPropertyPage() {
  const ctx = await requireCtx();
  const clients = await listClients(ctx);

  return (
    <>
      <PageHeader
        title="Add property"
        subtitle="Register a unit under a client to track its tenancy, payments and deadlines."
      />
      <form action={createPropertyAction} className="max-w-2xl">
        <FormSection eyebrow="Property details">
          <FormGrid>
            <Field label="Client" required>
              <select name="clientPrincipalId" className={inputClass} required>
                <option value="">Select client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Community" required>
              <input name="community" required className={inputClass} placeholder="Dubai Marina" />
            </Field>
            <Field label="Building">
              <input name="building" className={inputClass} placeholder="Marina Gate 1" />
            </Field>
            <Field label="Unit no">
              <input name="unitNo" className={inputClass} placeholder="1203" />
            </Field>
            <Field label="Type">
              <select name="propertyType" className={inputClass}>
                <option value="apartment">Apartment</option>
                <option value="villa">Villa</option>
                <option value="office">Office</option>
                <option value="">Other</option>
              </select>
            </Field>
            <Field label="Bedrooms">
              <input name="bedrooms" type="number" min="0" className={inputClass} placeholder="2" />
            </Field>
            <Field label="Size (sqft)" hint="Optional — used for benchmark comparisons.">
              <input name="sizeSqft" type="number" min="0" className={inputClass} />
            </Field>
          </FormGrid>
          <FormActions>
            <SubmitButton pendingLabel="Creating…">Create property</SubmitButton>
          </FormActions>
        </FormSection>
      </form>
    </>
  );
}
