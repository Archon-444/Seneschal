import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import { getExtractionJob, type ExtractionFields } from "@/server/services/extraction";
import { Button, Card, PageHeader, inputClass } from "@/components/ui";
import { commitReviewedExtractionAction, rejectExtractionFormAction } from "./actions";

// Screen 11 — extraction review: per-field value + confidence + source snippet.
// The reviewer can correct any field; commit flows through ImportBatch (P11).

const SCALAR_FIELDS: { key: string; label: string; type?: string }[] = [
  { key: "community", label: "Community" },
  { key: "building", label: "Building" },
  { key: "unitNo", label: "Unit no" },
  { key: "propertyType", label: "Property type" },
  { key: "bedrooms", label: "Bedrooms", type: "number" },
  { key: "ejariNo", label: "Ejari no" },
  { key: "startDate", label: "Start date", type: "date" },
  { key: "endDate", label: "End date", type: "date" },
  { key: "annualRent", label: "Annual rent (AED)", type: "number" },
  { key: "depositAmount", label: "Deposit (AED)", type: "number" },
  { key: "noticePeriodDays", label: "Notice period (days)", type: "number" },
];

function confidenceTone(c: number | undefined): string {
  if (c == null) return "text-navy-300";
  if (c >= 0.95) return "text-verde-700";
  if (c >= 0.85) return "text-gold-700";
  return "text-claret-500";
}

export default async function ExtractionReviewPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  const ctx = await requireCtx();

  let job;
  try {
    job = await getExtractionJob(ctx, jobId);
  } catch {
    notFound();
  }
  if (job!.status !== "EXTRACTED" && job!.status !== "REVIEWING") {
    return <PageHeader title="Extraction job" subtitle={`This job is ${job!.status} and no longer reviewable.`} />;
  }
  const fields = (job!.rawOutput ?? {}) as unknown as ExtractionFields;
  const paymentItems = (fields.paymentItems?.value ?? []) as {
    seq: number; dueDate: string; amount: number; chequeNo?: string; bank?: string;
  }[];

  return (
    <>
      <PageHeader
        title="Review extracted fields"
        subtitle={`Model: ${job!.model ?? "—"} · AI proposes, you decide. Nothing is written until you confirm.`}
      />
      <form action={commitReviewedExtractionAction}>
        <input type="hidden" name="jobId" value={jobId} />
        <Card className="max-w-3xl">
          <div className="space-y-4">
            {SCALAR_FIELDS.map(({ key, label, type }) => {
              const field = fields[key];
              const value = field?.value;
              return (
                <div key={key} className="grid grid-cols-3 items-start gap-4">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-navy-500">{label}</div>
                    {field && (
                      <div className={`figure mt-0.5 text-xs ${confidenceTone(field.confidence)}`}>
                        {(field.confidence * 100).toFixed(0)}% confidence
                      </div>
                    )}
                  </div>
                  <input
                    name={key}
                    type={type ?? "text"}
                    step={type === "number" ? "any" : undefined}
                    defaultValue={value == null ? "" : String(value)}
                    className={inputClass}
                  />
                  <div className="text-xs italic text-navy-300">
                    {field?.source ? `“${field.source}”` : "not found in document"}
                  </div>
                </div>
              );
            })}
          </div>

          {paymentItems.length > 0 && (
            <>
              <h3 className="font-display mt-6 mb-2 text-lg text-navy-900">
                Payment schedule{" "}
                <span className={`figure text-xs ${confidenceTone(fields.paymentItems?.confidence)}`}>
                  {fields.paymentItems ? `${(fields.paymentItems.confidence * 100).toFixed(0)}%` : ""}
                </span>
              </h3>
              <input type="hidden" name="paymentItems" value={JSON.stringify(paymentItems)} />
              <table className="w-full text-sm">
                <thead>
                  <tr className="t-th text-left text-muted">
                    <th className="py-1">#</th><th>Due</th><th>Amount</th><th>Cheque</th><th>Bank</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentItems.map((item) => (
                    <tr key={item.seq} className="border-t border-ivory-200">
                      <td className="figure py-1.5">{item.seq}</td>
                      <td className="figure">{item.dueDate}</td>
                      <td className="figure">{item.amount.toLocaleString()}</td>
                      <td className="figure">{item.chequeNo ?? "—"}</td>
                      <td>{item.bank ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="mt-6 flex gap-3 border-t border-ivory-200 pt-4">
            <Button type="submit">Confirm & commit to records</Button>
            <Button type="submit" variant="danger" formAction={rejectExtractionFormAction}>
              Reject extraction
            </Button>
          </div>
          <p className="mt-2 text-xs text-navy-300">
            Committing creates an import batch, writes evidence for every corrected field, and can be
            rolled back. Values are based on supplied data — review before action.
          </p>
        </Card>
      </form>
    </>
  );
}
