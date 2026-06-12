import { requireCtx } from "@/server/auth/request";
import { listRiskFlags } from "@/server/services/risk";
import { formatDubaiDate } from "@/server/calculators/dates";
import { Badge, EmptyState, PageHeader, Table, Td } from "@/components/ui";
import { ackFlagAction } from "../actions";

export default async function RiskPage() {
  const ctx = await requireCtx();
  const flags = await listRiskFlags(ctx, { includeCleared: true });

  return (
    <>
      <PageHeader title="Risk flags" subtitle="Deterministic rules only — one open flag per code per scope" />
      {flags.length === 0 ? (
        <EmptyState message="No risk flags." />
      ) : (
        <Table headers={["Raised", "Code", "Severity", "Scope", "Status", "Rule", ""]}>
          {flags.map((f) => (
            <tr key={f.id} className={f.status === "CLEARED" ? "opacity-50" : ""}>
              <Td className="figure whitespace-nowrap">{formatDubaiDate(f.raisedAt)}</Td>
              <Td><Badge value={f.code} /></Td>
              <Td><Badge value={f.severity} /></Td>
              <Td className="text-xs">{f.scopeType}</Td>
              <Td><Badge value={f.status} /></Td>
              <Td className="figure text-xs">{f.ruleVersion ?? "—"}</Td>
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
