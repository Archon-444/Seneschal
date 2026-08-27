import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import { listAssignmentGrid } from "@/server/services/assignments";
import { BackLink, EmptyState, PageHeader, Td } from "@/components/ui";
import { toggleAssignmentAction } from "./actions";

// The people×properties assignment grid. Gated by clients.assign. Toggling a cell
// creates/revokes a PropertyAssignment — one responsible agent per property.
export default async function AssignmentsPage() {
  let grid;
  try {
    grid = await listAssignmentGrid(await requireCtx());
  } catch {
    redirect("/dashboard");
  }
  const assigned = new Set(grid.assignedKeys);
  const takenBy = new Map<string, string>();
  for (const key of grid.assignedKeys) {
    const sep = key.indexOf(":");
    takenBy.set(key.slice(sep + 1), key.slice(0, sep));
  }
  const delegateName = new Map(grid.delegates.map((d) => [d.membershipId, d.name || d.email]));

  return (
    <>
      <BackLink href="/members" label="Members" />
      <PageHeader
        title="Delegate assignments"
        subtitle="One responsible agent per property. Toggle a cell to assign the book. Vacant units stay invisible to an agent until assigned. Every change is audited and takes effect on the agent's next request."
      />
      {grid.delegates.length === 0 || grid.properties.length === 0 ? (
        <EmptyState message="Add an agent and at least one property to wire assignments." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-ivory-100 text-left">
                <th className="t-th px-4 py-2.5 text-muted">Agent · Property</th>
                {grid.properties.map((p) => (
                  <th key={p.id} className="t-th px-3 py-2.5 text-center text-muted">
                    <div className="font-medium text-navy-900">{p.label}</div>
                    {p.clientName && <div className="text-[10px] font-normal normal-case tracking-normal">{p.clientName}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {grid.delegates.map((d) => (
                <tr key={d.membershipId}>
                  <Td>
                    <div className="font-semibold text-navy-900">{d.name}</div>
                    <div className="text-xs text-muted">{d.email}</div>
                  </Td>
                  {grid.properties.map((p) => {
                    const isAssigned = assigned.has(`${d.membershipId}:${p.id}`);
                    const holder = takenBy.get(p.id);
                    const takenByOther = !!holder && holder !== d.membershipId;
                    return (
                      <td key={p.id} className="px-3 py-2.5 text-center">
                        {takenByOther ? (
                          <span
                            className="text-[10px] text-muted"
                            title={`Assigned to ${delegateName.get(holder) ?? "another agent"}`}
                          >
                            —
                          </span>
                        ) : (
                          <form action={toggleAssignmentAction} className="inline">
                            <input type="hidden" name="membershipId" value={d.membershipId} />
                            <input type="hidden" name="propertyId" value={p.id} />
                            <input type="hidden" name="assigned" value={isAssigned ? "1" : "0"} />
                            <button
                              type="submit"
                              aria-pressed={isAssigned}
                              aria-label={isAssigned ? "Assigned — revoke" : "Not assigned — assign"}
                              className={`h-7 w-7 rounded-md border text-xs font-bold ${
                                isAssigned
                                  ? "border-verde-700 bg-verde-100 text-verde-700"
                                  : "border-line bg-ivory-100 text-muted hover:border-gold-500"
                              }`}
                            >
                              {isAssigned ? "✓" : ""}
                            </button>
                          </form>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
