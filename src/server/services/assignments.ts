import { prisma } from "../db";
import { type AuthzContext, AuthzError, require_ } from "../authz";
import { recordAudit } from "../audit";

// F-Admin (D3): the people×clients assignment grid backend. Toggling a cell creates or revokes
// a ClientAssignment — the exact live rows resolveClientScopeIds reads to build a delegate's
// scope. Gated by clients.assign (held by PRINCIPAL/ORG_ADMIN people-power, never a delegate
// itself); every toggle writes an AuditEvent. Assigning agent Samir to "Client A" is precisely
// what makes his scope(ctx) resolve to Client A and fail closed on every sibling.

function auditActor(ctx: AuthzContext) {
  return {
    workspaceId: ctx.workspaceId,
    actorType: (ctx.isStaff ? "STAFF" : "USER") as "STAFF" | "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
  };
}

async function assertDelegateMembership(ctx: AuthzContext, membershipId: string): Promise<void> {
  const m = await prisma.membership.findUnique({
    where: { id: membershipId },
    select: { workspaceId: true, role: true, revokedAt: true },
  });
  if (!m || m.workspaceId !== ctx.workspaceId || m.revokedAt) throw new AuthzError("Not found", 404);
  if (m.role !== "MANAGING_AGENT") {
    throw new AuthzError("Assignments apply only to delegate (MANAGING_AGENT) memberships", 422);
  }
}

async function assertClientInWorkspace(ctx: AuthzContext, clientPrincipalId: string): Promise<void> {
  const c = await prisma.clientPrincipal.findUnique({
    where: { id: clientPrincipalId },
    select: { workspaceId: true },
  });
  if (!c || c.workspaceId !== ctx.workspaceId) throw new AuthzError("Not found", 404);
}

/** Assign a delegate to a client (idempotent on the live row). */
export async function assignClient(
  ctx: AuthzContext,
  args: { membershipId: string; clientPrincipalId: string },
) {
  require_(ctx, "clients.assign");
  await assertDelegateMembership(ctx, args.membershipId);
  await assertClientInWorkspace(ctx, args.clientPrincipalId);

  const existing = await prisma.clientAssignment.findFirst({
    where: { membershipId: args.membershipId, clientPrincipalId: args.clientPrincipalId, revokedAt: null },
  });
  if (existing) return existing;

  const row = await prisma.clientAssignment.create({
    data: {
      workspaceId: ctx.workspaceId,
      membershipId: args.membershipId,
      clientPrincipalId: args.clientPrincipalId,
      assignedById: ctx.userId,
    },
  });
  await recordAudit({
    ...auditActor(ctx),
    verb: "assignment.create",
    objectType: "ClientAssignment",
    objectId: row.id,
  });
  return row;
}

/** Revoke a delegate's assignment to a client (idempotent — no-op if not live). */
export async function revokeClient(
  ctx: AuthzContext,
  args: { membershipId: string; clientPrincipalId: string },
) {
  require_(ctx, "clients.assign");
  const live = await prisma.clientAssignment.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      membershipId: args.membershipId,
      clientPrincipalId: args.clientPrincipalId,
      revokedAt: null,
    },
  });
  if (!live) return null;

  const row = await prisma.clientAssignment.update({
    where: { id: live.id },
    data: { revokedAt: new Date(), revokedById: ctx.userId },
  });
  await recordAudit({
    ...auditActor(ctx),
    verb: "assignment.revoke",
    objectType: "ClientAssignment",
    objectId: row.id,
  });
  return row;
}

export interface AssignmentGrid {
  delegates: { membershipId: string; name: string; email: string }[];
  clients: { id: string; displayName: string }[];
  assignedKeys: string[]; // `${membershipId}:${clientPrincipalId}` for each LIVE assignment
}

/** The grid: live delegates × clients, with the set of current assignments. */
export async function listAssignmentGrid(ctx: AuthzContext): Promise<AssignmentGrid> {
  require_(ctx, "clients.assign");
  const [delegates, clients, live] = await Promise.all([
    prisma.membership.findMany({
      where: { workspaceId: ctx.workspaceId, role: "MANAGING_AGENT", revokedAt: null },
      select: { id: true, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.clientPrincipal.findMany({
      where: { workspaceId: ctx.workspaceId, archivedAt: null },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
    }),
    prisma.clientAssignment.findMany({
      where: { workspaceId: ctx.workspaceId, revokedAt: null },
      select: { membershipId: true, clientPrincipalId: true },
    }),
  ]);
  return {
    delegates: delegates.map((d) => ({ membershipId: d.id, name: d.user.name, email: d.user.email })),
    clients,
    assignedKeys: live.map((a) => `${a.membershipId}:${a.clientPrincipalId}`),
  };
}
