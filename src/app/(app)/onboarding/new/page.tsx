import { requireCtx } from "@/server/auth/request";
import { listContacts } from "@/server/services/contacts";
import { listClients } from "@/server/services/clients";
import { listProperties } from "@/server/services/properties";
import { Field, FormGrid, FormSection, inputClass, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { onboardTenancyAction } from "../../actions";

// Combined onboarding (Ejari-shaped): one screen creates landlord + tenant +
// asset + tenancy. Each party/asset can reuse an existing record (pick from the
// dropdown) or be created new (fill the fields below). Most fields optional.

export default async function OnboardingPage() {
  const ctx = await requireCtx();
  const [contacts, clients, properties] = await Promise.all([
    listContacts(ctx),
    listClients(ctx),
    listProperties(ctx),
  ]);
  const owners = contacts.filter((c) => c.kind === "OWNER" || c.kind === "CLIENT");
  const tenants = contacts.filter((c) => c.kind === "TENANT");

  return (
    <>
      <PageHeader
        eyebrow="Onboarding"
        title="New tenancy from Ejari"
        subtitle="Capture the landlord, tenant, asset and contract in one pass. Reuse an existing record from a dropdown, or fill the fields to create a new one. Only the contract dates and rent are required."
      />
      <form action={onboardTenancyAction} className="max-w-3xl space-y-6">
        <FormSection eyebrow="Landlord · owner / lessor">
          <Field label="Use existing contact">
            <select name="landlordContactId" className={inputClass}>
              <option value="">— create new below —</option>
              {owners.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.emiratesId ? ` · ${c.emiratesId}` : ""}</option>
              ))}
            </select>
          </Field>
          <FormGrid className="mt-4">
            <Field label="Owner name"><input name="ll_name" className={inputClass} placeholder="Bassam Rizk" /></Field>
            <Field label="Emirates ID"><input name="ll_emiratesId" className={inputClass} placeholder="784-…" /></Field>
            <Field label="Email"><input name="ll_email" type="email" className={inputClass} /></Field>
            <Field label="Phone"><input name="ll_phone" className={inputClass} /></Field>
            <Field label="Nationality"><input name="ll_nationality" className={inputClass} /></Field>
            <Field label="Company (if any)"><input name="ll_company" className={inputClass} /></Field>
            <Field label="License no (company)"><input name="ll_licenseNo" className={inputClass} /></Field>
            <Field label="Licensing authority"><input name="ll_licensingAuthority" className={inputClass} /></Field>
          </FormGrid>
        </FormSection>

        <FormSection eyebrow="Tenant">
          <Field label="Use existing contact">
            <select name="tenantContactId" className={inputClass}>
              <option value="">— create new below —</option>
              {tenants.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.emiratesId ? ` · ${c.emiratesId}` : ""}</option>
              ))}
            </select>
          </Field>
          <FormGrid className="mt-4">
            <Field label="Tenant name"><input name="tn_name" className={inputClass} /></Field>
            <Field label="Emirates ID"><input name="tn_emiratesId" className={inputClass} placeholder="784-…" /></Field>
            <Field label="Email"><input name="tn_email" type="email" className={inputClass} /></Field>
            <Field label="Phone"><input name="tn_phone" className={inputClass} /></Field>
            <Field label="Nationality"><input name="tn_nationality" className={inputClass} /></Field>
            <Field label="Company (if any)"><input name="tn_company" className={inputClass} /></Field>
            <Field label="License no (company)"><input name="tn_licenseNo" className={inputClass} /></Field>
            <Field label="Licensing authority"><input name="tn_licensingAuthority" className={inputClass} /></Field>
          </FormGrid>
        </FormSection>

        <FormSection eyebrow="Asset · property">
          <Field label="Use existing property">
            <select name="propertyId" className={inputClass}>
              <option value="">— create new below —</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.community}{p.building ? ` · ${p.building}` : ""}{p.unitNo ? ` · ${p.unitNo}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <FormGrid className="mt-4">
            <Field label="Client">
              <select name="pr_clientPrincipalId" className={inputClass}>
                <option value="">—</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.displayName}</option>
                ))}
              </select>
            </Field>
            <Field label="Usage">
              <select name="pr_usage" className={inputClass}>
                <option value="">—</option>
                <option>Residential</option>
                <option>Commercial</option>
                <option>Industrial</option>
              </select>
            </Field>
            <Field label="Community / location"><input name="pr_community" className={inputClass} placeholder="Al Barsha South Fifth" /></Field>
            <Field label="Building name"><input name="pr_building" className={inputClass} placeholder="JV-T08K2VS014" /></Field>
            <Field label="Property / unit no"><input name="pr_unitNo" className={inputClass} placeholder="8K14" /></Field>
            <Field label="Property type"><input name="pr_propertyType" className={inputClass} placeholder="2 Bed Villa + Maid" /></Field>
            <Field label="Bedrooms"><input name="pr_bedrooms" type="number" min="0" className={inputClass} /></Field>
            <Field label="Area (s.m)"><input name="pr_sizeSqm" type="number" min="0" step="0.01" className={inputClass} placeholder="657.54" /></Field>
            <Field label="Plot no"><input name="pr_plotNo" className={inputClass} /></Field>
            <Field label="Makani no"><input name="pr_makaniNo" className={inputClass} /></Field>
            <Field label="DEWA premises no"><input name="pr_dewaPremiseNo" className={inputClass} placeholder="684-00541-7" /></Field>
          </FormGrid>
        </FormSection>

        <FormSection eyebrow="Contract">
          <FormGrid>
            <Field label="Ejari no"><input name="ejariNo" className={inputClass} /></Field>
            <Field label="Notice period (days)"><input name="noticePeriodDays" type="number" min="1" defaultValue="90" className={inputClass} /></Field>
            <Field label="Start date" required><input name="startDate" type="date" required className={inputClass} /></Field>
            <Field label="End date" required><input name="endDate" type="date" required className={inputClass} /></Field>
            <Field label="Annual rent (AED)" required><input name="annualRent" type="number" min="0" step="0.01" required className={inputClass} /></Field>
            <Field label="Security deposit (AED)"><input name="depositAmount" type="number" min="0" step="0.01" className={inputClass} /></Field>
            <Field label="Mode of payment"><input name="paymentTermsNote" className={inputClass} placeholder="Six (6) cheques in advance" /></Field>
            <Field label="Generate cheques (count)"><input name="chequeCount" type="number" min="0" max="12" className={inputClass} placeholder="6" /></Field>
          </FormGrid>
          <p className="mt-3 text-xs text-muted">
            Cheques are split evenly across the term and sum to the annual rent. Notice
            gate, expiry and renewal deadlines are rule-based — review before action.
          </p>
        </FormSection>

        <SubmitButton pendingLabel="Creating…">Create tenancy &amp; records</SubmitButton>
      </form>
    </>
  );
}
