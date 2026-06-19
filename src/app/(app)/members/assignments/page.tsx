import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import { listAssignmentGrid } from "@/server/services/assignments";
import { BackLink, EmptyState, PageHeader, Td } from "@/components/ui";
import { toggleAssignmentAction } from "./actions";

// The people×clients assignment grid (F-Admin §4.2, §7). Gated by clients.assign. Toggling a
// cell creates/revokes a ClientAssignment — the rows that make a delegate's scope resolve.
export default async function AssignmentsPage() {
  let grid;
  try {
    grid = await listAssignmentGrid(await requireCtx());
  } catch {
    redirect("/dashboard");
  }
  const assigned = new Set(grid.assignedKeys);

  return (
    <>
      <BackLink href="/members" label="Members" />
      <PageHeader
        title="Delegate assignments"
        subtitle="Toggle a cell to scope a delegate to a client. Every change is audited and takes effect on the delegate's next request."
      />
      {grid.delegates.length === 0 || grid.clients.length === 0 ? (
        <EmptyState message="Add a delegate (managing agent) and at least one client to wire assignments." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-ivory-100 text-left">
                <th className="px-4 py-2.5 text-[10.5px] font-bold uppercase tracking-wider text-muted">
                  Delegate · Client
                </th>
                {grid.clients.map((c) => (
                  <th key={c.id} className="px-3 py-2.5 text-center text-[10.5px] font-bold uppercase tracking-wider text-muted">
                    {c.displayName}
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
                  {grid.clients.map((c) => {
                    const isAssigned = assigned.has(`${d.membershipId}:${c.id}`);
                    return (
                      <td key={c.id} className="px-3 py-2.5 text-center">
                        <form action={toggleAssignmentAction} className="inline">
                          <input type="hidden" name="membershipId" value={d.membershipId} />
                          <input type="hidden" name="clientPrincipalId" value={c.id} />
                          <input type="hidden" name="assigned" value={isAssigned ? "1" : "0"} />
                          <button
                            type="submit"
                            aria-pressed={isAssigned}
                            aria-label={isAssigned ? "Assigned — revoke" : "Not assigned — assign"}
                            className={`h-6 w-6 rounded-md border text-xs font-bold ${
                              isAssigned
                                ? "border-verde-700 bg-verde-100 text-verde-700"
                                : "border-line bg-ivory-100 text-muted hover:border-gold-500"
                            }`}
                          >
                            {isAssigned ? "✓" : ""}
                          </button>
                        </form>
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
