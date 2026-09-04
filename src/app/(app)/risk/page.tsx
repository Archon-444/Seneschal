import Link from "next/link";
import type { FlagStatus } from "@prisma/client";
import { requireCtx } from "@/server/auth/request";
import { hasCapability } from "@/server/authz";
import { listRiskFlags, riskFlagReason } from "@/server/services/risk";
import { Badge, DubaiDate, EmptyState, PageHeader, ScopeLink, Table, Td } from "@/components/ui";
import { ackFlagAction } from "../actions";

type RiskView = "open" | "acknowledged" | "history";

const VIEWS: { value: RiskView; label: string; statuses: FlagStatus[] }[] = [
  { value: "open", label: "Open", statuses: ["OPEN"] },
  { value: "acknowledged", label: "Acknowledged", statuses: ["ACKNOWLEDGED"] },
  { value: "history", label: "History", statuses: ["CLEARED"] },
];

export default async function RiskPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const ctx = await requireCtx();
  const params = await searchParams;
  const selected = VIEWS.find((item) => item.value === params.view) ?? VIEWS[0];
  const canAcknowledge = hasCapability(ctx, "riskflags.ack");
  const flags = await listRiskFlags(ctx, { statuses: selected.statuses });

  return (
    <>
      <PageHeader title="Risk flags" subtitle="Rule-based operational views with a clear active queue and separate history." />
      <nav aria-label="Risk views" className="mb-4 flex flex-wrap gap-2">
        {VIEWS.map((item) => {
          const active = item.value === selected.value;
          return (
            <Link
              key={item.value}
              href={item.value === "open" ? "/risk" : `/risk?view=${item.value}`}
              aria-current={active ? "page" : undefined}
              className={`rounded border px-2.5 py-1 text-[12.5px] font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-500 ${
                active
                  ? "border-navy-900 bg-navy-900 text-white"
                  : "border-line bg-white text-navy-700 hover:bg-ivory-100"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      {flags.length === 0 ? (
        <EmptyState
          title={`No ${selected.label.toLowerCase()} risk flags`}
          message={
            selected.value === "open"
              ? "No rule-based flags currently need first review."
              : selected.value === "acknowledged"
                ? "No acknowledged flags are awaiting resolution."
                : "Cleared flags will remain available here as operational history."
          }
        />
      ) : (
        <Table stack headers={["Raised", "Code", "Severity", "Scope", "Status", "Rule", ""]}>
          {flags.map((flag) => (
            <tr key={flag.id} className={flag.status === "CLEARED" ? "opacity-60" : ""}>
              <Td label="Raised" className="whitespace-nowrap"><DubaiDate value={flag.raisedAt} /></Td>
              <Td label="Code">
                <Badge value={flag.code} />
                <div className="mt-1 max-w-sm text-xs text-muted">{riskFlagReason(flag.code)}</div>
              </Td>
              <Td label="Severity"><Badge value={flag.severity} /></Td>
              <Td label="Scope" className="text-xs"><ScopeLink scopeType={flag.scopeType} scopeId={flag.scopeId} /></Td>
              <Td label="Status"><Badge value={flag.status} /></Td>
              <Td label="Rule" className="figure text-xs">{flag.ruleVersion ?? "—"}</Td>
              <Td label="Action">
                {flag.status === "OPEN" && canAcknowledge && (
                  <form action={ackFlagAction}>
                    <input type="hidden" name="id" value={flag.id} />
                    <button className="text-xs font-semibold text-navy-500 hover:underline">Acknowledge</button>
                  </form>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {!canAcknowledge && selected.value === "open" && flags.length > 0 && (
        <p className="mt-3 text-xs text-muted">Open flags can be acknowledged by an authorized manager or fiduciary.</p>
      )}
    </>
  );
}
