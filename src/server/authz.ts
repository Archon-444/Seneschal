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
  isStaff: boolean;
  /** Staff acting on behalf of a user via the admin service path. */
  onBehalfOfId?: string;
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
  return {
    userId: user.id,
    workspaceId: membership.workspaceId,
    role: membership.role,
    clientPrincipalId: membership.role === "CLIENT_VIEWER" ? membership.clientPrincipalId : null,
    isStaff: user.isStaff,
  };
}

/** Assert the context holds a capability. */
export function require_(ctx: AuthzContext, capability: Capability): void {
  if (!roleHas(ctx.role, capability)) {
    throw new AuthzError(`Role ${ctx.role} lacks ${capability}`);
  }
}

/** Workspace filter every scoped query must include. */
export function scope(ctx: AuthzContext): { workspaceId: string } {
  return { workspaceId: ctx.workspaceId };
}

/**
 * Client filter: for CLIENT_VIEWER returns the client restriction, otherwise
 * no extra restriction. Services apply it to client-linked tables.
 */
export function clientScope(ctx: AuthzContext): { clientPrincipalId?: string } {
  return ctx.clientPrincipalId ? { clientPrincipalId: ctx.clientPrincipalId } : {};
}

/** Assert a fetched row belongs to the caller's workspace (defense in depth). */
export function assertSameWorkspace(
  ctx: AuthzContext,
  row: { workspaceId: string } | null,
): asserts row is { workspaceId: string } {
  if (!row || row.workspaceId !== ctx.workspaceId) {
    // 404, not 403: never confirm existence of another workspace's records.
    throw new AuthzError("Not found", 404);
  }
}
