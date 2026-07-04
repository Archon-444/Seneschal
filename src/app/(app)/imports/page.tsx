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
      <PageHeader title="Import & extract" subtitle="OCR-first intake with Excel fallback. Nothing reaches trusted records without your confirmation." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="font-display mb-3 text-lg text-navy-900">Extract from document (OCR)</h2>
          <p className="mb-3 text-xs text-navy-500">
            Upload a contract, Ejari certificate or cheque schedule. Fields are proposed with
            per-field confidence; you review every field before commit.
          </p>
          <UploadForm scopeType="WORKSPACE" scopeId={ctx.workspaceId} back="/imports" allowExtract />
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
