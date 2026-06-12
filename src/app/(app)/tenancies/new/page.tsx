import { requireCtx } from "@/server/auth/request";
import { getProperty } from "@/server/services/properties";
import { listContacts } from "@/server/services/contacts";
import { Button, Card, Field, inputClass, PageHeader } from "@/components/ui";
import { createTenancyAction } from "../../actions";

export default async function NewTenancyPage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string }>;
}) {
  const { propertyId } = await searchParams;
  const ctx = await requireCtx();
  if (!propertyId) return <PageHeader title="Pick a property first" subtitle="Open a property and choose Add tenancy." />;
  const property = await getProperty(ctx, propertyId);
  const contacts = await listContacts(ctx);

  return (
    <>
      <PageHeader
        title="New tenancy"
        subtitle={`${property!.community}${property!.unitNo ? ` · ${property!.unitNo}` : ""}`}
      />
      <Card className="max-w-2xl">
        <form action={createTenancyAction} className="grid grid-cols-2 gap-4">
          <input type="hidden" name="propertyId" value={propertyId} />
          <Field label="Start date">
            <input name="startDate" type="date" required className={inputClass} />
          </Field>
          <Field label="End date">
            <input name="endDate" type="date" required className={inputClass} />
          </Field>
          <Field label="Annual rent (AED)">
            <input name="annualRent" type="number" min="0" step="0.01" required className={inputClass} />
          </Field>
          <Field label="Deposit (AED)">
            <input name="depositAmount" type="number" min="0" step="0.01" className={inputClass} />
          </Field>
          <Field label="Ejari no">
            <input name="ejariNo" className={inputClass} placeholder="leave empty if not registered" />
          </Field>
          <Field label="Notice period (days)">
            <input name="noticePeriodDays" type="number" min="1" defaultValue="90" className={inputClass} />
          </Field>
          <Field label="Tenant contact">
            <select name="tenantContactId" className={inputClass}>
              <option value="">—</option>
              {contacts.filter((c) => c.kind === "TENANT").map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Landlord contact">
            <select name="landlordContactId" className={inputClass}>
              <option value="">—</option>
              {contacts.filter((c) => c.kind === "OWNER" || c.kind === "CLIENT").map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <div className="col-span-2">
            <Button type="submit">Create tenancy & generate deadlines</Button>
            <p className="mt-2 text-xs text-navy-300">
              Notice gate, expiry and renewal dates are rule-based calculations — review before action.
            </p>
          </div>
        </form>
      </Card>
    </>
  );
}
