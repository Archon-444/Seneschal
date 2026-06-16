import { requireCtx } from "@/server/auth/request";
import { listEnquiries } from "@/server/services/enquiries";
import { formatDubaiDate } from "@/server/calculators/dates";
import { Badge, Button, EmptyState, PageHeader, Table, Td } from "@/components/ui";
import { setEnquiryStatusAction } from "../actions";

// Operator triage for inbound listing enquiries (1C #8).
export default async function EnquiriesPage() {
  const ctx = await requireCtx();
  const enquiries = await listEnquiries(ctx);

  return (
    <>
      <PageHeader title="Enquiries" subtitle="Interest registered against your published listings" />
      {enquiries.length === 0 ? (
        <EmptyState message="No enquiries yet. They arrive when someone registers interest on a shared listing." />
      ) : (
        <Table headers={["From", "Contact", "Message", "Received", "Status", ""]}>
          {enquiries.map((e) => (
            <tr key={e.id}>
              <Td className="font-medium text-navy-900">{e.name}</Td>
              <Td className="text-xs">
                {e.email ?? "—"}
                {e.phone ? <div className="figure">{e.phone}</div> : null}
              </Td>
              <Td className="max-w-xs text-sm text-muted">{e.message ?? "—"}</Td>
              <Td className="figure whitespace-nowrap text-xs">{formatDubaiDate(e.createdAt)}</Td>
              <Td><Badge value={e.status} /></Td>
              <Td>
                <div className="flex gap-1.5">
                  {e.status !== "CONTACTED" && e.status !== "CLOSED" && (
                    <form action={setEnquiryStatusAction}>
                      <input type="hidden" name="id" value={e.id} />
                      <input type="hidden" name="status" value="CONTACTED" />
                      <Button type="submit" variant="secondary">Mark contacted</Button>
                    </form>
                  )}
                  {e.status !== "CLOSED" && (
                    <form action={setEnquiryStatusAction}>
                      <input type="hidden" name="id" value={e.id} />
                      <input type="hidden" name="status" value="CLOSED" />
                      <Button type="submit" variant="secondary">Close</Button>
                    </form>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
