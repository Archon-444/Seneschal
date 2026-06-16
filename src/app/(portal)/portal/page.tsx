import { redirect } from "next/navigation";
import { requireCtx, homePathFor } from "@/server/auth/request";
import { isPersonaRole, type AuthzContext } from "@/server/authz";
import { listPayments } from "@/server/services/payments";
import { listDeadlines } from "@/server/services/deadlines";
import { listProperties } from "@/server/services/properties";
import { isLandlordVerified } from "@/server/services/landlords";
import { formatDubaiDate } from "@/server/calculators/dates";
import { PageHeader, Card, KpiCard, Badge, Table, Td, Money, EmptyState, Reminder } from "@/components/ui";

// The persona home. Every read flows through the F0a contact-scoped helpers
// (listPayments / listDeadlines / listProperties all branch on subjectContactId),
// so this page is also the end-to-end proof the boundary serves real scoped data.
export default async function PortalHome() {
  const ctx = await requireCtx();
  // Belt-and-braces: the layout already bars operators, but never render persona
  // data for a non-persona ctx — the list services would fall back to workspace scope.
  if (!isPersonaRole(ctx.role)) redirect(homePathFor(ctx.role));

  return ctx.role === "LANDLORD" ? <LandlordHome ctx={ctx} /> : <TenantHome ctx={ctx} />;
}

function propertyLabel(p: { community: string; building: string | null; unitNo: string | null }): string {
  return [p.building, p.unitNo ? `Unit ${p.unitNo}` : null, p.community].filter(Boolean).join(" · ");
}

async function TenantHome({ ctx }: { ctx: AuthzContext }) {
  const [payments, deadlines] = await Promise.all([listPayments(ctx), listDeadlines(ctx)]);

  // Group the tenant's own payments under each tenancy (the seed gives one).
  const byTenancy = new Map<string, { tenancy: (typeof payments)[number]["tenancy"]; items: typeof payments }>();
  for (const p of payments) {
    const entry = byTenancy.get(p.tenancyId) ?? { tenancy: p.tenancy, items: [] as typeof payments };
    entry.items.push(p);
    byTenancy.set(p.tenancyId, entry);
  }
  const tenancies = [...byTenancy.values()];

  return (
    <div>
      <PageHeader
        eyebrow="Your tenancy"
        title="Tenant portal"
        subtitle="Your rental record, payment schedule, and upcoming dates — recorded and held on your behalf. Seneschal never holds funds."
      />

      {tenancies.length === 0 ? (
        <EmptyState message="No active tenancy is linked to your account yet." />
      ) : (
        <div className="space-y-8">
          {tenancies.map(({ tenancy, items }) => {
            const next = items.find((i) => i.status === "SCHEDULED" || i.status === "REQUESTED");
            return (
              <section key={tenancy.id}>
                <h2 className="mb-3 font-display text-xl text-navy-900">{propertyLabel(tenancy.property)}</h2>
                <div className="mb-5 grid gap-4 sm:grid-cols-3">
                  <KpiCard label="Annual rent" value={<Money amount={String(tenancy.annualRent)} />} />
                  <KpiCard
                    label="Tenancy"
                    value={<span className="text-lg">{formatDubaiDate(tenancy.startDate)} → {formatDubaiDate(tenancy.endDate)}</span>}
                    sub={tenancy.ejariNo ? `Ejari ${tenancy.ejariNo}` : "Ejari not recorded"}
                  />
                  <KpiCard
                    label="Next payment"
                    value={next ? <Money amount={String(next.amount)} /> : "—"}
                    sub={next ? `Due ${formatDubaiDate(next.dueDate)}` : "Nothing scheduled"}
                    tone="warn"
                  />
                </div>
                <Table headers={["#", "Due", "Amount", "Instrument", "Status"]}>
                  {items.map((p) => (
                    <tr key={p.id}>
                      <Td className="figure">{p.seq}</Td>
                      <Td className="figure">{formatDubaiDate(p.dueDate)}</Td>
                      <Td><Money amount={String(p.amount)} /></Td>
                      <Td>{p.instrument}{p.chequeNo ? ` · ${p.chequeNo}` : ""}</Td>
                      <Td><Badge value={p.status} /></Td>
                    </tr>
                  ))}
                </Table>
              </section>
            );
          })}

          <section>
            <h2 className="mb-3 font-display text-xl text-navy-900">Coming up</h2>
            {deadlines.length === 0 ? (
              <EmptyState message="No upcoming deadlines." />
            ) : (
              <Card>
                {deadlines.slice(0, 8).map((d) => (
                  <Reminder
                    key={d.id}
                    date={formatDubaiDate(d.dueAt)}
                    title={d.kind.replace(/_/g, " ")}
                    sub={d.tenancy ? propertyLabel(d.tenancy.property) : undefined}
                  />
                ))}
              </Card>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

async function LandlordHome({ ctx }: { ctx: AuthzContext }) {
  const [properties, deadlines, verified] = await Promise.all([
    listProperties(ctx),
    listDeadlines(ctx),
    isLandlordVerified(ctx.workspaceId, ctx.subjectContactId),
  ]);
  const occupied = properties.filter((p) => p.tenancies.length > 0).length;
  const vacant = properties.length - occupied;

  return (
    <div>
      <PageHeader
        eyebrow="Your portfolio"
        title="Landlord portal"
        subtitle="The units you own, their occupancy, and upcoming dates — kept on your behalf. Seneschal never holds funds."
        actions={verified ? <Badge value="VERIFIED LANDLORD" /> : undefined}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Units owned" value={properties.length} />
        <KpiCard label="Occupied" value={occupied} tone="good" />
        <KpiCard label="Vacant" value={vacant} tone={vacant ? "warn" : "default"} />
      </div>

      {properties.length === 0 ? (
        <EmptyState message="No properties are linked to your account yet." />
      ) : (
        <Table headers={["Property", "Type", "Bedrooms", "Status"]}>
          {properties.map((p) => (
            <tr key={p.id}>
              <Td className="font-semibold text-navy-900">{propertyLabel(p)}</Td>
              <Td>{p.propertyType ?? "—"}</Td>
              <Td className="figure">{p.bedrooms ?? "—"}</Td>
              <Td><Badge value={p.tenancies.length > 0 ? "ACTIVE" : "VACANT"} /></Td>
            </tr>
          ))}
        </Table>
      )}

      <section className="mt-8">
        <h2 className="mb-3 font-display text-xl text-navy-900">Coming up</h2>
        {deadlines.length === 0 ? (
          <EmptyState message="No upcoming deadlines." />
        ) : (
          <Card>
            {deadlines.slice(0, 8).map((d) => (
              <Reminder
                key={d.id}
                date={formatDubaiDate(d.dueAt)}
                title={d.kind.replace(/_/g, " ")}
                sub={d.tenancy ? propertyLabel(d.tenancy.property) : undefined}
              />
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
