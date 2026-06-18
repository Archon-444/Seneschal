import type { Prisma, ScopeType } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, isDelegateRole } from "../authz";
import { resolveClientScopeIds, scopeMatchClauses, type ClientScopeIds } from "./clientScope";

// Execution-delegate (MANAGING_AGENT) scoping — F0d. A delegate reads AND writes,
// but every path is confined to the set of ClientPrincipals on its membership
// (AuthzContext.delegateClientIds). It is NOT a persona; the fail-closed primitives
// (`scope`, `assertSameWorkspace`) throw for a delegate context, so any read path not
// routed through `clientSetScopedWhere` and any write not gated by
// `assertClientInDelegateScope` / `assertDelegateClientId` 403/404s instead of
// leaking across clients. This module is the ONLY sanctioned door past that boundary.
//
// A delegate's scope keys on the single pivot every record reaches its client
// through — `Property.clientPrincipalId` — so the resolution reuses CLIENT_VIEWER's
// `resolveClientScopeIds` with `{ in: delegateClientIds }` (one query, no per-client
// fan-out). Only the scope-polymorphic tables (Document, ProofRequest) genuinely
// need the resolved id-set; the rest fall out of the same struct.

type Db = Prisma.TransactionClient;

function unique(ids: (string | null)[]): string[] {
  return [...new Set(ids.filter((x): x is string => !!x))];
}

function assertDelegate(ctx: AuthzContext): void {
  if (!isDelegateRole(ctx.role) || ctx.delegateClientIds.length === 0) {
    throw new AuthzError("clientSetScopedWhere requires a delegate (MANAGING_AGENT) context");
  }
}

/** Resolve the record-id set the delegate's assigned clients cover (fresh per request). */
export function resolveDelegateScopeIds(ctx: AuthzContext, db: Db = prisma): Promise<ClientScopeIds> {
  return resolveClientScopeIds(ctx.workspaceId, ctx.delegateClientIds, db);
}

/**
 * Contacts a delegate may see: those referenced as tenant/landlord on an in-scope
 * tenancy or owner on an in-scope property. `Contact` has no client column and no
 * creator column, so scope is derived from the assigned clients' rows — a delegate
 * that attaches a contact to an in-scope tenancy makes it visible automatically.
 */
export async function resolveDelegateContactIds(
  ctx: AuthzContext,
  ids: ClientScopeIds,
  db: Db = prisma,
): Promise<string[]> {
  const ws = ctx.workspaceId;
  const props = ids.propertyIds.length
    ? await db.property.findMany({ where: { workspaceId: ws, id: { in: ids.propertyIds } }, select: { ownerContactId: true } })
    : [];
  const tens = ids.tenancyIds.length
    ? await db.tenancy.findMany({
        where: { workspaceId: ws, id: { in: ids.tenancyIds } },
        select: { tenantContactId: true, landlordContactId: true },
      })
    : [];
  return unique([
    ...props.map((p) => p.ownerContactId),
    ...tens.map((t) => t.tenantContactId),
    ...tens.map((t) => t.landlordContactId),
  ]);
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
 * workspace + assigned-client-scoped `where` for the given table. Callers branch
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
      return { workspaceId: ws, OR: scopeMatchClauses(ids) };
    case "PROOF_REQUEST":
      return { workspaceId: ws, id: { in: ids.proofRequestIds } };
    case "CONTACT":
      return { workspaceId: ws, id: { in: await resolveDelegateContactIds(ctx, ids) } };
  }
}

/**
 * Write door — existing-row form. Workspace match AND the row's owning client ∈ the
 * delegate's assigned set, else 404 (never confirm a sibling client's row exists).
 * Use after the parent `findUnique` in delegate-reachable mutations.
 */
export function assertClientInDelegateScope(
  ctx: AuthzContext,
  row: { workspaceId: string; clientPrincipalId: string | null } | null,
): asserts row is { workspaceId: string; clientPrincipalId: string | null } {
  if (!row || row.workspaceId !== ctx.workspaceId) throw new AuthzError("Not found", 404);
  if (!row.clientPrincipalId || !ctx.delegateClientIds.includes(row.clientPrincipalId)) {
    throw new AuthzError("Not found", 404);
  }
}

/**
 * Write door — create-input form. Gates a create on the *input* client id before any
 * row exists (e.g. `createProperty`'s FIDUCIARY guard runs on `data.clientPrincipalId`).
 * The assigned set is workspace-bound by construction, so set-membership is sufficient.
 */
export function assertDelegateClientId(ctx: AuthzContext, clientPrincipalId: string | null): asserts clientPrincipalId is string {
  if (!clientPrincipalId || !ctx.delegateClientIds.includes(clientPrincipalId)) {
    throw new AuthzError("Not found", 404);
  }
}

/** Resolve a scope-polymorphic (Document/ProofRequest) scope to its owning client. */
export async function clientOfScope(
  workspaceId: string,
  scopeType: ScopeType,
  scopeId: string | null,
  db: Db = prisma,
): Promise<string | null> {
  if (!scopeId) return null;
  switch (scopeType) {
    case "CLIENT":
      return scopeId;
    case "PROPERTY": {
      const p = await db.property.findFirst({ where: { workspaceId, id: scopeId }, select: { clientPrincipalId: true } });
      return p?.clientPrincipalId ?? null;
    }
    case "TENANCY": {
      const t = await db.tenancy.findFirst({
        where: { workspaceId, id: scopeId },
        select: { property: { select: { clientPrincipalId: true } } },
      });
      return t?.property.clientPrincipalId ?? null;
    }
    case "PAYMENT_ITEM": {
      const i = await db.paymentItem.findFirst({
        where: { workspaceId, id: scopeId },
        select: { tenancy: { select: { property: { select: { clientPrincipalId: true } } } } },
      });
      return i?.tenancy.property.clientPrincipalId ?? null;
    }
    default:
      return null;
  }
}
