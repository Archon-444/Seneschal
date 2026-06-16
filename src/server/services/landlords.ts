import type { Contact } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, assertSameWorkspace, require_ } from "../authz";
import { recordEvidence } from "../evidence";

// Landlord verification (1B #2). An operator confirms an OWNER contact's identity
// and ownership; verified state is denormalized on Contact while the append-only
// LANDLORD_VERIFIED evidence event is the audit trail (a revoke is a NEW event,
// never a delete). A verified landlord earns a Badge across the listing surfaces.

async function loadOwner(ctx: AuthzContext, contactId: string): Promise<Contact> {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  assertSameWorkspace(ctx, contact);
  if (contact!.kind !== "OWNER") {
    throw new AuthzError("Only OWNER contacts can be verified as landlords", 422);
  }
  return contact!;
}

export async function verifyLandlord(ctx: AuthzContext, contactId: string, note?: string) {
  require_(ctx, "landlords.verify");
  const contact = await loadOwner(ctx, contactId);
  const updated = await prisma.contact.update({
    where: { id: contact.id },
    data: { verifiedAt: new Date(), verifiedById: ctx.userId },
  });
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "LANDLORD_VERIFIED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "WORKSPACE",
    scopeId: ctx.workspaceId,
    payload: { contactId: contact.id, name: contact.name, verified: true, note: note ?? null },
  });
  return updated;
}

export async function revokeLandlordVerification(ctx: AuthzContext, contactId: string, note?: string) {
  require_(ctx, "landlords.verify");
  const contact = await loadOwner(ctx, contactId);
  const updated = await prisma.contact.update({
    where: { id: contact.id },
    data: { verifiedAt: null, verifiedById: null },
  });
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "LANDLORD_VERIFIED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "WORKSPACE",
    scopeId: ctx.workspaceId,
    payload: { contactId: contact.id, name: contact.name, verified: false, note: note ?? null },
  });
  return updated;
}

/** Whether the persona's own Contact (or any contact id) is a verified landlord. */
export async function isLandlordVerified(workspaceId: string, contactId: string | null): Promise<boolean> {
  if (!contactId) return false;
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, workspaceId },
    select: { verifiedAt: true },
  });
  return !!contact?.verifiedAt;
}
