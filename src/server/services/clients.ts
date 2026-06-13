import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, assertSameWorkspace, require_, scope } from "../authz";
import { recordAudit } from "../audit";

// ClientPrincipal CRUD + archive (T2.1). Archive hides from default lists,
// keeps evidence intact; no hard delete exists anywhere in this module.

export async function listClients(
  ctx: AuthzContext,
  opts?: { includeArchived?: boolean; q?: string },
) {
  require_(ctx, "clients.read");
  const q = opts?.q?.trim();
  return prisma.clientPrincipal.findMany({
    where: {
      ...scope(ctx),
      ...(ctx.clientPrincipalId ? { id: ctx.clientPrincipalId } : {}),
      ...(opts?.includeArchived ? {} : { archivedAt: null }),
      ...(q ? { displayName: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: { displayName: "asc" },
  });
}

export async function getClient(ctx: AuthzContext, id: string) {
  require_(ctx, "clients.read");
  if (ctx.clientPrincipalId && ctx.clientPrincipalId !== id) throw new AuthzError("Not found", 404);
  const client = await prisma.clientPrincipal.findUnique({ where: { id } });
  assertSameWorkspace(ctx, client);
  return client;
}

export async function createClient(
  ctx: AuthzContext,
  data: { displayName: string; contactInfo?: Record<string, unknown>; notes?: string },
) {
  require_(ctx, "clients.write");
  const client = await prisma.clientPrincipal.create({
    data: {
      workspaceId: ctx.workspaceId,
      displayName: data.displayName,
      contactInfo: (data.contactInfo ?? undefined) as Prisma.InputJsonValue | undefined,
      notes: data.notes,
    },
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "client.create",
    objectType: "ClientPrincipal",
    objectId: client.id,
  });
  return client;
}

export async function updateClient(
  ctx: AuthzContext,
  id: string,
  data: { displayName?: string; contactInfo?: Record<string, unknown>; notes?: string },
) {
  require_(ctx, "clients.write");
  await getClient(ctx, id);
  const client = await prisma.clientPrincipal.update({
    where: { id },
    data: {
      displayName: data.displayName,
      contactInfo: (data.contactInfo ?? undefined) as Prisma.InputJsonValue | undefined,
      notes: data.notes,
    },
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "client.update",
    objectType: "ClientPrincipal",
    objectId: id,
  });
  return client;
}

export async function archiveClient(ctx: AuthzContext, id: string) {
  require_(ctx, "clients.write");
  await getClient(ctx, id);
  const client = await prisma.clientPrincipal.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "client.archive",
    objectType: "ClientPrincipal",
    objectId: id,
  });
  return client;
}
