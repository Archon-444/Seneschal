import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import { getOrCreateMyPassport } from "@/server/services/tenantPassport";
import { Badge, Button, Card, Field, inputClass, PageHeader } from "@/components/ui";
import { updatePassportAction } from "./actions";

function dateValue(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

// The tenant's rental passport (1C). TENANT-only; a LANDLORD persona has no passport.
export default async function PassportPage() {
  const ctx = await requireCtx();
  if (ctx.role !== "TENANT") redirect("/portal");
  const passport = await getOrCreateMyPassport(ctx);

  return (
    <>
      <PageHeader
        eyebrow="Your profile"
        title="Rental passport"
        subtitle="A reusable profile you can share with a landlord or agent — once, securely, with your consent. Seneschal never holds funds."
        actions={<Badge value={passport.status} />}
      />

      <Card className="max-w-3xl">
        <form action={updatePassportAction} className="grid gap-3 sm:grid-cols-2">
          <Field label="Employer">
            <input name="employer" defaultValue={passport.employer ?? ""} className={inputClass} />
          </Field>
          <Field label="Job title">
            <input name="jobTitle" defaultValue={passport.jobTitle ?? ""} className={inputClass} />
          </Field>
          <Field label="Monthly income (AED)">
            <input
              name="monthlyIncome"
              type="number"
              min="0"
              defaultValue={passport.monthlyIncome != null ? String(passport.monthlyIncome) : ""}
              className={inputClass}
            />
          </Field>
          <Field label="Nationality">
            <input name="nationality" defaultValue={passport.nationality ?? ""} className={inputClass} />
          </Field>
          <Field label="Household size">
            <input
              name="householdSize"
              type="number"
              min="1"
              defaultValue={passport.householdSize != null ? String(passport.householdSize) : ""}
              className={inputClass}
            />
          </Field>
          <Field label="Looking to move in by">
            <input name="moveInBy" type="date" defaultValue={dateValue(passport.moveInBy)} className={inputClass} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="About you">
              <textarea
                name="summary"
                rows={3}
                defaultValue={passport.summary ?? ""}
                className={inputClass}
                placeholder="A short introduction — who will live here, why you're a reliable tenant…"
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Status">
              <select name="status" defaultValue={passport.status} className={inputClass}>
                <option value="DRAFT">Draft — still completing</option>
                <option value="READY">Ready to share</option>
              </select>
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit">Save passport</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
