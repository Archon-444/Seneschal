import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, require_ } from "../authz";
import { recordAudit } from "../audit";

type Db = Prisma.TransactionClient | typeof prisma;

// Agent book: people×properties. Toggling a cell creates or revokes a PropertyAssignment —
// the live rows authz() reads into delegatePropertyIds. One responsible member per property.
// Gated by clients.assign (held by WORKSPACE_ADMIN/ORG_ADMIN, never a delegate itself);
// every toggle writes an AuditEvent.

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

async function assertPropertyInWorkspace(ctx: AuthzContext, propertyId: string): Promise<void> {
  const p = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { workspaceId: true },
  });
  if (!p || p.workspaceId !== ctx.workspaceId) throw new AuthzError("Not found", 404);
}

/** Assign a delegate to a property (idempotent on the live row). One member per property. */
export async function assignProperty(
  ctx: AuthzContext,
  args: { membershipId: string; propertyId: string },
) {
  require_(ctx, "clients.assign");
  await assertDelegateMembership(ctx, args.membershipId);
  await assertPropertyInWorkspace(ctx, args.propertyId);

  const existing = await prisma.propertyAssignment.findFirst({
    where: { propertyId: args.propertyId, revokedAt: null },
  });
  if (existing) {
    if (existing.membershipId === args.membershipId) return existing;
    throw new AuthzError("That property already has a responsible agent.", 409);
  }

  const row = await prisma.propertyAssignment.create({
    data: {
      workspaceId: ctx.workspaceId,
      membershipId: args.membershipId,
      propertyId: args.propertyId,
      assignedById: ctx.userId,
    },
  });
  await recordAudit({
    ...auditActor(ctx),
    verb: "assignment.create",
    objectType: "PropertyAssignment",
    objectId: row.id,
  });
  return row;
}

/** Revoke a delegate's assignment to a property (idempotent — no-op if not live). */
export async function revokeProperty(
  ctx: AuthzContext,
  args: { membershipId: string; propertyId: string },
) {
  require_(ctx, "clients.assign");
  const live = await prisma.propertyAssignment.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      membershipId: args.membershipId,
      propertyId: args.propertyId,
      revokedAt: null,
    },
  });
  if (!live) return null;

  const row = await prisma.propertyAssignment.update({
    where: { id: live.id },
    data: { revokedAt: new Date(), revokedById: ctx.userId },
  });
  await recordAudit({
    ...auditActor(ctx),
    verb: "assignment.revoke",
    objectType: "PropertyAssignment",
    objectId: row.id,
  });
  return row;
}

/**
 * When a MANAGING_AGENT creates a property they become its responsible member.
 * Not gated by clients.assign — this is the creator claiming the new unit.
 * Mutates ctx.delegatePropertyIds so the same request can read the new row.
 */
export async function claimCreatedProperty(
  ctx: AuthzContext,
  propertyId: string,
  db: Db = prisma,
): Promise<void> {
  const membership = await db.membership.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      role: "MANAGING_AGENT",
      revokedAt: null,
    },
    select: { id: true },
  });
  if (!membership) throw new AuthzError("Not found", 404);
  await db.propertyAssignment.create({
    data: {
      workspaceId: ctx.workspaceId,
      membershipId: membership.id,
      propertyId,
      assignedById: ctx.userId,
    },
  });
  if (!ctx.delegatePropertyIds.includes(propertyId)) ctx.delegatePropertyIds.push(propertyId);
}

export interface AssignmentGrid {
  delegates: { membershipId: string; name: string; email: string }[];
  properties: {
    id: string;
    label: string;
    clientName: string | null;
  }[];
  assignedKeys: string[]; // `${membershipId}:${propertyId}` for each LIVE assignment
}

/** The grid: live delegates × properties, with the set of current assignments.
 *  scope-audit: office assignment grid is workspace-wide (clients.assign); not a data-plane read. */
export async function listAssignmentGrid(ctx: AuthzContext): Promise<AssignmentGrid> {
  require_(ctx, "clients.assign");
  // scope-audit: office assignment grid is workspace-wide (clients.assign); not a data-plane read.
  const [delegates, properties, live] = await Promise.all([
    prisma.membership.findMany({
      where: { workspaceId: ctx.workspaceId, role: "MANAGING_AGENT", revokedAt: null },
      select: { id: true, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.property.findMany({
      where: { workspaceId: ctx.workspaceId, archivedAt: null },
      select: {
        id: true,
        community: true,
        building: true,
        unitNo: true,
        clientPrincipalId: true,
      },
      orderBy: [{ community: "asc" }, { building: "asc" }, { unitNo: "asc" }],
    }),
    prisma.propertyAssignment.findMany({
      where: { workspaceId: ctx.workspaceId, revokedAt: null },
      select: { membershipId: true, propertyId: true },
    }),
  ]);
  const clientIds = [...new Set(properties.map((p) => p.clientPrincipalId).filter(Boolean))] as string[];
  const clients = clientIds.length
    ? await prisma.clientPrincipal.findMany({
        where: { id: { in: clientIds } },
        select: { id: true, displayName: true },
      })
    : [];
  const clientName = new Map(clients.map((c) => [c.id, c.displayName]));
  return {
    delegates: delegates.map((d) => ({ membershipId: d.id, name: d.user.name, email: d.user.email })),
    properties: properties.map((p) => ({
      id: p.id,
      label: [p.community, p.building, p.unitNo].filter(Boolean).join(" · "),
      clientName: p.clientPrincipalId ? (clientName.get(p.clientPrincipalId) ?? null) : null,
    })),
    assignedKeys: live.map((a) => `${a.membershipId}:${a.propertyId}`),
  };
}
