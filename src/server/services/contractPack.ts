import { prisma } from "../db";
import { type AuthzContext, AuthzError, require_ } from "../authz";
import { recordEvidence } from "../evidence";
import { ingestDocument } from "./documents";
import { getListing } from "./listings";
import { buildContractPackPdf } from "../pdf/contractPackPdf";
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

  const doc = await ingestDocument({
    workspaceId: ctx.workspaceId,
    scopeType: "PROPERTY",
    scopeId: listing.propertyId,
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
