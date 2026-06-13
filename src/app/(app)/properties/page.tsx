import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { listProperties } from "@/server/services/properties";
import { listClients } from "@/server/services/clients";
import { formatDubaiDate } from "@/server/calculators/dates";
import { Badge, EmptyState, LinkButton, Money, PageHeader, SearchForm, Table, Td } from "@/components/ui";

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const ctx = await requireCtx();
  const [properties, clients] = await Promise.all([listProperties(ctx, { q }), listClients(ctx)]);
  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.displayName ?? "—";

  return (
    <>
      <PageHeader
        title="Properties"
        subtitle={`${properties.length} under oversight`}
        actions={
          <>
            <LinkButton href="/properties/new">Add property</LinkButton>
            <LinkButton href="/onboarding/new" variant="primary">Onboard tenancy</LinkButton>
          </>
        }
      />
      <SearchForm q={q} placeholder="Search community, building, unit, Ejari…" />
      {properties.length === 0 ? (
        <EmptyState message={q ? `No properties match “${q}”.` : "No properties yet. Add one manually or import from a contract."} />
      ) : (
        <Table headers={["Property", "Client", "Current tenancy", "Rent", "Ends"]}>
          {properties.map((p) => {
            const t = p.tenancies[0];
            return (
              <tr key={p.id} className="hover:bg-ivory-50">
                <Td>
                  <Link href={`/properties/${p.id}`} className="font-medium text-navy-900 hover:underline">
                    {p.community}
                    {p.building ? ` · ${p.building}` : ""}
                    {p.unitNo ? ` · ${p.unitNo}` : ""}
                  </Link>
                  <div className="text-xs text-navy-300">
                    {p.propertyType ?? ""}{p.bedrooms != null ? ` · ${p.bedrooms || "Studio"} BR` : ""}
                  </div>
                </Td>
                <Td>{clientName(p.clientPrincipalId)}</Td>
                <Td>{t ? <Badge value={t.status} /> : <span className="text-navy-300">vacant</span>}</Td>
                <Td>{t ? <Money amount={String(t.annualRent)} /> : "—"}</Td>
                <Td className="figure whitespace-nowrap">{t ? formatDubaiDate(t.endDate) : "—"}</Td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
