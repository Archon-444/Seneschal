import type { Membership, Role, User } from "@prisma/client";
import { prisma } from "./db";
import { roleHas, type Capability } from "./capabilities";

// Single authorization helper (T1.2 — release blocking).
// Every service function takes an AuthzContext; no Prisma call exists outside
// the service layer. CLIENT_VIEWER is scoped to exactly one ClientPrincipal.

export interface AuthzContext {
  userId: string;
  workspaceId: string;
  role: Role;
  /** Set for CLIENT_VIEWER: limits every read to this client's records. */
  clientPrincipalId: string | null;
  /** Set for TENANT | LANDLORD: limits every read to this Contact's records. */
  subjectContactId: string | null;
  /**
   * Set for MANAGING_AGENT: the ClientPrincipal ids this execution delegate may
   * read AND write. Empty for every other role; non-empty is the fail-closed
   * invariant for a delegate (an empty set would be a workspace-wide leak).
   */
  delegateClientIds: string[];
  isStaff: boolean;
  /** Staff acting on behalf of a user via the admin service path. */
  onBehalfOfId?: string;
}

/** TENANT and LANDLORD are single-Contact self-service personas. */
export function isPersonaRole(role: Role): role is "TENANT" | "LANDLORD" {
  return role === "TENANT" || role === "LANDLORD";
}

/**
 * MANAGING_AGENT is the execution delegate: read + broad write, but confined to
 * the set of ClientPrincipals on its membership (AuthzContext.delegateClientIds).
 * It is NOT a persona (no subjectContactId), so the fail-closed primitives gate it
 * by role, not by contact scope.
 */
export function isDelegateRole(role: Role): role is "MANAGING_AGENT" {
  return role === "MANAGING_AGENT";
}

export class AuthzError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

/** Resolve user → workspace → role → client scope. Throws if no membership. */
export async function authz(userId: string, workspaceId: string): Promise<AuthzContext> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AuthzError("Unknown user", 401);

  // A user may hold more than one role in a workspace (the @@unique key is on
  // [workspaceId, userId, role]); pick one deterministically by precedence rather
  // than letting row order decide which scope a request runs under.
  const memberships = await prisma.membership.findMany({
    where: { userId, workspaceId, revokedAt: null },
  });
  const membership = pickMembership(memberships);
  if (!membership) throw new AuthzError("No access to this workspace");

  return contextFromMembership(user, membership);
}

/**
 * Role precedence for deterministic membership resolution — lower wins. Operator/
 * staff roles outrank the self-service personas, so a user who is both an operator
 * and a TENANT/LANDLORD (same or different workspace) resolves to the operator role
 * and its broader scope, never a row-order accident. The exhaustive `Record<Role>`
 * is a tripwire: adding a role won't compile until it is ranked here.
 */
const ROLE_RANK: Record<Role, number> = {
  WORKSPACE_ADMIN: 0,
  FIDUCIARY: 1,
  MANAGER: 2,
  MANAGING_AGENT: 3,
  CLIENT_VIEWER: 4,
  AGENT: 5,
  LICENSED_PARTNER: 6,
  VENDOR: 7,
  AUDITOR: 8,
  LANDLORD: 9,
  TENANT: 10,
};

export function rolePrecedence(role: Role): number {
  return ROLE_RANK[role];
}

/**
 * Pick one membership deterministically: highest role precedence first, oldest
 * `createdAt` as a stable tiebreak. The single resolver both `authz()` (within a
 * workspace) and `requireCtx` (across workspaces) share, so persona vs. operator
 * scoping can never hinge on insertion order.
 */
export function pickMembership<M extends { role: Role; createdAt: Date }>(memberships: M[]): M | null {
  if (memberships.length === 0) return null;
  return [...memberships].sort(
    (a, b) => rolePrecedence(a.role) - rolePrecedence(b.role) || a.createdAt.getTime() - b.createdAt.getTime(),
  )[0];
}

export function contextFromMembership(user: User, membership: Membership): AuthzContext {
  if (membership.role === "CLIENT_VIEWER" && !membership.clientPrincipalId) {
    throw new AuthzError("CLIENT_VIEWER membership missing client scope");
  }
  if (isPersonaRole(membership.role) && !membership.subjectContactId) {
    throw new AuthzError(`${membership.role} membership missing contact scope`);
  }
  if (isDelegateRole(membership.role) && membership.assignedClientIds.length === 0) {
    // An unscoped delegate would read+write the whole workspace — fail closed,
    // exactly as a persona without a subjectContactId does above.
    throw new AuthzError("MANAGING_AGENT membership missing client scope");
  }
  return {
    userId: user.id,
    workspaceId: membership.workspaceId,
    role: membership.role,
    clientPrincipalId: membership.role === "CLIENT_VIEWER" ? membership.clientPrincipalId : null,
    subjectContactId: isPersonaRole(membership.role) ? membership.subjectContactId : null,
    delegateClientIds: isDelegateRole(membership.role) ? membership.assignedClientIds : [],
    isStaff: user.isStaff,
  };
}

/** Assert the context holds a capability. */
export function require_(ctx: AuthzContext, capability: Capability): void {
  if (!roleHas(ctx.role, capability)) {
    throw new AuthzError(`Role ${ctx.role} lacks ${capability}`);
  }
}

/**
 * Workspace filter every scoped query must include.
 *
 * Fail-closed (F0a): throws for a persona (TENANT | LANDLORD) context. A persona
 * needs contact-level scoping, not just workspace; any list/findMany path that
 * has not been routed through `contactScopedWhere` therefore 403s a persona
 * instead of returning the whole workspace. This is the list-family choke point.
 *
 * Same fail-closed treatment for a MANAGING_AGENT (F0d): a delegate is confined to
 * its assigned clients, so any list path not routed through `clientSetScopedWhere`
 * must throw rather than return every client's rows.
 */
export function scope(ctx: AuthzContext): { workspaceId: string } {
  if (ctx.subjectContactId) {
    throw new AuthzError("Persona context must be scoped via contactScopedWhere, not scope()");
  }
  if (isDelegateRole(ctx.role)) {
    throw new AuthzError("Delegate context must be scoped via clientSetScopedWhere, not scope()");
  }
  return { workspaceId: ctx.workspaceId };
}

/**
 * Client filter: for CLIENT_VIEWER returns the client restriction, otherwise
 * no extra restriction. Services apply it to client-linked tables.
 */
export function clientScope(ctx: AuthzContext): { clientPrincipalId?: string } {
  return ctx.clientPrincipalId ? { clientPrincipalId: ctx.clientPrincipalId } : {};
}

/**
 * Assert a fetched row belongs to the caller's workspace (defense in depth).
 *
 * Fail-closed (F0a): throws for a persona context. Workspace match is NOT a
 * sufficient read check for a TENANT | LANDLORD (a sibling tenant's row is in the
 * same workspace), so the by-id getters must use `assertReadable` instead. A
 * getter that still calls this with a persona context therefore fails closed.
 *
 * A MANAGING_AGENT (F0d) is gated the same way: workspace match is not a sufficient
 * check (a sibling client's row is in the same workspace), so delegate read/write
 * paths must use `assertReadable` / `assertClientInDelegateScope`. A path that still
 * calls this with a delegate context fails closed.
 */
export function assertSameWorkspace(
  ctx: AuthzContext,
  row: { workspaceId: string } | null,
): asserts row is { workspaceId: string } {
  if (ctx.subjectContactId) {
    throw new AuthzError("Persona context must be checked via assertReadable, not assertSameWorkspace");
  }
  if (isDelegateRole(ctx.role)) {
    throw new AuthzError("Delegate context must be checked via assertClientInDelegateScope, not assertSameWorkspace");
  }
  if (!row || row.workspaceId !== ctx.workspaceId) {
    // 404, not 403: never confirm existence of another workspace's records.
    throw new AuthzError("Not found", 404);
  }
}
