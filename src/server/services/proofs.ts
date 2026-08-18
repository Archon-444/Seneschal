import type { DocumentKind, ScopeType, SecureLink } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, isDelegateRole, require_, scope } from "../authz";
import { recordEvidence } from "../evidence";
import { notify } from "../notify";
import { ingestDocument, logDocumentAccess } from "./documents";
import { createSecureLink, PROOF_LINK_DEFAULT_MAX_USES } from "./secureLinks";
import { raiseProofOverdue, clearProofOverdue } from "./risk";
import { resolveClientScopeIds } from "./clientScope";
import { assertReadable, contactScopedWhere } from "./contactScope";
import { assertDelegateClientId, clientOfScope, clientSetScopedWhere } from "./delegateScope";
import { todayInDubai } from "../calculators/dates";

// Proof requests (E7) — the core verb: ask an external party for evidence,
// receive it without an account, keep the proof.

export const PRIVACY_NOTICE_VERSION = "privacy_notice_v1";

export interface ProofRequestAssigneeOption {
  id: string;
  label: string;
  kind: string;
}

export interface ProofRequestScopeOption {
  value: string;
  scopeType: "CLIENT" | "PROPERTY";
  scopeId: string;
  label: string;
  assignees: ProofRequestAssigneeOption[];
}

async function propertyProofContactIds(workspaceId: string, propertyId: string): Promise<string[]> {
  // scope-audit: internal proof-option helper; callers require proofs.write and pass the authorized workspace.
  const property = await prisma.property.findFirst({
    where: { id: propertyId, workspaceId, archivedAt: null },
    select: {
      ownerContactId: true,
      assignedAgentId: true,
      tenancies: {
        where: { archivedAt: null },
        select: { landlordContactId: true, tenantContactId: true },
      },
    },
  });
  if (!property) return [];
  return [...new Set([
    property.ownerContactId,
    property.assignedAgentId,
    ...property.tenancies.flatMap((t) => [t.landlordContactId, t.tenantContactId]),
  ].filter((id): id is string => !!id))];
}

async function proofScopeContactIds(
  workspaceId: string,
  scopeType: ScopeType,
  scopeId?: string,
): Promise<string[]> {
  if (scopeType === "WORKSPACE") {
    return (await prisma.contact.findMany({
      where: { workspaceId, archivedAt: null },
      select: { id: true },
    })).map((c) => c.id);
  }
  if (!scopeId) return [];
  if (scopeType === "PROPERTY") return propertyProofContactIds(workspaceId, scopeId);
  if (scopeType === "CLIENT") {
    // scope-audit: internal proof-option helper; caller has proofs.write and the query is workspace constrained.
    const properties = await prisma.property.findMany({
      where: { workspaceId, clientPrincipalId: scopeId, archivedAt: null },
      select: { id: true },
    });
    return [...new Set((await Promise.all(properties.map((p) => propertyProofContactIds(workspaceId, p.id)))).flat())];
  }
  if (scopeType === "TENANCY") {
    // scope-audit: internal proof-selection helper; caller has proofs.write and validates the resulting assignee set.
    const tenancy = await prisma.tenancy.findFirst({
      where: { id: scopeId, workspaceId, archivedAt: null },
      select: { propertyId: true },
    });
    return tenancy ? propertyProofContactIds(workspaceId, tenancy.propertyId) : [];
  }
  if (scopeType === "PAYMENT_ITEM") {
    // scope-audit: internal proof-selection helper; caller has proofs.write and validates the resulting assignee set.
    const item = await prisma.paymentItem.findFirst({
      where: { id: scopeId, workspaceId },
      select: { tenancy: { select: { propertyId: true } } },
    });
    return item ? propertyProofContactIds(workspaceId, item.tenancy.propertyId) : [];
  }
  if (scopeType === "RENEWAL_CASE") {
    const renewalCase = await prisma.renewalCase.findFirst({
      where: { id: scopeId, workspaceId },
      select: { propertyId: true },
    });
    return renewalCase ? propertyProofContactIds(workspaceId, renewalCase.propertyId) : [];
  }
  if (scopeType === "OFFER") {
    // scope-audit: internal proof-selection helper; caller has proofs.write and validates the resulting assignee set.
    const offer = await prisma.offer.findFirst({
      where: { id: scopeId, workspaceId },
      select: { tenancyId: true },
    });
    if (!offer?.tenancyId) return [];
    // scope-audit: internal proof-selection helper; offer tenancy id and workspace both constrain the lookup.
    const tenancy = await prisma.tenancy.findFirst({
      where: { id: offer.tenancyId, workspaceId },
      select: { propertyId: true },
    });
    return tenancy ? propertyProofContactIds(workspaceId, tenancy.propertyId) : [];
  }
  return [];
}

async function assertProofRequestSelection(
  ctx: AuthzContext,
  args: { scopeType: ScopeType; scopeId?: string; assignedContactId: string },
) {
  const contact = await prisma.contact.findFirst({
    where: { id: args.assignedContactId, workspaceId: ctx.workspaceId, archivedAt: null },
    select: { id: true },
  });
  if (!contact) throw new AuthzError("Not found", 404);
  const allowedContactIds = await proofScopeContactIds(ctx.workspaceId, args.scopeType, args.scopeId);
  if (!allowedContactIds.includes(contact.id)) throw new AuthzError("Not found", 404);
}

/** Minimum-data, scope-aware options for the proof creation form. */
export async function proofRequestOptions(ctx: AuthzContext): Promise<ProofRequestScopeOption[]> {
  require_(ctx, "proofs.write");
  const clientIds = isDelegateRole(ctx.role) ? ctx.delegateClientIds : null;
  const [clients, properties] = await Promise.all([
    prisma.clientPrincipal.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        archivedAt: null,
        ...(clientIds ? { id: { in: clientIds } } : {}),
      },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
    }),
    // scope-audit: proofRequestOptions requires proofs.write and applies delegate client ids before reading properties.
    prisma.property.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        archivedAt: null,
        ...(clientIds ? { clientPrincipalId: { in: clientIds } } : {}),
      },
      select: { id: true, clientPrincipalId: true, community: true, building: true, unitNo: true },
      orderBy: [{ community: "asc" }, { building: "asc" }, { unitNo: "asc" }],
    }),
  ]);

  const propertyContactEntries = await Promise.all(
    properties.map(async (property) => [property.id, await propertyProofContactIds(ctx.workspaceId, property.id)] as const),
  );
  const propertyContacts = new Map(propertyContactEntries);
  const allContactIds = [...new Set(propertyContactEntries.flatMap(([, ids]) => ids))];
  const contacts = await prisma.contact.findMany({
    where: { workspaceId: ctx.workspaceId, archivedAt: null, id: { in: allContactIds } },
    select: { id: true, name: true, kind: true },
    orderBy: { name: "asc" },
  });
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
  const assignees = (ids: string[]): ProofRequestAssigneeOption[] => ids
    .map((id) => contactById.get(id))
    .filter((contact): contact is NonNullable<typeof contact> => !!contact)
    .map((contact) => ({ id: contact.id, label: contact.name, kind: contact.kind }));

  const clientOptions = clients.map((client) => {
    const ids = properties
      .filter((property) => property.clientPrincipalId === client.id)
      .flatMap((property) => propertyContacts.get(property.id) ?? []);
    return {
      value: `CLIENT:${client.id}`,
      scopeType: "CLIENT" as const,
      scopeId: client.id,
      label: `Client — ${client.displayName}`,
      assignees: assignees([...new Set(ids)]),
    };
  });
  const propertyOptions = properties.map((property) => ({
    value: `PROPERTY:${property.id}`,
    scopeType: "PROPERTY" as const,
    scopeId: property.id,
    label: `Property — ${[property.community, property.building, property.unitNo].filter(Boolean).join(" · ")}`,
    assignees: assignees(propertyContacts.get(property.id) ?? []),
  }));
  return [...clientOptions, ...propertyOptions].filter((option) => option.assignees.length > 0);
}

export async function createProofRequest(
  ctx: AuthzContext,
  args: {
    scopeType: ScopeType;
    scopeId?: string;
    title: string;
    requiredEvidence: string;
    assignedContactId: string;
    dueAt?: Date;
  },
) {
  require_(ctx, "proofs.write");
  // a scoped request without a target id is invisible to client-scoped viewers
  if (args.scopeType !== "WORKSPACE" && !args.scopeId) {
    throw new AuthzError(`scopeId required for ${args.scopeType}-scoped proof requests`, 422);
  }
  if (isDelegateRole(ctx.role)) {
    // The proof's subject (scopeType/scopeId) must resolve to an assigned client; a
    // WORKSPACE-scoped proof has no client and so is denied (cross-client).
    const clientId = await clientOfScope(ctx.workspaceId, args.scopeType, args.scopeId ?? null);
    assertDelegateClientId(ctx, clientId);
  }
  await assertProofRequestSelection(ctx, args);

  const request = await prisma.proofRequest.create({
    data: {
      workspaceId: ctx.workspaceId,
      scopeType: args.scopeType,
      scopeId: args.scopeId ?? null,
      title: args.title,
      requiredEvidence: args.requiredEvidence,
      assignedContactId: args.assignedContactId,
      dueAt: args.dueAt ?? null,
      createdById: ctx.userId,
    },
  });
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "PROOF_REQUESTED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "PROOF_REQUEST",
    scopeId: request.id,
    payload: { title: args.title, assignedContactId: args.assignedContactId },
  });
  return request;
}

/** Create + send the secure upload link to the assignee by email. */
export async function sendProofRequest(ctx: AuthzContext, proofRequestId: string) {
  require_(ctx, "proofs.write");
  const request = await getProofRequest(ctx, proofRequestId);
  const contact = await prisma.contact.findUnique({ where: { id: request.assignedContactId } });
  if (!contact?.email) throw new AuthzError("Assigned contact has no email", 422);

  const { url } = await createSecureLink(ctx, {
    purpose: "PROOF_UPLOAD",
    scopeType: "PROOF_REQUEST",
    scopeId: proofRequestId,
    contactId: contact.id,
    maxUses: PROOF_LINK_DEFAULT_MAX_USES, // H5: cap replay on newly-minted proof links
  });
  const token = url.slice(url.lastIndexOf("/") + 1);
  const { intakeAddress } = await import("./emailIntake");
  await notify({
    workspaceId: ctx.workspaceId,
    channel: "EMAIL",
    templateCode: "proof_request_v1",
    subject: `Evidence requested: ${request.title}`,
    body:
      `You have been asked to provide evidence.\n\n` +
      `Request: ${request.title}\nRequired: ${request.requiredEvidence}\n` +
      (request.dueAt ? `Due: ${request.dueAt.toISOString().slice(0, 10)}\n` : "") +
      `\nUpload here (no account needed): ${url}\n` +
      `Or reply with the file attached to: ${intakeAddress(token)}\n`,
    toContactId: contact.id,
    relatedType: "PROOF_REQUEST",
    relatedId: proofRequestId,
  });
  await prisma.proofRequest.update({
    where: { id: proofRequestId },
    data: { status: "SENT" },
  });
  return { url };
}

export async function getProofRequest(ctx: AuthzContext, id: string) {
  require_(ctx, "proofs.read");
  const request = await prisma.proofRequest.findUnique({ where: { id } });
  await assertReadable(ctx, { kind: "proofRequest", row: request });
  return request!;
}

export async function listProofRequests(ctx: AuthzContext) {
  require_(ctx, "proofs.read");
  // CLIENT_VIEWER sees only proof requests resolving to their client; a persona
  // only those resolving to their Contact.
  const base = ctx.subjectContactId
    ? await contactScopedWhere(ctx, "PROOF_REQUEST")
    : isDelegateRole(ctx.role)
      ? await clientSetScopedWhere(ctx, "PROOF_REQUEST")
      : {
          ...scope(ctx),
          ...(ctx.clientPrincipalId
            ? { id: { in: (await resolveClientScopeIds(ctx.workspaceId, ctx.clientPrincipalId)).proofRequestIds } }
            : {}),
        };
  const requests = await prisma.proofRequest.findMany({
    where: base,
    orderBy: { createdAt: "desc" },
  });
  const contacts = await prisma.contact.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      id: { in: [...new Set(requests.map((request) => request.assignedContactId))] },
    },
    select: { id: true, name: true },
  });
  const contactName = new Map(contacts.map((contact) => [contact.id, contact.name]));
  return requests.map((request) => ({
    ...request,
    assignedContactName: contactName.get(request.assignedContactId) ?? "Related contact unavailable",
  }));
}

/**
 * External upload via secure link (T7.3): creates Document +
 * DocumentAccessLog(UPLOADED via link) + EvidenceEvent(PROOF_UPLOADED) +
 * ConsentRecord(LINK_INTERACTION, versioned notice). No account involved.
 */
export async function submitProofViaLink(
  link: SecureLink,
  files: { fileName: string; mime: string; data: Buffer; kind?: DocumentKind }[],
  note?: string,
  meta?: { ip?: string; device?: string },
) {
  if (link.purpose !== "PROOF_UPLOAD" || link.scopeType !== "PROOF_REQUEST") {
    throw new Error("Link is not a proof-upload link");
  }
  const request = await prisma.proofRequest.findUnique({ where: { id: link.scopeId } });
  if (!request) throw new Error("Proof request not found");

  const docs = [];
  for (const file of files) {
    const doc = await ingestDocument({
      workspaceId: link.workspaceId,
      scopeType: "PROOF_REQUEST",
      scopeId: request.id,
      kind: file.kind ?? "OTHER",
      fileName: file.fileName,
      mime: file.mime,
      data: file.data,
      secureLinkId: link.id,
    });
    await logDocumentAccess({
      workspaceId: link.workspaceId,
      documentId: doc.id,
      action: "UPLOADED",
      secureLinkId: link.id,
      ip: meta?.ip,
      device: meta?.device,
    });
    docs.push(doc);
  }

  await recordEvidence({
    workspaceId: link.workspaceId,
    type: "PROOF_UPLOADED",
    actorType: "TENANT_LINK",
    scopeType: "PROOF_REQUEST",
    scopeId: request.id,
    payload: {
      secureLinkId: link.id,
      documentIds: docs.map((d) => d.id),
      note: note ?? null,
    },
  });

  if (link.contactId) {
    await prisma.consentRecord.create({
      data: {
        workspaceId: link.workspaceId,
        contactId: link.contactId,
        purpose: "LINK_INTERACTION",
        source: "SECURE_LINK",
        noticeVersion: PRIVACY_NOTICE_VERSION,
        secureLinkId: link.id,
      },
    });
    await recordEvidence({
      workspaceId: link.workspaceId,
      type: "CONSENT_GRANTED",
      actorType: "TENANT_LINK",
      scopeType: "PROOF_REQUEST",
      scopeId: request.id,
      payload: { contactId: link.contactId, noticeVersion: PRIVACY_NOTICE_VERSION },
    });
  }

  // scope-audit: public secure-link upload path (no ctx); the validated link's
  // workspace + PROOF_REQUEST scope authorize this status flip.
  await prisma.proofRequest.update({
    where: { id: request.id },
    data: { status: "SUBMITTED" },
  });
  await clearProofOverdue(request.id, link.workspaceId);
  return docs;
}

/** Approve/reject (T7.5). Rejection re-opens the request. */
export async function decideProofRequest(
  ctx: AuthzContext,
  id: string,
  decision: "APPROVED" | "REJECTED",
  note?: string,
) {
  require_(ctx, "proofs.decide");
  const request = await getProofRequest(ctx, id);
  if (request.status !== "SUBMITTED" && request.status !== "OVERDUE") {
    throw new AuthzError(`Cannot decide a request in status ${request.status}`, 422);
  }
  const updated = await prisma.proofRequest.update({
    where: { id },
    data: {
      status: decision === "APPROVED" ? "APPROVED" : "OPEN", // rejection re-opens
      decisionById: ctx.userId,
      decisionAt: new Date(),
      decisionNote: note ?? null,
    },
  });
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: decision === "APPROVED" ? "PROOF_APPROVED" : "PROOF_REJECTED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "PROOF_REQUEST",
    scopeId: id,
    payload: { note: note ?? null },
  });
  return updated;
}

/** Overdue sweep (T7.1): auto-OVERDUE past due + PROOF_OVERDUE flag. Idempotent. */
export async function sweepOverdueProofRequests(workspaceId?: string): Promise<number> {
  const today = todayInDubai();
  // scope-audit: overdue-sweep cron, workspace-batch, no persona ctx.
  const overdue = await prisma.proofRequest.findMany({
    where: {
      ...(workspaceId ? { workspaceId } : {}),
      status: { in: ["OPEN", "SENT", "WAITING_PROOF"] },
      dueAt: { lt: today },
    },
  });
  for (const request of overdue) {
    await prisma.proofRequest.update({ where: { id: request.id }, data: { status: "OVERDUE" } });
    await raiseProofOverdue(request.id, request.workspaceId);
  }
  return overdue.length;
}
