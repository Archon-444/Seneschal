import { prisma } from "../db";
import { type AuthzContext } from "../authz";
import { recordAudit } from "../audit";

// Self-service profile edits. A user updates only their own name/locale (the
// session identity), so the boundary is ctx.userId — no capability needed.

export interface ProfileInput {
  name?: string;
  locale?: string;
}

export async function getMyProfile(ctx: AuthzContext) {
  return prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { id: true, name: true, email: true, locale: true },
  });
}

export async function updateProfile(ctx: AuthzContext, input: ProfileInput): Promise<void> {
  const data: { name?: string; locale?: string } = {};
  if (input.name?.trim()) data.name = input.name.trim();
  if (input.locale?.trim()) data.locale = input.locale.trim();
  if (Object.keys(data).length === 0) return;

  await prisma.user.update({ where: { id: ctx.userId }, data });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "profile.update",
    objectType: "User",
    objectId: ctx.userId,
  });
}
