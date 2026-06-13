import { prisma } from "../db";
import { type AuthzContext, AuthzError, assertSameWorkspace, clientScope, require_, scope } from "../authz";
import { recordAudit } from "../audit";

// Property CRUD + archive (T2.3). Fiduciary workspaces require a client on
// every property; archiving a property never archives its evidence.

export async function listProperties(
  ctx: AuthzContext,
  opts?: { clientPrincipalId?: string; includeArchived?: boolean; q?: string },
) {
  require_(ctx, "properties.read");
  const q = opts?.q?.trim();
  return prisma.property.findMany({
    where: {
      ...scope(ctx),
      ...clientScope(ctx),
      ...(opts?.clientPrincipalId ? { clientPrincipalId: opts.clientPrincipalId } : {}),
      ...(opts?.includeArchived ? {} : { archivedAt: null }),
      ...(q
        ? {
            OR: [
              { community: { contains: q, mode: "insensitive" } },
              { building: { contains: q, mode: "insensitive" } },
              { unitNo: { contains: q, mode: "insensitive" } },
              { propertyType: { contains: q, mode: "insensitive" } },
              { makaniNo: { contains: q, mode: "insensitive" } },
              { dewaPremiseNo: { contains: q, mode: "insensitive" } },
              { tenancies: { some: { ejariNo: { contains: q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    orderBy: [{ community: "asc" }, { building: "asc" }],
    include: { tenancies: { where: { archivedAt: null }, orderBy: { endDate: "desc" }, take: 1 } },
  });
}

export async function getProperty(ctx: AuthzContext, id: string) {
  require_(ctx, "properties.read");
  const property = await prisma.property.findUnique({
    where: { id },
    include: { tenancies: { orderBy: { endDate: "desc" } } },
  });
  assertSameWorkspace(ctx, property);
  if (ctx.clientPrincipalId && property!.clientPrincipalId !== ctx.clientPrincipalId) {
    throw new AuthzError("Not found", 404);
  }
  return property;
}

export interface PropertyInput {
  clientPrincipalId?: string | null;
  community: string;
  building?: string;
  unitNo?: string;
  emirate?: string;
  propertyType?: string;
  bedrooms?: number;
  sizeSqft?: number;
  usage?: string;
  plotNo?: string;
  makaniNo?: string;
  dewaPremiseNo?: string;
  sizeSqm?: number;
  assignedAgentId?: string;
  notes?: string;
}

export async function createProperty(ctx: AuthzContext, data: PropertyInput) {
  require_(ctx, "properties.write");
  const workspace = await prisma.workspace.findUnique({ where: { id: ctx.workspaceId } });
  if (workspace?.type === "FIDUCIARY" && !data.clientPrincipalId) {
    throw new AuthzError("Fiduciary workspaces require a client on every property", 422);
  }
  if (data.clientPrincipalId) {
    const client = await prisma.clientPrincipal.findUnique({
      where: { id: data.clientPrincipalId },
    });
    assertSameWorkspace(ctx, client);
  }
  const property = await prisma.property.create({
    data: { workspaceId: ctx.workspaceId, ...data },
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "property.create",
    objectType: "Property",
    objectId: property.id,
  });
  return property;
}

export async function updateProperty(ctx: AuthzContext, id: string, data: Partial<PropertyInput>) {
  require_(ctx, "properties.write");
  await getProperty(ctx, id);
  const property = await prisma.property.update({ where: { id }, data });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "property.update",
    objectType: "Property",
    objectId: id,
  });
  return property;
}

export async function archiveProperty(ctx: AuthzContext, id: string) {
  require_(ctx, "properties.write");
  await getProperty(ctx, id);
  // Archive cascade rule: the property hides from lists; evidence rows are untouched.
  const property = await prisma.property.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "property.archive",
    objectType: "Property",
    objectId: id,
  });
  return property;
}
