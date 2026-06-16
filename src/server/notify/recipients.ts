import type { Prisma, Role } from "@prisma/client";
import { prisma } from "../db";

// Single source of truth for "who oversees this workspace" — the internal users
// who receive alert notifications. Consolidates the membership lookup that
// alerts.ts and payments.ts each duplicated.

const OVERSEER_ROLES: Role[] = ["WORKSPACE_ADMIN", "FIDUCIARY", "MANAGER"];

/** Distinct userIds of active members holding an overseer role in this workspace. */
export async function workspaceOverseers(
  workspaceId: string,
  roles: Role[] = OVERSEER_ROLES,
  db: Prisma.TransactionClient = prisma,
): Promise<string[]> {
  const rows = await db.membership.findMany({
    where: { workspaceId, revokedAt: null, role: { in: roles } },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}
