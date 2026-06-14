import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import { getImportBatch, type ImportRowData } from "@/server/services/imports";
import { BackLink, Badge, Button, Card, PageHeader, Table, Td } from "@/components/ui";
import { commitBatchAction, rollbackBatchAction } from "../../actions";

export default async function ImportBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();

  let batch;
  try {
    batch = await getImportBatch(ctx, id);
  } catch {
    notFound();
  }
  const conflicts = batch!.rows.filter((r) => r.status === "CONFLICT").length;

  return (
    <>
      <BackLink href="/imports" label="All imports" />
      <PageHeader
        title={`Import batch — ${batch!.source}`}
        subtitle={`${batch!.rows.length} rows · ${conflicts} conflicted (conflicts block the row, not the batch)`}
        actions={
          <div className="flex gap-2">
            {(batch!.status === "MAPPED" || batch!.status === "REVIEWING" || batch!.status === "UPLOADED") && (
              <form action={commitBatchAction}>
                <input type="hidden" name="id" value={id} />
                <Button type="submit">Commit batch</Button>
              </form>
            )}
            {batch!.status === "COMMITTED" && (
              <form action={rollbackBatchAction}>
                <input type="hidden" name="id" value={id} />
                <Button type="submit" variant="danger">Roll back (archive created records)</Button>
              </form>
            )}
          </div>
        }
      />
      <Card className="mb-4">
        Status: <Badge value={batch!.status} />
      </Card>
      <Table headers={["Row", "Property", "Tenancy", "Rent", "Status", "Conflict"]}>
        {batch!.rows.map((row, i) => {
          const data = row.mappedJson as unknown as ImportRowData | null;
          return (
            <tr key={row.id} className={row.status === "CONFLICT" ? "bg-claret-100/30" : ""}>
              <Td className="figure">{i + 1}</Td>
              <Td>{data ? `${data.community}${data.unitNo ? ` · ${data.unitNo}` : ""}` : "—"}</Td>
              <Td className="figure text-xs">{data ? `${data.startDate} → ${data.endDate}` : "—"}</Td>
              <Td className="figure">{data ? data.annualRent.toLocaleString() : "—"}</Td>
              <Td><Badge value={row.status} /></Td>
              <Td className="text-xs text-claret-700">{row.conflictReason ?? ""}</Td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
