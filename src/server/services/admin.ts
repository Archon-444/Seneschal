import type { Role, User } from "@prisma/client";
import { prisma } from "../db";
import { authz, AuthzError, type AuthzContext } from "../authz";
import { recordAudit } from "../audit";

// Admin service path (T1.5 — release blocking). The ONLY door for staff
// actions: every call requires User.isStaff and writes AuditEvent with
// on-behalf-of attribution. Normal app paths never reach these functions.

function assertStaff(staff: User): void {
  if (!staff.isStaff) throw new AuthzError("Staff only", 403);
}

export async function staffListWorkspaces(staff: User) {
  assertStaff(staff);
  await recordAudit({
    actorType: "STAFF",
    actorId: staff.id,
    verb: "workspace.list",
    objectType: "Workspace",
  });
  return prisma.workspace.findMany({
    orderBy: { createdAt: "desc" },
    include: { memberships: { include: { user: true } } },
  });
}

export async function staffListUsers(staff: User) {
  assertStaff(staff);
  await recordAudit({
    actorType: "STAFF",
    actorId: staff.id,
    verb: "user.list",
    objectType: "User",
  });
  return prisma.user.findMany({ orderBy: { createdAt: "desc" } });
}

export async function staffListNotifications(staff: User, workspaceId?: string) {
  assertStaff(staff);
  await recordAudit({
    workspaceId,
    actorType: "STAFF",
    actorId: staff.id,
    verb: "notification.list",
    objectType: "NotificationMessage",
  });
  return prisma.notificationMessage.findMany({
    where: workspaceId ? { workspaceId } : {},
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function staffListRiskFlags(staff: User, workspaceId?: string) {
  assertStaff(staff);
  await recordAudit({
    workspaceId,
    actorType: "STAFF",
    actorId: staff.id,
    verb: "riskflag.list",
    objectType: "RiskFlag",
  });
  return prisma.riskFlag.findMany({
    where: { ...(workspaceId ? { workspaceId } : {}), status: { in: ["OPEN", "ACKNOWLEDGED"] } },
    orderBy: { raisedAt: "desc" },
    take: 200,
  });
}

export async function staffListExtractionQueue(staff: User) {
  assertStaff(staff);
  await recordAudit({
    actorType: "STAFF",
    actorId: staff.id,
    verb: "extraction.list",
    objectType: "ExtractionJob",
  });
  return prisma.extractionJob.findMany({
    where: { status: { in: ["PENDING", "EXTRACTED", "REVIEWING"] } },
    orderBy: { createdAt: "asc" },
  });
}

export async function staffAuditStream(staff: User, workspaceId?: string) {
  assertStaff(staff);
  return prisma.auditEvent.findMany({
    where: workspaceId ? { workspaceId } : {},
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

/**
 * On-behalf-of acting: returns an AuthzContext impersonating a member of the
 * target workspace, with onBehalfOfId set so every downstream evidence/audit
 * row carries the attribution. Audited at acquisition.
 */
export async function staffActAs(
  staff: User,
  workspaceId: string,
  targetUserId: string,
): Promise<AuthzContext> {
  assertStaff(staff);
  const ctx = await authz(targetUserId, workspaceId);
  await recordAudit({
    workspaceId,
    actorType: "STAFF",
    actorId: staff.id,
    onBehalfOfId: targetUserId,
    verb: "staff.act_as",
    objectType: "Workspace",
    objectId: workspaceId,
  });
  return { ...ctx, isStaff: true, onBehalfOfId: targetUserId, userId: staff.id };
}

export async function staffCreateMembership(
  staff: User,
  args: { workspaceId: string; userId: string; role: Role; clientPrincipalId?: string },
) {
  assertStaff(staff);
  const membership = await prisma.membership.create({
    data: {
      workspaceId: args.workspaceId,
      userId: args.userId,
      role: args.role,
      clientPrincipalId: args.clientPrincipalId ?? null,
    },
  });
  await recordAudit({
    workspaceId: args.workspaceId,
    actorType: "STAFF",
    actorId: staff.id,
    onBehalfOfId: args.userId,
    verb: "membership.create",
    objectType: "Membership",
    objectId: membership.id,
  });
  return membership;
}
