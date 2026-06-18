import { cookies } from "next/headers";
import type { Role } from "@prisma/client";
import { prisma } from "../db";
import { sessionUser } from "./index";
import {
  authz,
  AuthzError,
  isPersonaRole,
  pickMembership,
  type AuthzContext,
  type PlatformAdminContext,
} from "../authz";

export const SESSION_COOKIE = "seneschal_session";
export const WORKSPACE_COOKIE = "seneschal_workspace";

/** Resolve the signed-in user from the request cookies, or null. */
export async function currentUser() {
  const jar = await cookies();
  return sessionUser(jar.get(SESSION_COOKIE)?.value);
}

/**
 * Resolve the full authz context for the active workspace. Throws AuthzError
 * (401) when not signed in. Server components and API routes both use this —
 * it is the only door into the service layer.
 */
export async function requireCtx(): Promise<AuthzContext> {
  const user = await currentUser();
  if (!user) throw new AuthzError("Not signed in", 401);
  const jar = await cookies();
  return resolveCtxFor(user.id, jar.get(WORKSPACE_COOKIE)?.value ?? null);
}

/**
 * Resolve a user's context for a preferred workspace, falling back to their highest-precedence
 * membership. Extracted from `requireCtx` (which only adds the cookie read) so the fail-closed
 * decision is testable without a request context.
 *
 * Fail-closed boundary: fall through to the fallback ONLY when the preferred workspace is genuinely
 * inaccessible (an `AuthzError` — e.g. the cookie points at a workspace the user lost). An
 * INFRASTRUCTURE error (a failing grant/assignment load inside `authz`) must NOT be swallowed into a
 * silent switch to a different workspace — it propagates as a denial, never a scope-switch.
 */
export async function resolveCtxFor(userId: string, preferred: string | null): Promise<AuthzContext> {
  if (preferred) {
    try {
      return await authz(userId, preferred);
    } catch (e) {
      if (!(e instanceof AuthzError)) throw e;
    }
  }
  // No (accessible) preferred workspace: choose the highest-precedence membership across all
  // workspaces (operator roles over personas), not merely the oldest row, so a user who is both an
  // operator and a tenant lands in a deterministic scope.
  const memberships = await prisma.membership.findMany({
    where: { userId, revokedAt: null },
  });
  const membership = pickMembership(memberships);
  if (!membership) throw new AuthzError("No workspace membership", 403);
  return authz(userId, membership.workspaceId);
}

/**
 * The single redirect-target resolver (no ping-pong): personas live under /portal,
 * every operator/staff role under /dashboard. Used by the route-group layouts, the
 * login action, and the root page so targets are deterministic.
 */
export function homePathFor(role: Role): string {
  if (isPersonaRole(role)) return "/portal";
  // A decorrelated org-admin holds no data caps, so the data dashboard isn't its home.
  if (role === "ORG_ADMIN") return "/members";
  return "/dashboard";
}

/**
 * The platform-operator door. Returns a PlatformAdminContext that carries no scope and
 * cannot be passed to a data service (compile error — F-Admin §5). A platform admin holds
 * no Membership, so they can never obtain an AuthzContext for any workspace.
 */
export async function requirePlatformAdmin(): Promise<PlatformAdminContext> {
  const user = await currentUser();
  if (!user) throw new AuthzError("Not signed in", 401);
  if (!user.isPlatformAdmin) throw new AuthzError("Platform admin only", 403);
  return { kind: "platform", userId: user.id };
}
