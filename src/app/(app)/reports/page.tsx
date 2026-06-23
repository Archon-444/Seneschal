import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { listReports } from "@/server/services/reports";
import { listClients } from "@/server/services/clients";
import { DubaiDate, EmptyState, PageHeader, Table, Td } from "@/components/ui";
import { generateReportAction } from "../actions";

export default async function ReportsPage() {
  const ctx = await requireCtx();
  const [reports, clients] = await Promise.all([listReports(ctx), listClients(ctx)]);
  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.displayName ?? "—";

  return (
    <>
      <PageHeader title="Reports" subtitle="Monthly client reports — printable HTML, PDF via print, CSV export" />
      <div className="mb-6 flex flex-wrap gap-2">
        {clients.map((c) => (
          <form key={c.id} action={generateReportAction}>
            <input type="hidden" name="clientPrincipalId" value={c.id} />
            <button className="rounded-md border border-navy-100 bg-white px-3 py-1.5 text-sm text-navy-700 hover:bg-ivory-100">
              Generate — {c.displayName}
            </button>
          </form>
        ))}
      </div>
      {reports.length === 0 ? (
        <EmptyState
          title="No reports yet"
          message="Generate a monthly client report using the buttons above."
        />
      ) : (
        <Table stack headers={["Generated", "Kind", "Client", ""]}>
          {reports.map((r) => (
            <tr key={r.id}>
              <Td label="Generated" className="whitespace-nowrap">
                <DubaiDate value={r.createdAt} />
              </Td>
              <Td label="Kind">{r.kind}</Td>
              <Td label="Client">{clientName(r.clientPrincipalId)}</Td>
              <Td>
                <Link href={`/reports/${r.id}`} className="text-sm text-navy-500 hover:underline">
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
