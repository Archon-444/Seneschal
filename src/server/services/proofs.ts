import type { DocumentKind, ScopeType, SecureLink } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, assertSameWorkspace, isDelegateRole, require_, scope } from "../authz";
import { recordEvidence } from "../evidence";
import { notify } from "../notify";
import { ingestDocument, logDocumentAccess } from "./documents";
import { createSecureLink } from "./secureLinks";
import { raiseProofOverdue, clearProofOverdue } from "./risk";
import { resolveClientScopeIds } from "./clientScope";
import { assertReadable, contactScopedWhere } from "./contactScope";
import { assertDelegateClientId, clientOfScope, clientSetScopedWhere } from "./delegateScope";
import { todayInDubai } from "../calculators/dates";

// Proof requests (E7) — the core verb: ask an external party for evidence,
// receive it without an account, keep the proof.

export const PRIVACY_NOTICE_VERSION = "privacy_notice_v1";

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
  const contact = await prisma.contact.findUnique({ where: { id: args.assignedContactId } });
  if (isDelegateRole(ctx.role)) {
    // Assignee just needs to be in the workspace (assigning sends an email, leaks no
    // client data); the security boundary is the scope target below.
    if (!contact || contact.workspaceId !== ctx.workspaceId) throw new AuthzError("Not found", 404);
  } else {
    assertSameWorkspace(ctx, contact);
  }
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
  return prisma.proofRequest.findMany({
    where: base,
    orderBy: { createdAt: "desc" },
  });
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
