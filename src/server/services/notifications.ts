import type { Cadence, NotificationCategory } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError } from "../authz";
import { defaultCadence } from "../notify/preferences";

// In-app notification feed + preferences. A feed is SELF-DATA: the boundary is
// recipiency (toUserId == ctx.userId within the workspace), not a portfolio
// capability — any authenticated member reads, marks, and configures only their
// own feed. Reads are scoped to INAPP rows.

const CATEGORIES: NotificationCategory[] = ["DEADLINES", "PAYMENTS", "RENEWALS", "PROOFS", "RISK", "DIGEST"];

function feedScope(ctx: AuthzContext) {
  return { workspaceId: ctx.workspaceId, toUserId: ctx.userId, channel: "INAPP" as const };
}

export async function listMyNotifications(
  ctx: AuthzContext,
  opts?: { cursor?: string; limit?: number; unreadOnly?: boolean },
) {
  const limit = Math.min(opts?.limit ?? 20, 100);
  const items = await prisma.notificationMessage.findMany({
    where: { ...feedScope(ctx), ...(opts?.unreadOnly ? { readAt: null } : {}) },
    orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
    take: limit + 1,
    ...(opts?.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const nextCursor = items.length > limit ? items[limit].id : null;
  return { items: items.slice(0, limit), nextCursor };
}

export async function unreadCount(ctx: AuthzContext): Promise<number> {
  return prisma.notificationMessage.count({ where: { ...feedScope(ctx), readAt: null } });
}

export async function markRead(ctx: AuthzContext, messageId: string): Promise<void> {
  const msg = await prisma.notificationMessage.findUnique({ where: { id: messageId } });
  // 404 (never confirm another workspace/user's record) unless it's the caller's own feed item.
  if (!msg || msg.workspaceId !== ctx.workspaceId || msg.toUserId !== ctx.userId || msg.channel !== "INAPP") {
    throw new AuthzError("Not found", 404);
  }
  if (msg.readAt) return; // idempotent
  await prisma.notificationMessage.update({ where: { id: messageId }, data: { readAt: new Date() } });
}

export async function markAllRead(ctx: AuthzContext): Promise<number> {
  const res = await prisma.notificationMessage.updateMany({
    where: { ...feedScope(ctx), readAt: null },
    data: { readAt: new Date() },
  });
  return res.count;
}

export interface CategoryPreference {
  category: NotificationCategory;
  cadence: Cadence;
  inAppEnabled: boolean;
}

/** Stored rows layered over defaults, one entry per category. */
export async function getMyNotificationPreferences(ctx: AuthzContext): Promise<CategoryPreference[]> {
  const rows = await prisma.notificationPreference.findMany({
    where: { workspaceId: ctx.workspaceId, userId: ctx.userId },
  });
  const byCat = new Map(rows.map((r) => [r.category, r]));
  return CATEGORIES.map((category) => {
    const row = byCat.get(category);
    return {
      category,
      cadence: row?.cadence ?? defaultCadence(category),
      inAppEnabled: row?.inAppEnabled ?? true,
    };
  });
}

export async function setNotificationPreference(
  ctx: AuthzContext,
  category: NotificationCategory,
  cadence: Cadence,
  inAppEnabled = true,
): Promise<void> {
  await prisma.notificationPreference.upsert({
    where: { workspaceId_userId_category: { workspaceId: ctx.workspaceId, userId: ctx.userId, category } },
    create: { workspaceId: ctx.workspaceId, userId: ctx.userId, category, cadence, inAppEnabled },
    update: { cadence, inAppEnabled },
  });
}
