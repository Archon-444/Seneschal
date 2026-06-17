import { requireCtx } from "@/server/auth/request";
import { listViewings } from "@/server/services/viewings";
import { listProperties } from "@/server/services/properties";
import { Badge, Button, Card, EmptyState, Field, inputClass, PageHeader, Table, Td } from "@/components/ui";
import { createViewingAction, setViewingStatusAction } from "../actions";

function dateTime(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ");
}
function propLabel(p: { community: string; building: string | null; unitNo: string | null }): string {
  return [p.building, p.unitNo ? `Unit ${p.unitNo}` : null, p.community].filter(Boolean).join(" · ");
}

// Operator scheduling/tracking for property viewings (2A #10).
export default async function ViewingsPage() {
  const ctx = await requireCtx();
  const [viewings, properties] = await Promise.all([listViewings(ctx), listProperties(ctx)]);
  const propName = (id: string) => {
    const p = properties.find((x) => x.id === id);
    return p ? propLabel(p) : "—";
  };

  return (
    <>
      <PageHeader title="Viewings" subtitle="Schedule and track prospective-tenant property visits" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {viewings.length === 0 ? (
            <EmptyState message="No viewings scheduled yet." />
          ) : (
            <Table headers={["When", "Property", "Prospect", "Status", ""]}>
              {viewings.map((v) => (
                <tr key={v.id}>
                  <Td className="figure whitespace-nowrap text-xs">{dateTime(v.scheduledAt)}</Td>
                  <Td>{propName(v.propertyId)}</Td>
                  <Td>{v.prospectName ?? "—"}</Td>
                  <Td><Badge value={v.status} /></Td>
                  <Td>
                    <div className="flex gap-1.5">
                      {v.status === "REQUESTED" && (
                        <StatusButton id={v.id} status="CONFIRMED" label="Confirm" />
                      )}
                      {(v.status === "REQUESTED" || v.status === "CONFIRMED") && (
                        <StatusButton id={v.id} status="COMPLETED" label="Completed" />
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </div>

        <Card>
          <h2 className="font-display mb-3 text-lg text-navy-900">Schedule a viewing</h2>
          <form action={createViewingAction} className="space-y-3">
            <Field label="Property">
              <select name="propertyId" required className={inputClass}>
                <option value="">Select…</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>{propLabel(p)}</option>
                ))}
              </select>
            </Field>
            <Field label="Prospect name">
              <input name="prospectName" className={inputClass} placeholder="Name of the viewer" />
            </Field>
            <Field label="Date & time">
              <input name="scheduledAt" type="datetime-local" required className={inputClass} />
            </Field>
            <Field label="Notes">
              <textarea name="notes" rows={2} className={inputClass} />
            </Field>
            <Button type="submit">Schedule</Button>
          </form>
        </Card>
      </div>
    </>
  );
}

function StatusButton({ id, status, label }: { id: string; status: string; label: string }) {
  return (
    <form action={setViewingStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <Button type="submit" variant="secondary">{label}</Button>
    </form>
  );
}
