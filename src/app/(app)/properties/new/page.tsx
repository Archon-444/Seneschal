import { requireCtx } from "@/server/auth/request";
import { listClients } from "@/server/services/clients";
import { Button, Card, Field, inputClass, PageHeader } from "@/components/ui";
import { createPropertyAction } from "../../actions";

export default async function NewPropertyPage() {
  const ctx = await requireCtx();
  const clients = await listClients(ctx);

  return (
    <>
      <PageHeader title="Add property" />
      <Card className="max-w-2xl">
        <form action={createPropertyAction} className="grid grid-cols-2 gap-4">
          <Field label="Client">
            <select name="clientPrincipalId" className={inputClass} required>
              <option value="">Select client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.displayName}</option>
              ))}
            </select>
          </Field>
          <Field label="Community">
            <input name="community" required className={inputClass} placeholder="Dubai Marina" />
          </Field>
          <Field label="Building">
            <input name="building" className={inputClass} />
          </Field>
          <Field label="Unit no">
            <input name="unitNo" className={inputClass} />
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
            <input name="bedrooms" type="number" min="0" className={inputClass} />
          </Field>
          <Field label="Size (sqft)">
            <input name="sizeSqft" type="number" min="0" className={inputClass} />
          </Field>
          <div className="col-span-2">
            <Button type="submit">Create property</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
