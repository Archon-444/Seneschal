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
  isStaff: boolean;
  /** Staff acting on behalf of a user via the admin service path. */
  onBehalfOfId?: string;
}

/** TENANT and LANDLORD are single-Contact self-service personas. */
export function isPersonaRole(role: Role): role is "TENANT" | "LANDLORD" {
  return role === "TENANT" || role === "LANDLORD";
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

  const membership = await prisma.membership.findFirst({
    where: { userId, workspaceId, revokedAt: null },
  });
  if (!membership) throw new AuthzError("No access to this workspace");

  return contextFromMembership(user, membership);
}

export function contextFromMembership(user: User, membership: Membership): AuthzContext {
  if (membership.role === "CLIENT_VIEWER" && !membership.clientPrincipalId) {
    throw new AuthzError("CLIENT_VIEWER membership missing client scope");
  }
  if (isPersonaRole(membership.role) && !membership.subjectContactId) {
    throw new AuthzError(`${membership.role} membership missing contact scope`);
  }
  return {
    userId: user.id,
    workspaceId: membership.workspaceId,
    role: membership.role,
    clientPrincipalId: membership.role === "CLIENT_VIEWER" ? membership.clientPrincipalId : null,
    subjectContactId: isPersonaRole(membership.role) ? membership.subjectContactId : null,
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
 */
export function scope(ctx: AuthzContext): { workspaceId: string } {
  if (ctx.subjectContactId) {
    throw new AuthzError("Persona context must be scoped via contactScopedWhere, not scope()");
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
 */
export function assertSameWorkspace(
  ctx: AuthzContext,
  row: { workspaceId: string } | null,
): asserts row is { workspaceId: string } {
  if (ctx.subjectContactId) {
    throw new AuthzError("Persona context must be checked via assertReadable, not assertSameWorkspace");
  }
  if (!row || row.workspaceId !== ctx.workspaceId) {
    // 404, not 403: never confirm existence of another workspace's records.
    throw new AuthzError("Not found", 404);
  }
}
