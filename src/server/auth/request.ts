import { cookies } from "next/headers";
import { prisma } from "../db";
import { sessionUser } from "./index";
import { authz, AuthzError, type AuthzContext } from "../authz";

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
  const preferred = jar.get(WORKSPACE_COOKIE)?.value;
  if (preferred) {
    try {
      return await authz(user.id, preferred);
    } catch {
      // fall through to first membership
    }
  }
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, revokedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) throw new AuthzError("No workspace membership", 403);
  return authz(user.id, membership.workspaceId);
}

export async function requireStaff() {
  const user = await currentUser();
  if (!user) throw new AuthzError("Not signed in", 401);
  if (!user.isStaff) throw new AuthzError("Staff only", 403);
  return user;
}
