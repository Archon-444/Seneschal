import type { ContactKind } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, assertSameWorkspace, require_, scope } from "../authz";
import { recordAudit } from "../audit";

// Contact directory (T2.2). Agent/vendor contacts are the assignees of proof requests.

export async function listContacts(
  ctx: AuthzContext,
  opts?: { kind?: ContactKind; includeArchived?: boolean; q?: string },
) {
  require_(ctx, "contacts.read");
  const q = opts?.q?.trim();
  return prisma.contact.findMany({
    where: {
      ...scope(ctx),
      ...(opts?.kind ? { kind: opts.kind } : {}),
      ...(opts?.includeArchived ? {} : { archivedAt: null }),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q, mode: "insensitive" } },
              { emiratesId: { contains: q, mode: "insensitive" } },
              { company: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
  });
}

export async function getContact(ctx: AuthzContext, id: string) {
  require_(ctx, "contacts.read");
  const contact = await prisma.contact.findUnique({ where: { id } });
  assertSameWorkspace(ctx, contact);
  return contact;
}

/** Contact + the contracts and proof requests it's a party to (T2.2 detail). */
export async function getContactDetail(ctx: AuthzContext, id: string) {
  require_(ctx, "contacts.read");
  const contact = await prisma.contact.findUnique({ where: { id } });
  assertSameWorkspace(ctx, contact);

  const clientFilter = ctx.clientPrincipalId
    ? { property: { clientPrincipalId: ctx.clientPrincipalId } }
    : {};
  const tenancies = await prisma.tenancy.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      OR: [{ landlordContactId: id }, { tenantContactId: id }],
      ...clientFilter,
    },
    include: { property: true },
    orderBy: { endDate: "desc" },
  });
  const proofRequests = await prisma.proofRequest.findMany({
    where: { workspaceId: ctx.workspaceId, assignedContactId: id },
    orderBy: { createdAt: "desc" },
  });

  return { contact: contact!, tenancies, proofRequests };
}

export interface ContactInput {
  kind: ContactKind;
  name: string;
  phone?: string;
  email?: string;
  company?: string;
  emiratesId?: string;
  nationality?: string;
  licenseNo?: string;
  licensingAuthority?: string;
  notes?: string;
}

export async function createContact(ctx: AuthzContext, data: ContactInput) {
  require_(ctx, "contacts.write");
  const contact = await prisma.contact.create({
    data: { workspaceId: ctx.workspaceId, ...data },
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "contact.create",
    objectType: "Contact",
    objectId: contact.id,
  });
  return contact;
}

export async function updateContact(ctx: AuthzContext, id: string, data: Partial<ContactInput>) {
  require_(ctx, "contacts.write");
  await getContact(ctx, id);
  return prisma.contact.update({ where: { id }, data });
}

export async function archiveContact(ctx: AuthzContext, id: string) {
  require_(ctx, "contacts.write");
  await getContact(ctx, id);
  const contact = await prisma.contact.update({ where: { id }, data: { archivedAt: new Date() } });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "contact.archive",
    objectType: "Contact",
    objectId: id,
  });
  return contact;
}
