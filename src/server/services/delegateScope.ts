import type { Prisma, ScopeType } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, isDelegateRole } from "../authz";
import {
  contactIdsForScope,
  inIds,
  scopeMatchClauses,
  type ClientScopeIds,
} from "./clientScope";

// Execution-delegate (MANAGING_AGENT) scoping — F0d. A delegate reads AND writes,
// but every path is confined to the properties on its membership
// (AuthzContext.delegatePropertyIds). It is NOT a persona; the fail-closed primitives
// (`scope`, `assertSameWorkspace`) throw for a delegate context, so any read path not
// routed through `clientSetScopedWhere` and any write not gated by
// `assertPropertyInDelegateScope` / `assertDelegatePropertyId` 404s instead of
// leaking across properties. This module is the ONLY sanctioned door past that boundary.
//
// The book keys on Property.id — not ClientPrincipal — so a vacant sibling unit of an
// assigned client's other properties stays invisible until it is assigned. Empty
// `delegatePropertyIds` is a valid login: every `in:` filter uses `inIds` so Prisma
// cannot drop an empty IN () and return the whole workspace.

type Db = Prisma.TransactionClient;

function assertDelegate(ctx: AuthzContext): void {
  if (!isDelegateRole(ctx.role)) {
    throw new AuthzError("clientSetScopedWhere requires a delegate (MANAGING_AGENT) context");
  }
}

/** Resolve the record-id set the delegate's assigned properties cover (fresh per request). */
export async function resolveDelegateScopeIds(ctx: AuthzContext, db: Db = prisma): Promise<ClientScopeIds> {
  assertDelegate(ctx);
  const ws = ctx.workspaceId;
  const propertyIds = ctx.delegatePropertyIds;
  const tenancies = await db.tenancy.findMany({
    where: { workspaceId: ws, propertyId: inIds(propertyIds) },
    select: { id: true },
  });
  const tenancyIds = tenancies.map((t) => t.id);
  const paymentItems = await db.paymentItem.findMany({
    where: { workspaceId: ws, tenancyId: inIds(tenancyIds) },
    select: { id: true },
  });
  const paymentItemIds = paymentItems.map((i) => i.id);
  // CLIENT-scoped rows are NOT in the book — they describe the whole client, including
  // vacant units the agent does not hold.
  const ownScopeIds = [...propertyIds, ...tenancyIds, ...paymentItemIds];
  const proofRequests = await db.proofRequest.findMany({
    where: { workspaceId: ws, scopeId: inIds(ownScopeIds) },
    select: { id: true },
  });
  return {
    clientPrincipalId: "",
    clientPrincipalIds: [],
    propertyIds,
    tenancyIds,
    paymentItemIds,
    proofRequestIds: proofRequests.map((r) => r.id),
  };
}

/**
 * Contacts a delegate may see: those referenced as tenant/landlord on an in-scope
 * tenancy or owner on an in-scope property. `Contact` has no client column and no
 * creator column, so scope is derived from the assigned properties' rows.
 */
export function resolveDelegateContactIds(
  ctx: AuthzContext,
  ids: ClientScopeIds,
  db: Db = prisma,
): Promise<string[]> {
  return contactIdsForScope(ctx.workspaceId, ids, db);
}

/** Models a delegate read can be scoped against via `clientSetScopedWhere`. */
export type DelegateScopeTable =
  | "TENANCY"
  | "PROPERTY"
  | "PAYMENT_ITEM"
  | "DEADLINE"
  | "DOCUMENT"
  | "PROOF_REQUEST"
  | "CONTACT";

/**
 * The ONLY sanctioned way a list/findMany read serves a delegate context: returns a
 * workspace + assigned-property-scoped `where` for the given table. Callers branch
 * `isDelegateRole(ctx.role) ? await clientSetScopedWhere(...) : { ...scope(ctx), ... }`
 * — the `scope(ctx)` arm throws for a delegate, so a path that forgets to branch fails closed.
 */
export function clientSetScopedWhere(ctx: AuthzContext, table: "TENANCY"): Promise<Prisma.TenancyWhereInput>;
export function clientSetScopedWhere(ctx: AuthzContext, table: "PROPERTY"): Promise<Prisma.PropertyWhereInput>;
export function clientSetScopedWhere(ctx: AuthzContext, table: "PAYMENT_ITEM"): Promise<Prisma.PaymentItemWhereInput>;
export function clientSetScopedWhere(ctx: AuthzContext, table: "DEADLINE"): Promise<Prisma.DeadlineWhereInput>;
export function clientSetScopedWhere(ctx: AuthzContext, table: "DOCUMENT"): Promise<Prisma.DocumentWhereInput>;
export function clientSetScopedWhere(ctx: AuthzContext, table: "PROOF_REQUEST"): Promise<Prisma.ProofRequestWhereInput>;
export function clientSetScopedWhere(ctx: AuthzContext, table: "CONTACT"): Promise<Prisma.ContactWhereInput>;
export async function clientSetScopedWhere(
  ctx: AuthzContext,
  table: DelegateScopeTable,
): Promise<
  | Prisma.TenancyWhereInput
  | Prisma.PropertyWhereInput
  | Prisma.PaymentItemWhereInput
  | Prisma.DeadlineWhereInput
  | Prisma.DocumentWhereInput
  | Prisma.ProofRequestWhereInput
  | Prisma.ContactWhereInput
> {
  assertDelegate(ctx);
  const ids = await resolveDelegateScopeIds(ctx);
  const ws = ctx.workspaceId;
  switch (table) {
    case "TENANCY":
      return { workspaceId: ws, id: inIds(ids.tenancyIds) };
    case "PROPERTY":
      return { workspaceId: ws, id: inIds(ids.propertyIds) };
    case "PAYMENT_ITEM":
      return { workspaceId: ws, tenancyId: inIds(ids.tenancyIds) };
    case "DEADLINE":
      return {
        workspaceId: ws,
        OR: [{ propertyId: inIds(ids.propertyIds) }, { tenancyId: inIds(ids.tenancyIds) }],
      };
    case "DOCUMENT":
      return { workspaceId: ws, OR: scopeMatchClauses(ids) };
    case "PROOF_REQUEST":
      return { workspaceId: ws, id: inIds(ids.proofRequestIds) };
    case "CONTACT":
      return { workspaceId: ws, id: inIds(await resolveDelegateContactIds(ctx, ids)) };
  }
}

/**
 * Write door — existing-row form. Workspace match AND the row's property ∈ the
 * delegate's book, else 404 (never confirm a sibling unit exists).
 */
export function assertPropertyInDelegateScope(
  ctx: AuthzContext,
  row: { workspaceId: string } | null,
  propertyId: string | null | undefined,
): asserts row is { workspaceId: string } {
  if (!row || row.workspaceId !== ctx.workspaceId) throw new AuthzError("Not found", 404);
  assertDelegatePropertyId(ctx, propertyId ?? null);
}

/**
 * Write door — property-id form. The assigned set is workspace-bound by construction.
 */
export function assertDelegatePropertyId(
  ctx: AuthzContext,
  propertyId: string | null,
): asserts propertyId is string {
  if (!propertyId || !ctx.delegatePropertyIds.includes(propertyId)) {
    throw new AuthzError("Not found", 404);
  }
}

/**
 * Create-input form: a delegate may attach a new property only to a client they
 * already serve (at least one assigned property of that client). Empty book → 404.
 */
export async function assertDelegateServesClient(
  ctx: AuthzContext,
  clientPrincipalId: string | null,
  db: Db = prisma,
): Promise<void> {
  if (!clientPrincipalId) throw new AuthzError("Not found", 404);
  if (ctx.delegatePropertyIds.length === 0) throw new AuthzError("Not found", 404);
  const hit = await db.property.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      id: inIds(ctx.delegatePropertyIds),
      clientPrincipalId,
    },
    select: { id: true },
  });
  if (!hit) throw new AuthzError("Not found", 404);
}

/** Resolve a scope-polymorphic (Document/ProofRequest) scope to its owning property. */
export async function propertyIdOfScope(
  workspaceId: string,
  scopeType: ScopeType,
  scopeId: string | null,
  db: Db = prisma,
): Promise<string | null> {
  if (!scopeId) return null;
  switch (scopeType) {
    case "PROPERTY":
      return (await db.property.findFirst({ where: { workspaceId, id: scopeId }, select: { id: true } }))?.id ?? null;
    case "TENANCY": {
      const t = await db.tenancy.findFirst({
        where: { workspaceId, id: scopeId },
        select: { propertyId: true },
      });
      return t?.propertyId ?? null;
    }
    case "PAYMENT_ITEM": {
      const i = await db.paymentItem.findFirst({
        where: { workspaceId, id: scopeId },
        select: { tenancy: { select: { propertyId: true } } },
      });
      return i?.tenancy.propertyId ?? null;
    }
    default:
      // CLIENT / WORKSPACE / etc. are not a property in the book.
      return null;
  }
}
