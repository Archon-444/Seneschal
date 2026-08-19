import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { listImportBatches } from "@/server/services/imports";
import { listExtractionJobs } from "@/server/services/extraction";
import { formatDubaiDate } from "@/server/calculators/dates";
import { Badge, Button, Card, EmptyState, Field, PageHeader, Table, Td } from "@/components/ui";
import { importCsvAction } from "../actions";
import { UploadForm } from "../properties/[id]/UploadForm";

export default async function ImportsPage() {
  const ctx = await requireCtx();
  const [batches, jobs] = await Promise.all([listImportBatches(ctx), listExtractionJobs(ctx)]);
  const reviewable = jobs.filter((j) => j.status === "EXTRACTED" || j.status === "REVIEWING");

  return (
    <>
      <PageHeader
        title="Import & extract"
        subtitle="Scan a contract or Ejari to propose a new tenancy — landlord, tenant, asset and term. Nothing reaches trusted records without your confirmation."
      />

      <ol className="mb-8 max-w-3xl space-y-2 text-sm text-navy-700">
        <li>
          <span className="figure text-xs text-gold-700">1</span>
          <span className="ml-2">Upload the tenancy contract or Ejari (extract is on by default).</span>
        </li>
        <li>
          <span className="figure text-xs text-gold-700">2</span>
          <span className="ml-2">Review the proposed landlord and tenant — match someone already on file, or take them as new contacts.</span>
        </li>
        <li>
          <span className="figure text-xs text-gold-700">3</span>
          <span className="ml-2">Confirm. That writes the property, tenancy, parties, cheques and deadlines together.</span>
        </li>
      </ol>
      <p className="mb-6 max-w-3xl text-xs text-muted">
        Prefer to type it?{" "}
        <Link href="/onboarding/new" className="text-gold-700 underline-offset-2 hover:underline">
          Onboard a tenancy by hand
        </Link>
        .
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="font-display mb-3 text-lg text-navy-900">Extract from document (OCR)</h2>
          <p className="mb-3 text-xs text-navy-500">
            Upload a contract or Ejari certificate. The model proposes landlord, tenant, unit and
            term with per-field confidence; you review every field — and decide whether each party
            is new or already in the directory — before commit.
          </p>
          <UploadForm
            scopeType="WORKSPACE"
            scopeId={ctx.workspaceId}
            back="/imports"
            allowExtract
            extractDefault
            defaultKind="TENANCY_CONTRACT"
          />
        </Card>
        <Card>
          <h2 className="font-display mb-3 text-lg text-navy-900">Excel / CSV import</h2>
          <p className="mb-2 text-xs text-navy-500">
            Column headers must match the template exactly — there is no mapping step. Rows are
            staged into a batch for per-row review before anything commits.
          </p>
          <div className="mb-3 flex flex-wrap gap-1">
            {[
              "community",
              "building",
              "unitNo",
              "ejariNo",
              "startDate",
              "endDate",
              "annualRent",
              "depositAmount",
              "noticePeriodDays",
              "tenantName",
              "landlordName",
              "propertyType",
              "bedrooms",
            ].map((col) => (
              <code
                key={col}
                className="figure rounded border border-line bg-ivory-100 px-1.5 py-0.5 text-[11px] text-navy-700"
              >
                {col}
              </code>
            ))}
          </div>
          <form action={importCsvAction} className="flex items-end gap-3">
            <Field label="CSV file">
              <input type="file" name="file" accept=".csv" required className="text-sm" />
            </Field>
            <Button type="submit" variant="secondary">Upload CSV</Button>
          </form>
        </Card>
      </div>

      {reviewable.length > 0 && (
        <>
          <h2 className="font-display mt-8 mb-3 text-xl text-navy-900">Awaiting review</h2>
          <Table headers={["Created", "Model", "Status", ""]}>
            {reviewable.map((j) => (
              <tr key={j.id}>
                <Td className="figure">{formatDubaiDate(j.createdAt)}</Td>
                <Td className="text-xs">{j.model ?? "—"}</Td>
                <Td><Badge value={j.status} /></Td>
                <Td>
                  <Link href={`/imports/review/${j.id}`} className="text-sm text-navy-500 underline-offset-2 hover:underline">
                    Review fields →
                  </Link>
                </Td>
              </tr>
            ))}
          </Table>
        </>
      )}

      <h2 className="font-display mt-8 mb-3 text-xl text-navy-900">Batches</h2>
      {batches.length === 0 ? (
        <EmptyState message="No import batches yet." />
      ) : (
        <Table headers={["Created", "Source", "Rows", "Status", ""]}>
          {batches.map((b) => (
            <tr key={b.id}>
              <Td className="figure">{formatDubaiDate(b.createdAt)}</Td>
              <Td>{b.source}</Td>
              <Td className="figure">{b.rows.length}</Td>
              <Td><Badge value={b.status} /></Td>
              <Td>
                <Link href={`/imports/${b.id}`} className="text-sm text-navy-500 underline-offset-2 hover:underline">
                  Open →
                </Link>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
