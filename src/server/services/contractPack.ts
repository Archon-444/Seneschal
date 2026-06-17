import { prisma } from "../db";
import { type AuthzContext, AuthzError, require_ } from "../authz";
import { recordEvidence } from "../evidence";
import { ingestDocument, logDocumentAccess } from "./documents";
import { getListing } from "./listings";
import { buildContractPackPdf } from "../pdf/contractPackPdf";
import { signedFileUrl } from "../storage";
import { todayInDubai } from "../calculators/dates";

// Contract pack (2A #12) — generate a PDF of the agreed terms from an ACCEPTED
// new-tenancy offer. The PDF is stored PROPERTY-scoped (so the owning landlord and
// operators can read it via the normal document surfaces) and the act is recorded
// as CONTRACT_PACK_GENERATED. Scope is enforced by getListing on the offer's listing.

function unitLabel(p: { community: string; building: string | null; unitNo: string | null }): string {
  return [p.building, p.unitNo ? `Unit ${p.unitNo}` : null, p.community].filter(Boolean).join(" · ");
}

export async function generateContractPack(ctx: AuthzContext, offerId: string) {
  require_(ctx, "contracts.write");
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!offer || offer.workspaceId !== ctx.workspaceId) throw new AuthzError("Not found", 404);
  if (!offer.listingId) throw new AuthzError("Contract packs are generated from new-tenancy offers", 422);
  if (offer.status !== "ACCEPTED") throw new AuthzError("Only an accepted offer can be packed", 422);
  const listing = await getListing(ctx, offer.listingId); // ownership / workspace gate

  const owner = listing.property.ownerContactId
    ? await prisma.contact.findUnique({ where: { id: listing.property.ownerContactId }, select: { name: true } })
    : null;
  const prospect = offer.prospectContactId
    ? await prisma.contact.findUnique({ where: { id: offer.prospectContactId }, select: { name: true } })
    : null;

  const pdf = await buildContractPackPdf({
    unit: unitLabel(listing.property),
    landlordName: owner?.name ?? "Landlord",
    tenantName: prospect?.name ?? "Prospective tenant",
    annualRent: Number(offer.annualRent),
    paymentSchedule: offer.paymentSchedule,
    paymentMethod: offer.paymentMethod,
    termMonths: offer.termMonths,
    startDate: offer.startDate ? offer.startDate.toISOString().slice(0, 10) : null,
    generatedOn: todayInDubai().toISOString().slice(0, 10),
  });

  // OFFER-scoped: no persona resolves OFFER through the generic document surface
  // (scopeBelongsToContact returns false for it), so a tenant of the property can
  // never read another party's contract terms. The owning landlord + operators read
  // it only through the gated getContractPackUrl below.
  const doc = await ingestDocument({
    workspaceId: ctx.workspaceId,
    scopeType: "OFFER",
    scopeId: offerId,
    kind: "TENANCY_CONTRACT",
    fileName: `contract-pack-${offerId.slice(0, 8)}.pdf`,
    mime: "application/pdf",
    data: pdf,
    uploadedById: ctx.userId,
  });

  const pack = await prisma.contractPack.create({
    data: {
      workspaceId: ctx.workspaceId,
      offerId,
      listingId: offer.listingId,
      propertyId: listing.propertyId,
      documentId: doc.id,
      createdById: ctx.userId,
    },
  });
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "CONTRACT_PACK_GENERATED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "OFFER",
    scopeId: offerId,
    propertyId: listing.propertyId,
    payload: { contractPackId: pack.id, documentId: doc.id },
  });
  return pack;
}

export async function listContractPacks(ctx: AuthzContext, listingId: string) {
  require_(ctx, "contracts.read");
  await getListing(ctx, listingId); // ownership / workspace gate
  return prisma.contractPack.findMany({
    where: { workspaceId: ctx.workspaceId, listingId },
    orderBy: { createdAt: "desc" },
  });
}

/** Load a pack with the same scope gate as the rest (landlord owns it / operator). */
async function loadPack(ctx: AuthzContext, packId: string) {
  const pack = await prisma.contractPack.findUnique({ where: { id: packId } });
  if (!pack || pack.workspaceId !== ctx.workspaceId) throw new AuthzError("Not found", 404);
  if (pack.listingId) await getListing(ctx, pack.listingId);
  return pack;
}

/** The signed URL for a pack's PDF. The pack is OFFER-scoped (unreadable via the
 *  generic document surface), so this gated path — landlord-owns-it / operator — is
 *  the ONLY way to read it. A tenant lacks contracts.read and is refused here. */
export async function getContractPackUrl(ctx: AuthzContext, packId: string) {
  require_(ctx, "contracts.read");
  const pack = await loadPack(ctx, packId);
  await logDocumentAccess({
    workspaceId: ctx.workspaceId,
    documentId: pack.documentId,
    actorUserId: ctx.userId,
    action: "VIEWED",
  });
  return { url: signedFileUrl(pack.documentId), contractPackId: pack.id };
}

/**
 * Record that the pack was sent to an external e-sign provider (2A #13). The
 * provider reference is captured for the audit trail; Seneschal does not embed a
 * signing engine — it tracks the reference and the signed acknowledgement.
 */
export async function markContractPackSent(ctx: AuthzContext, packId: string, eSignRef?: string) {
  require_(ctx, "contracts.write");
  const pack = await loadPack(ctx, packId);
  if (pack.status === "SIGNED") throw new AuthzError("Pack is already signed", 422);
  const updated = await prisma.contractPack.update({
    where: { id: packId },
    data: { status: "SENT_FOR_SIGNATURE", sentAt: new Date(), eSignRef: eSignRef?.trim() || pack.eSignRef },
  });
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "CONTRACT_PACK_SENT",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "OFFER",
    scopeId: pack.offerId,
    propertyId: pack.propertyId,
    payload: { contractPackId: pack.id, eSignRef: updated.eSignRef },
  });
  return updated;
}

export async function markContractPackSigned(ctx: AuthzContext, packId: string, eSignRef?: string) {
  require_(ctx, "contracts.write");
  const pack = await loadPack(ctx, packId);
  const updated = await prisma.contractPack.update({
    where: { id: packId },
    data: { status: "SIGNED", signedAt: new Date(), eSignRef: eSignRef?.trim() || pack.eSignRef },
  });
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "CONTRACT_PACK_SIGNED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "OFFER",
    scopeId: pack.offerId,
    propertyId: pack.propertyId,
    payload: { contractPackId: pack.id, eSignRef: updated.eSignRef },
  });
  return updated;
}
