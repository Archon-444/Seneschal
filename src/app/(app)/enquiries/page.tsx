import { requireCtx } from "@/server/auth/request";
import { listEnquiries } from "@/server/services/enquiries";
import { daysBetween, todayInDubai } from "@/server/calculators/dates";
import { Actions, Badge, DubaiDate, EmptyState, PageHeader, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { setEnquiryStatusAction } from "../actions";

// Operator triage for inbound listing enquiries (1C #8).
export default async function EnquiriesPage() {
  const ctx = await requireCtx();
  const enquiries = await listEnquiries(ctx);
  const today = todayInDubai();

  return (
    <>
      <PageHeader title="Enquiries" subtitle="Interest registered against your published listings" />
      {enquiries.length === 0 ? (
        <EmptyState
          title="No enquiries yet"
          message="They arrive when someone registers interest on a shared listing."
        />
      ) : (
        <Table stack headers={["From", "Contact", "Message", "Received", "Status", ""]}>
          {enquiries.map((e) => {
            const age = daysBetween(e.createdAt, today);
            const stale = e.status === "NEW" && age >= 7;
            return (
              <tr key={e.id} className={stale ? "bg-claret-100/40" : undefined}>
                <Td label="From" className="font-medium text-navy-900">
                  {e.name}
                </Td>
                <Td label="Contact" className="text-xs">
                  {e.email ?? "—"}
                  {e.phone ? <div className="figure">{e.phone}</div> : null}
                </Td>
                <Td label="Message" className="max-w-xs text-sm text-muted">
                  {e.message ?? "—"}
                </Td>
                <Td label="Received" className="whitespace-nowrap">
                  <DubaiDate value={e.createdAt} className="text-xs" />
                  <div className={`t-caption ${stale ? "text-claret-700" : "text-muted"}`}>
                    {age <= 0 ? "today" : `${age}d ago`}
                  </div>
                </Td>
                <Td label="Status">
                  <Badge value={e.status} />
                </Td>
                <Td>
                  <Actions>
                    {e.status !== "CONTACTED" && e.status !== "CLOSED" && (
                      <StatusButton id={e.id} status="CONTACTED" label="Mark contacted" />
                    )}
                    {e.status !== "CLOSED" && <StatusButton id={e.id} status="CLOSED" label="Close" />}
                  </Actions>
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}

function StatusButton({ id, status, label }: { id: string; status: string; label: string }) {
  return (
    <form action={setEnquiryStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton variant="secondary">{label}</SubmitButton>
    </form>
  );
}
