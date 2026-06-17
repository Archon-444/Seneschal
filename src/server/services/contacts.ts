import type { ContactKind } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, assertSameWorkspace, isDelegateRole, require_, scope } from "../authz";
import { recordAudit } from "../audit";
import {
  clientSetScopedWhere,
  resolveDelegateContactIds,
  resolveDelegateScopeIds,
} from "./delegateScope";

// Contact directory (T2.2). Agent/vendor contacts are the assignees of proof requests.

/**
 * A delegate (MANAGING_AGENT) by-id contact gate: the contact must be one referenced
 * on an assigned client's tenancy/property (Contact carries no client column). Throws
 * 404 fail-closed otherwise. Operators/CLIENT_VIEWER keep the workspace check.
 */
async function assertContactInDelegateScope(ctx: AuthzContext, contact: { id: string; workspaceId: string } | null) {
  if (!contact || contact.workspaceId !== ctx.workspaceId) throw new AuthzError("Not found", 404);
  const ids = await resolveDelegateScopeIds(ctx);
  const contactIds = await resolveDelegateContactIds(ctx, ids);
  if (!contactIds.includes(contact.id)) throw new AuthzError("Not found", 404);
}

export async function listContacts(
  ctx: AuthzContext,
  opts?: { kind?: ContactKind; includeArchived?: boolean; q?: string },
) {
  require_(ctx, "contacts.read");
  const q = opts?.q?.trim();
  const base = isDelegateRole(ctx.role) ? await clientSetScopedWhere(ctx, "CONTACT") : { ...scope(ctx) };
  return prisma.contact.findMany({
    where: {
      ...base,
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
  if (isDelegateRole(ctx.role)) await assertContactInDelegateScope(ctx, contact);
  else assertSameWorkspace(ctx, contact);
  return contact;
}

/** Contact + the contracts and proof requests it's a party to (T2.2 detail). */
export async function getContactDetail(ctx: AuthzContext, id: string) {
  require_(ctx, "contacts.read");
  const contact = await prisma.contact.findUnique({ where: { id } });
  if (isDelegateRole(ctx.role)) await assertContactInDelegateScope(ctx, contact);
  else assertSameWorkspace(ctx, contact);

  // Restrict the contact's tenancies to the caller's client scope: a CLIENT_VIEWER to
  // its client, a delegate to its assigned clients' tenancies (so a contact shared
  // across clients never exposes a sibling client's tenancy).
  let tenancyFilter: Record<string, unknown> = {};
  let proofFilter: Record<string, unknown> = {};
  if (isDelegateRole(ctx.role)) {
    const ids = await resolveDelegateScopeIds(ctx);
    tenancyFilter = { id: { in: ids.tenancyIds } };
    proofFilter = { id: { in: ids.proofRequestIds } };
  } else if (ctx.clientPrincipalId) {
    tenancyFilter = { property: { clientPrincipalId: ctx.clientPrincipalId } };
  }
  const tenancies = await prisma.tenancy.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      OR: [{ landlordContactId: id }, { tenantContactId: id }],
      ...tenancyFilter,
    },
    include: { property: true },
    orderBy: { endDate: "desc" },
  });
  const proofRequests = await prisma.proofRequest.findMany({
    where: { workspaceId: ctx.workspaceId, assignedContactId: id, ...proofFilter },
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
