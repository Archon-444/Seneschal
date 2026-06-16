import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import { getOrCreateMyPassport, listPassportDocuments } from "@/server/services/tenantPassport";
import { getDocumentUrl } from "@/server/services/documents";
import { formatDubaiDate } from "@/server/calculators/dates";
import { Badge, Button, Card, EmptyState, Field, inputClass, PageHeader, Table, Td } from "@/components/ui";
import { updatePassportAction, uploadPassportDocumentAction } from "./actions";

function dateValue(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

// The tenant's rental passport (1C). TENANT-only; a LANDLORD persona has no passport.
export default async function PassportPage() {
  const ctx = await requireCtx();
  if (ctx.role !== "TENANT") redirect("/portal");
  const passport = await getOrCreateMyPassport(ctx);
  const documents = await listPassportDocuments(ctx);
  const docLinks = await Promise.all(
    documents.map(async (d) => ({ doc: d, url: (await getDocumentUrl(ctx, d.id)).url })),
  );

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

      <section className="mt-8 max-w-3xl">
        <h2 className="mb-3 font-display text-xl text-navy-900">Supporting documents</h2>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {docLinks.length === 0 ? (
              <EmptyState message="No documents yet. Add your Emirates ID, passport, or a salary certificate." />
            ) : (
              <Table headers={["Document", "Type", "Added", ""]}>
                {docLinks.map(({ doc, url }) => (
                  <tr key={doc.id}>
                    <Td className="font-medium text-navy-900">{doc.fileName}</Td>
                    <Td>{doc.kind.replace(/_/g, " ")}</Td>
                    <Td className="figure">{formatDubaiDate(doc.createdAt)}</Td>
                    <Td>
                      <a href={url} target="_blank" rel="noreferrer" className="text-gold-700 hover:underline">View</a>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
          <Card>
            <h3 className="mb-3 text-sm font-medium text-navy-900">Add a document</h3>
            <form action={uploadPassportDocumentAction} className="space-y-3">
              <Field label="Type">
                <select name="kind" className={inputClass}>
                  <option value="ID_DOCUMENT">ID / passport</option>
                  <option value="BANK_CONFIRMATION">Salary / bank confirmation</option>
                  <option value="OTHER">Other</option>
                </select>
              </Field>
              <Field label="File">
                <input name="file" type="file" required className={inputClass} />
              </Field>
              <Button type="submit">Upload</Button>
            </form>
          </Card>
        </div>
      </section>
    </>
  );
}
