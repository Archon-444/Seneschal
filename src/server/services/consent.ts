import type { ConsentSource, SecureLink } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, assertSameWorkspace, require_ } from "../authz";
import { recordEvidence } from "../evidence";

// Messaging consent (PR4). MESSAGING consent gates WhatsApp delivery — nothing
// reaches a recipient over WhatsApp without an active grant. Contacts use
// ConsentRecord(MESSAGING); workspace users use User.waOptInAt. Grant/revoke are
// staff actions (messaging.manage); the consent *check* runs in the outbox
// handler with no AuthzContext.

export const MESSAGING_NOTICE_VERSION = "messaging_notice_v1";

export type ConsentTarget = { contactId: string } | { userId: string };

export async function grantMessagingConsent(
  ctx: AuthzContext,
  target: ConsentTarget,
  source: ConsentSource = "FORM",
): Promise<void> {
  require_(ctx, "messaging.manage");
  if ("contactId" in target) {
    const contact = await prisma.contact.findUnique({ where: { id: target.contactId } });
    assertSameWorkspace(ctx, contact);
    await prisma.consentRecord.create({
      data: {
        workspaceId: ctx.workspaceId,
        contactId: target.contactId,
        purpose: "MESSAGING",
        source,
        noticeVersion: MESSAGING_NOTICE_VERSION,
      },
    });
  } else {
    const user = await prisma.user.findUnique({ where: { id: target.userId } });
    if (!user) throw new AuthzError("Unknown user", 404);
    await prisma.user.update({ where: { id: target.userId }, data: { waOptInAt: new Date() } });
  }
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
  if ("contactId" in target) {
    const contact = await prisma.contact.findUnique({ where: { id: target.contactId } });
    assertSameWorkspace(ctx, contact);
    await prisma.consentRecord.updateMany({
      where: { workspaceId: ctx.workspaceId, contactId: target.contactId, purpose: "MESSAGING", revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } else {
    await prisma.user.update({ where: { id: target.userId }, data: { waOptInAt: null } });
  }
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

/** No AuthzContext — called from the outbox delivery handler. */
export async function hasActiveMessagingConsent(target: ConsentTarget): Promise<boolean> {
  if ("contactId" in target) {
    const rec = await prisma.consentRecord.findFirst({
      where: { contactId: target.contactId, purpose: "MESSAGING", revokedAt: null },
    });
    return rec != null;
  }
  const user = await prisma.user.findUnique({ where: { id: target.userId } });
  return user?.waOptInAt != null;
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
