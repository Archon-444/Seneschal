import { type AuthzContext, hasCapability } from "../authz";
import { listClients } from "./clients";
import { listContacts } from "./contacts";
import { listProperties } from "./properties";

// Global jump-to search (⌘K palette). Composes the existing scoped list
// services — each already enforces its own capability and scope — so a hit
// can only ever be a record the caller could reach through that entity's own
// list page. Entity types the role can't read are skipped, not errored, so a
// narrower role still searches what it CAN see.

export type SearchHit = {
  type: "property" | "contact" | "client";
  id: string;
  label: string;
  sub?: string;
  href: string;
};

const PER_TYPE = 5;

export async function globalSearch(ctx: AuthzContext, q: string): Promise<SearchHit[]> {
  const query = q.trim();
  if (query.length < 2) return [];

  const [properties, contacts, clients] = await Promise.all([
    hasCapability(ctx, "properties.read") ? listProperties(ctx, { q: query }) : [],
    hasCapability(ctx, "contacts.read") ? listContacts(ctx, { q: query }) : [],
    hasCapability(ctx, "clients.read") ? listClients(ctx, { q: query }) : [],
  ]);

  return [
    ...properties.slice(0, PER_TYPE).map(
      (p): SearchHit => ({
        type: "property",
        id: p.id,
        label: [p.community, p.unitNo].filter(Boolean).join(" · "),
        sub: p.building ?? undefined,
        href: `/properties/${p.id}`,
      }),
    ),
    ...contacts.slice(0, PER_TYPE).map(
      (c): SearchHit => ({
        type: "contact",
        id: c.id,
        label: c.name,
        sub: [c.kind.replace(/_/g, " ").toLowerCase(), c.email].filter(Boolean).join(" · "),
        href: `/contacts/${c.id}`,
      }),
    ),
    ...clients.slice(0, PER_TYPE).map(
      (c): SearchHit => ({
        type: "client",
        id: c.id,
        label: c.displayName,
        href: `/clients/${c.id}`,
      }),
    ),
  ];
}
