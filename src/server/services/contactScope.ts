import type { Prisma, ScopeType } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError } from "../authz";
import { resolveClientScopeIds, scopeBelongsToClient } from "./clientScope";

// Persona (TENANT | LANDLORD) scoping. The demand/supply personas are scoped to
// exactly ONE Contact (Membership.subjectContactId). Like CLIENT_VIEWER on the
// scope-polymorphic tables, workspace filtering alone is NOT enough — a persona
// must only ever see the records reachable from their own Contact.
//
// SECURITY (F0a): the boundary fails CLOSED. `scope(ctx)` and `assertSameWorkspace`
// throw for a persona context, so any read path that has not been explicitly
// routed through `contactScopedWhere` (list family) or `assertReadable` (by-id
// family) 403s a persona instead of leaking the whole workspace. This module is
// the ONLY sanctioned door past that boundary.

export interface ContactScopeIds {
  contactId: string;
  propertyIds: string[];
  tenancyIds: string[];
  paymentItemIds: string[];
  proofRequestIds: string[];
  /** TENANT only: the tenant's own passport(s); passport documents scope here. */
  passportIds: string[];
}

type Db = Prisma.TransactionClient;

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Resolve every record id a single Contact's persona scope covers, fresh per
 * call (never cached on the context — a tenancy reassigned away must drop out
 * immediately, not at re-auth).
 *
 * TENANT  → starts from tenancies where they are the tenant.
 * LANDLORD→ starts from properties they own (incl. vacant) AND tenancies where
 *           they are the landlord, so an owner with no live tenancy still sees
 *           their unit (the 1B listings precondition).
 */
export async function resolveContactScopeIds(
  workspaceId: string,
  contactId: string,
  role: "TENANT" | "LANDLORD",
  db: Db = prisma,
): Promise<ContactScopeIds> {
  let propertyIds: string[] = [];
  let tenancyIds: string[] = [];
  let passportIds: string[] = [];

  if (role === "TENANT") {
    // Active tenancies only: a departed tenant must NOT retain scope over a unit
    // they have left (which would otherwise let them read a later tenant's
    // PROPERTY/TENANCY-scoped documents). Archived tenancies drop out of scope.
    const tenancies = await db.tenancy.findMany({
      where: { workspaceId, tenantContactId: contactId, archivedAt: null },
      select: { id: true, propertyId: true },
    });
    tenancyIds = tenancies.map((t) => t.id);
    propertyIds = unique(tenancies.map((t) => t.propertyId));
    const passports = await db.tenantPassport.findMany({
      where: { workspaceId, contactId },
      select: { id: true },
    });
    passportIds = passports.map((p) => p.id);
  } else {
    // LANDLORD. Two distinct grants, deliberately NOT merged:
    //  • OWNED property (ownerContactId) → every lease on the unit (ownership).
    //  • landlord-of-record on a specific tenancy (landlordContactId) → ONLY that
    //    tenancy — never the other leases on the same property. Otherwise an old
    //    landlord-of-record (e.g. before the unit was sold to a new owner) would read
    //    the new owner's tenancy, payments, deadlines and tenancy-scoped documents.
    const owned = await db.property.findMany({
      where: { workspaceId, ownerContactId: contactId },
      select: { id: true },
    });
    const ownedPropertyIds = owned.map((p) => p.id);
    const landlordTenancies = await db.tenancy.findMany({
      where: { workspaceId, landlordContactId: contactId, archivedAt: null },
      select: { id: true, propertyId: true },
    });
    propertyIds = unique([...ownedPropertyIds, ...landlordTenancies.map((t) => t.propertyId)]);
    // Every lease on an OWNED property, plus only the specific landlord-of-record ones.
    const ownedTenancies = ownedPropertyIds.length
      ? await db.tenancy.findMany({ where: { workspaceId, propertyId: { in: ownedPropertyIds } }, select: { id: true } })
      : [];
    tenancyIds = unique([...ownedTenancies.map((t) => t.id), ...landlordTenancies.map((t) => t.id)]);
  }

  const paymentItems = await db.paymentItem.findMany({
    where: { workspaceId, tenancyId: { in: tenancyIds } },
    select: { id: true },
  });
  const paymentItemIds = paymentItems.map((i) => i.id);

  const ownScopeIds = [...propertyIds, ...tenancyIds, ...paymentItemIds];
  const proofRequests = await db.proofRequest.findMany({
    where: { workspaceId, scopeId: { in: ownScopeIds } },
    select: { id: true },
  });
  const proofRequestIds = proofRequests.map((r) => r.id);

  return { contactId, propertyIds, tenancyIds, paymentItemIds, proofRequestIds, passportIds };
}

/** Prisma OR-clause matching scope-polymorphic rows inside a persona's scope. */
export function scopeMatchClausesContact(ids: ContactScopeIds): {
  scopeType: "PROPERTY" | "TENANCY" | "PAYMENT_ITEM" | "PROOF_REQUEST" | "TENANT_PASSPORT";
  scopeId: { in: string[] };
}[] {
  return [
    { scopeType: "PROPERTY", scopeId: { in: ids.propertyIds } },
    { scopeType: "TENANCY", scopeId: { in: ids.tenancyIds } },
    { scopeType: "PAYMENT_ITEM", scopeId: { in: ids.paymentItemIds } },
    { scopeType: "PROOF_REQUEST", scopeId: { in: ids.proofRequestIds } },
    { scopeType: "TENANT_PASSPORT", scopeId: { in: ids.passportIds } },
  ];
}

/** True when a scope-polymorphic row (scopeType/scopeId) is inside the persona scope. */
export function scopeBelongsToContact(
  ids: ContactScopeIds,
  scopeType: string,
  scopeId: string | null,
): boolean {
  if (!scopeId) return false;
  switch (scopeType) {
    case "PROPERTY":
      return ids.propertyIds.includes(scopeId);
    case "TENANCY":
      return ids.tenancyIds.includes(scopeId);
    case "PAYMENT_ITEM":
      return ids.paymentItemIds.includes(scopeId);
    case "PROOF_REQUEST":
      return ids.proofRequestIds.includes(scopeId);
    case "TENANT_PASSPORT":
      return ids.passportIds.includes(scopeId);
    default:
      // CLIENT (or anything else) is never inside a persona's contact scope.
      return false;
  }
}

/** Models a persona read can be scoped against via `contactScopedWhere`. */
export type ContactScopeTable =
  | "TENANCY"
  | "PROPERTY"
  | "PAYMENT_ITEM"
  | "DEADLINE"
  | "DOCUMENT"
  | "PROOF_REQUEST"
  | "LISTING";

/**
 * The ONLY sanctioned way a list/findMany read serves a persona context: returns
 * a workspace + contact-scoped `where` fragment for the given table. Callers must
 * branch `ctx.subjectContactId ? await contactScopedWhere(...) : { ...scope(ctx) }`
 * — the `scope(ctx)` arm throws for personas, so a path that forgets to branch
 * fails closed.
 */
export function contactScopedWhere(ctx: AuthzContext, table: "TENANCY"): Promise<Prisma.TenancyWhereInput>;
export function contactScopedWhere(ctx: AuthzContext, table: "PROPERTY"): Promise<Prisma.PropertyWhereInput>;
export function contactScopedWhere(ctx: AuthzContext, table: "PAYMENT_ITEM"): Promise<Prisma.PaymentItemWhereInput>;
export function contactScopedWhere(ctx: AuthzContext, table: "DEADLINE"): Promise<Prisma.DeadlineWhereInput>;
export function contactScopedWhere(ctx: AuthzContext, table: "DOCUMENT"): Promise<Prisma.DocumentWhereInput>;
export function contactScopedWhere(ctx: AuthzContext, table: "PROOF_REQUEST"): Promise<Prisma.ProofRequestWhereInput>;
export function contactScopedWhere(ctx: AuthzContext, table: "LISTING"): Promise<Prisma.ListingWhereInput>;
export async function contactScopedWhere(
  ctx: AuthzContext,
  table: ContactScopeTable,
): Promise<
  | Prisma.TenancyWhereInput
  | Prisma.PropertyWhereInput
  | Prisma.PaymentItemWhereInput
  | Prisma.DeadlineWhereInput
  | Prisma.DocumentWhereInput
  | Prisma.ProofRequestWhereInput
  | Prisma.ListingWhereInput
> {
  if (!ctx.subjectContactId || (ctx.role !== "TENANT" && ctx.role !== "LANDLORD")) {
    throw new AuthzError("contactScopedWhere requires a persona context");
  }
  const ids = await resolveContactScopeIds(ctx.workspaceId, ctx.subjectContactId, ctx.role);
  const ws = ctx.workspaceId;
  switch (table) {
    case "TENANCY":
      return { workspaceId: ws, id: { in: ids.tenancyIds } };
    case "PROPERTY":
      return { workspaceId: ws, id: { in: ids.propertyIds } };
    case "PAYMENT_ITEM":
      return { workspaceId: ws, tenancyId: { in: ids.tenancyIds } };
    case "DEADLINE":
      return {
        workspaceId: ws,
        OR: [{ propertyId: { in: ids.propertyIds } }, { tenancyId: { in: ids.tenancyIds } }],
      };
    case "DOCUMENT":
      return { workspaceId: ws, OR: scopeMatchClausesContact(ids) };
    case "PROOF_REQUEST":
      return { workspaceId: ws, id: { in: ids.proofRequestIds } };
    case "LISTING":
      // A listing belongs to its property; a persona sees only listings on the
      // properties in their owned-property id-set.
      return { workspaceId: ws, propertyId: { in: ids.propertyIds } };
  }
}

/**
 * The single sanctioned by-id read door. Replaces the `assertSameWorkspace` +
 * conditional `if (ctx.clientPrincipalId)` pattern in the four getters, covering
 * workspace + CLIENT_VIEWER + persona-contact checks in one place.
 *
 * Fail-closed contract: a persona context whose `target` cannot be resolved to a
 * contact-scope decision THROWS — it never falls back to a workspace-only check.
 */
export type ReadableTarget =
  | { kind: "tenancy"; row: { workspaceId: string; id: string; property: { clientPrincipalId: string | null } } | null }
  | { kind: "property"; row: { workspaceId: string; id: string; clientPrincipalId: string | null } | null }
  | { kind: "document"; row: { workspaceId: string; scopeType: ScopeType; scopeId: string | null } | null }
  | { kind: "proofRequest"; row: { workspaceId: string; id: string; scopeType: ScopeType; scopeId: string | null } | null }
  | { kind: "listing"; row: { workspaceId: string; propertyId: string } | null };

export async function assertReadable(ctx: AuthzContext, target: ReadableTarget): Promise<void> {
  const row = target.row;
  // Workspace match first — 404, never confirm another workspace's records exist.
  if (!row || row.workspaceId !== ctx.workspaceId) {
    throw new AuthzError("Not found", 404);
  }

  // CLIENT_VIEWER: restrict to the viewer's client (mirrors the prior per-getter logic).
  if (ctx.clientPrincipalId) {
    const ids = await resolveClientScopeIds(ctx.workspaceId, ctx.clientPrincipalId);
    const ok =
      target.kind === "tenancy"
        ? target.row!.property.clientPrincipalId === ctx.clientPrincipalId
        : target.kind === "property"
          ? target.row!.clientPrincipalId === ctx.clientPrincipalId
          : target.kind === "proofRequest"
            ? ids.proofRequestIds.includes(target.row!.id)
            : target.kind === "listing"
              ? false // listings are not client-scoped; CLIENT_VIEWER lacks listings.read — fail closed
              : scopeBelongsToClient(ids, target.row!.scopeType, target.row!.scopeId);
    if (!ok) throw new AuthzError("Not found", 404);
    return;
  }

  // TENANT | LANDLORD: restrict to records reachable from their Contact.
  if (ctx.subjectContactId && (ctx.role === "TENANT" || ctx.role === "LANDLORD")) {
    const ids = await resolveContactScopeIds(ctx.workspaceId, ctx.subjectContactId, ctx.role);
    const ok =
      target.kind === "tenancy"
        ? ids.tenancyIds.includes(target.row!.id)
        : target.kind === "property"
          ? ids.propertyIds.includes(target.row!.id)
          : target.kind === "proofRequest"
            ? ids.proofRequestIds.includes(target.row!.id)
            : target.kind === "listing"
              ? ids.propertyIds.includes(target.row!.propertyId)
              : scopeBelongsToContact(ids, target.row!.scopeType, target.row!.scopeId);
    if (!ok) throw new AuthzError("Not found", 404);
    return;
  }

  // Operator roles: workspace match is sufficient (capability gate ran upstream).
}
