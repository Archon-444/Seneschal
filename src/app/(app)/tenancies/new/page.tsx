import { requireCtx } from "@/server/auth/request";
import { getProperty } from "@/server/services/properties";
import { listContacts } from "@/server/services/contacts";
import { Field, FormActions, FormGrid, FormSection, inputClass, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { createTenancyAction } from "../../actions";

export default async function NewTenancyPage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string }>;
}) {
  const { propertyId } = await searchParams;
  const ctx = await requireCtx();
  if (!propertyId)
    return <PageHeader title="Pick a property first" subtitle="Open a property and choose Add tenancy." />;
  const property = await getProperty(ctx, propertyId);
  const contacts = await listContacts(ctx);

  return (
    <>
      <PageHeader
        title="New tenancy"
        subtitle={`${property!.community}${property!.unitNo ? ` · ${property!.unitNo}` : ""}`}
      />
      <form action={createTenancyAction} className="max-w-2xl space-y-6">
        <input type="hidden" name="propertyId" value={propertyId} />
        <FormSection eyebrow="Term & rent">
          <FormGrid>
            <Field label="Start date" required>
              <input name="startDate" type="date" required className={inputClass} />
            </Field>
            <Field label="End date" required>
              <input name="endDate" type="date" required className={inputClass} />
            </Field>
            <Field label="Annual rent (AED)" required>
              <input name="annualRent" type="number" min="0" step="0.01" required className={inputClass} />
            </Field>
            <Field label="Deposit (AED)">
              <input name="depositAmount" type="number" min="0" step="0.01" className={inputClass} />
            </Field>
            <Field label="Ejari no" hint="Leave empty if not yet registered.">
              <input name="ejariNo" className={inputClass} />
            </Field>
            <Field label="Notice period (days)" hint="Default 90; set per the contract.">
              <input name="noticePeriodDays" type="number" min="1" defaultValue="90" className={inputClass} />
            </Field>
          </FormGrid>
        </FormSection>
        <FormSection eyebrow="Parties">
          <FormGrid>
            <Field label="Tenant contact">
              <select name="tenantContactId" className={inputClass}>
                <option value="">—</option>
                {contacts
                  .filter((c) => c.kind === "TENANT")
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Landlord contact">
              <select name="landlordContactId" className={inputClass}>
                <option value="">—</option>
                {contacts
                  .filter((c) => c.kind === "OWNER" || c.kind === "CLIENT")
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </Field>
          </FormGrid>
          <FormActions note="Notice gate, expiry and renewal dates are rule-based calculations — review before action.">
            <SubmitButton pendingLabel="Creating…">Create tenancy &amp; generate deadlines</SubmitButton>
          </FormActions>
        </FormSection>
      </form>
    </>
  );
}
