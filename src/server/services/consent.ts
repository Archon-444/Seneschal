import type { ConsentSource, SecureLink } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, assertSameWorkspace, require_ } from "../authz";
import { recordEvidence } from "../evidence";

// Messaging consent (PR4). MESSAGING consent gates WhatsApp delivery — nothing
// reaches a recipient over WhatsApp without an active grant. Both subjects —
// Contacts (tenants/landlords) and workspace Users — record consent in the same
// append-only ConsentRecord(MESSAGING): a revocation sets revokedAt, never
// deletes, so the grant/revoke history survives. Grant/revoke are staff actions
// (messaging.manage); the consent *check* runs in the outbox handler with no
// AuthzContext, so it is scoped by the message's workspace.

export const MESSAGING_NOTICE_VERSION = "messaging_notice_v1";

export type ConsentTarget = { contactId: string } | { userId: string };

/** Assert the consent subject belongs to the caller's workspace. Contacts carry
 *  a workspaceId; users join via Membership (no workspaceId column), so check an
 *  active membership — never write consent for a subject in another workspace. */
async function assertTargetInWorkspace(ctx: AuthzContext, target: ConsentTarget): Promise<void> {
  if ("contactId" in target) {
    const contact = await prisma.contact.findUnique({ where: { id: target.contactId } });
    assertSameWorkspace(ctx, contact);
    return;
  }
  const membership = await prisma.membership.findFirst({
    where: { workspaceId: ctx.workspaceId, userId: target.userId },
    select: { id: true },
  });
  if (!membership) throw new AuthzError("Not found", 404);
}

export async function grantMessagingConsent(
  ctx: AuthzContext,
  target: ConsentTarget,
  source: ConsentSource = "FORM",
): Promise<void> {
  require_(ctx, "messaging.manage");
  await assertTargetInWorkspace(ctx, target);
  await prisma.consentRecord.create({
    data: {
      workspaceId: ctx.workspaceId,
      ...target,
      purpose: "MESSAGING",
      source,
      noticeVersion: MESSAGING_NOTICE_VERSION,
    },
  });
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "CONSENT_GRANTED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "WORKSPACE",
    scopeId: ctx.workspaceId,
    payload: { purpose: "MESSAGING", ...target, source },
  });
}

export async function revokeMessagingConsent(ctx: AuthzContext, target: ConsentTarget): Promise<void> {
  require_(ctx, "messaging.manage");
  await assertTargetInWorkspace(ctx, target);
  await prisma.consentRecord.updateMany({
    where: { workspaceId: ctx.workspaceId, ...target, purpose: "MESSAGING", revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "CONSENT_REVOKED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "WORKSPACE",
    scopeId: ctx.workspaceId,
    payload: { purpose: "MESSAGING", ...target },
  });
}

/** No AuthzContext — called from the outbox delivery handler, so the caller
 *  passes the message's workspace to scope the check (a user's consent is
 *  per-workspace; a contactId is globally unique but scoping is still correct). */
export async function hasActiveMessagingConsent(
  target: ConsentTarget,
  workspaceId?: string,
): Promise<boolean> {
  const rec = await prisma.consentRecord.findFirst({
    where: {
      ...target,
      ...(workspaceId ? { workspaceId } : {}),
      purpose: "MESSAGING",
      revokedAt: null,
    },
  });
  return rec != null;
}

/** Public — a tenant self-opts-in to messaging from a secure link. */
export async function recordLinkMessagingOptIn(link: SecureLink): Promise<void> {
  if (!link.contactId) return;
  await prisma.consentRecord.create({
    data: {
      workspaceId: link.workspaceId,
      contactId: link.contactId,
      purpose: "MESSAGING",
      source: "WHATSAPP_OPTIN",
      noticeVersion: MESSAGING_NOTICE_VERSION,
      secureLinkId: link.id,
    },
  });
  await recordEvidence({
    workspaceId: link.workspaceId,
    type: "CONSENT_GRANTED",
    actorType: "TENANT_LINK",
    scopeType: "WORKSPACE",
    scopeId: link.workspaceId,
    payload: { purpose: "MESSAGING", contactId: link.contactId, viaLink: true },
  });
}
