import { requireCtx } from "@/server/auth/request";
import { listViewings } from "@/server/services/viewings";
import { listProperties } from "@/server/services/properties";
import {
  Actions,
  Badge,
  DubaiDateTime,
  EmptyState,
  Field,
  FormSection,
  inputClass,
  PageHeader,
  Table,
  Td,
} from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { createViewingAction, setViewingStatusAction } from "../actions";

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
            <EmptyState title="No viewings yet" message="Schedule a prospective-tenant visit using the form." />
          ) : (
            <Table stack headers={["When", "Property", "Prospect", "Status", ""]}>
              {viewings.map((v) => (
                <tr key={v.id}>
                  <Td label="When" className="whitespace-nowrap">
                    <DubaiDateTime value={v.scheduledAt} className="text-xs" />
                  </Td>
                  <Td label="Property">{propName(v.propertyId)}</Td>
                  <Td label="Prospect">{v.prospectName ?? "—"}</Td>
                  <Td label="Status">
                    <Badge value={v.status} />
                  </Td>
                  <Td>
                    <Actions>
                      {v.status === "REQUESTED" && (
                        <StatusButton id={v.id} status="CONFIRMED" label="Confirm" />
                      )}
                      {(v.status === "REQUESTED" || v.status === "CONFIRMED") && (
                        <StatusButton id={v.id} status="COMPLETED" label="Completed" />
                      )}
                    </Actions>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </div>

        <FormSection title="Schedule a viewing">
          <form action={createViewingAction} className="space-y-3">
            <Field label="Property" required>
              <select name="propertyId" required className={inputClass}>
                <option value="">Select…</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {propLabel(p)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Prospect name">
              <input name="prospectName" className={inputClass} placeholder="Name of the viewer" />
            </Field>
            <Field label="Date & time" required>
              <input name="scheduledAt" type="datetime-local" required className={inputClass} />
            </Field>
            <Field label="Notes">
              <textarea name="notes" rows={2} className={inputClass} />
            </Field>
            <SubmitButton pendingLabel="Scheduling…">Schedule</SubmitButton>
          </form>
        </FormSection>
      </div>
    </>
  );
}

function StatusButton({ id, status, label }: { id: string; status: string; label: string }) {
  return (
    <form action={setViewingStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton variant="secondary">{label}</SubmitButton>
    </form>
  );
}
