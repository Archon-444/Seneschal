import type { Cadence, NotificationCategory, Prisma } from "@prisma/client";
import { prisma } from "../db";

// Email cadence resolution. Absence of a stored row means the default — so
// nothing needs backfilling. Routine categories default to DAILY (rolled into
// one digest); the portfolio DIGEST summary defaults to WEEKLY.

export function defaultCadence(category: NotificationCategory): Cadence {
  return category === "DIGEST" ? "WEEKLY" : "DAILY";
}

/** A `(userId, category) → cadence` resolver. Batch-loaded once per workspace run
 *  (no per-recipient N+1), stored rows layered over the defaults. */
export interface PreferenceMap {
  cadence(userId: string, category: NotificationCategory): Cadence;
}

export async function loadPreferenceMap(
  workspaceId: string,
  userIds: string[],
  db: Prisma.TransactionClient = prisma,
): Promise<PreferenceMap> {
  const rows = userIds.length
    ? await db.notificationPreference.findMany({
        where: { workspaceId, userId: { in: userIds } },
        select: { userId: true, category: true, cadence: true },
      })
    : [];
  const byKey = new Map(rows.map((r) => [`${r.userId}:${r.category}`, r.cadence]));
  return {
    cadence(userId, category) {
      return byKey.get(`${userId}:${category}`) ?? defaultCadence(category);
    },
  };
}
