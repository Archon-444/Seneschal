import { requireCtx } from "@/server/auth/request";
import { listRiskFlags } from "@/server/services/risk";
import { Badge, DubaiDate, EmptyState, PageHeader, ScopeLink, Table, Td } from "@/components/ui";
import { ackFlagAction } from "../actions";

export default async function RiskPage() {
  const ctx = await requireCtx();
  const flags = await listRiskFlags(ctx, { includeCleared: true });

  return (
    <>
      <PageHeader title="Risk flags" subtitle="Deterministic rules only — one open flag per code per scope" />
      {flags.length === 0 ? (
        <EmptyState title="No risk flags" message="Deterministic rules raise flags here when something needs attention." />
      ) : (
        <Table stack headers={["Raised", "Code", "Severity", "Scope", "Status", "Rule", ""]}>
          {flags.map((f) => (
            <tr key={f.id} className={f.status === "CLEARED" ? "opacity-50" : ""}>
              <Td label="Raised" className="whitespace-nowrap">
                <DubaiDate value={f.raisedAt} />
              </Td>
              <Td label="Code">
                <Badge value={f.code} />
              </Td>
              <Td label="Severity">
                <Badge value={f.severity} />
              </Td>
              <Td label="Scope" className="text-xs">
                <ScopeLink scopeType={f.scopeType} scopeId={f.scopeId} />
              </Td>
              <Td label="Status">
                <Badge value={f.status} />
              </Td>
              <Td label="Rule" className="figure text-xs">
                {f.ruleVersion ?? "—"}
              </Td>
              <Td>
                {f.status === "OPEN" && (
                  <form action={ackFlagAction}>
                    <input type="hidden" name="id" value={f.id} />
                    <button className="text-xs text-navy-500 hover:underline">Acknowledge</button>
                  </form>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
