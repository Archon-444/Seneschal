import { Prisma, type OfferParty } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, require_ } from "../authz";
import { recordEvidence } from "../evidence";
import { recordAudit } from "../audit";
import { getListing } from "./listings";
import { toUtcDateOnly } from "../calculators/dates";

// New-tenancy offers (2A #11) — the listing-side counterpart to the renewals Offer
// flow. The SAME Offer model carries both: a renewal offer has renewalCaseId+tenancyId;
// a new-tenancy offer has listingId (and no tenancy yet). Scope is enforced by
// getListing(ctx, ...) — a LANDLORD only reaches offers on a listing they own;
// operators reach any in their workspace. No parallel scope check to drift.

export interface NewOfferInput {
  party: OfferParty;
  annualRent: number;
  paymentSchedule: string;
  paymentMethod?: string;
  termMonths?: number;
  startDate?: Date;
  note?: string;
  prospectContactId?: string;
}

export async function listListingOffers(ctx: AuthzContext, listingId: string) {
  require_(ctx, "offers.read");
  await getListing(ctx, listingId); // ownership / workspace gate
  return prisma.offer.findMany({
    where: { workspaceId: ctx.workspaceId, listingId },
    orderBy: { version: "desc" },
  });
}

export async function proposeNewTenancyOffer(ctx: AuthzContext, listingId: string, input: NewOfferInput) {
  require_(ctx, "offers.write");
  if (!(input.annualRent > 0)) throw new AuthzError("Offer rent must be a positive amount", 422);
  const listing = await getListing(ctx, listingId); // ownership / workspace gate
  if (listing.status === "ARCHIVED") throw new AuthzError("Cannot make an offer on an archived listing", 422);

  // Supersede any open figure; the newest is the one on the table.
  await prisma.offer.updateMany({
    where: { listingId, status: { in: ["SENT", "COUNTERED"] } },
    data: { status: "SUPERSEDED" },
  });
  const last = await prisma.offer.findFirst({ where: { listingId }, orderBy: { version: "desc" } });
  const version = (last?.version ?? 0) + 1;

  const offer = await prisma.offer.create({
    data: {
      workspaceId: ctx.workspaceId,
      listingId,
      prospectContactId: input.prospectContactId ?? null,
      version,
      party: input.party,
      annualRent: new Prisma.Decimal(input.annualRent),
      paymentSchedule: input.paymentSchedule,
      paymentMethod: input.paymentMethod ?? null,
      termMonths: input.termMonths ?? null,
      startDate: input.startDate ? toUtcDateOnly(input.startDate) : null,
      note: input.note ?? null,
      status: input.party === "TENANT" ? "COUNTERED" : "SENT",
      createdById: ctx.userId,
    },
  });
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: input.party === "TENANT" ? "OFFER_COUNTERED" : "OFFER_PROPOSED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "OFFER",
    scopeId: offer.id,
    propertyId: listing.propertyId,
    payload: { version, party: input.party, annualRent: input.annualRent, listingId },
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "offer.propose",
    objectType: "Offer",
    objectId: offer.id,
  });
  return offer;
}

export async function acceptNewTenancyOffer(ctx: AuthzContext, offerId: string) {
  require_(ctx, "offers.decide");
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!offer || offer.workspaceId !== ctx.workspaceId) throw new AuthzError("Not found", 404);
  if (!offer.listingId) throw new AuthzError("Not a new-tenancy offer", 422);
  const listing = await getListing(ctx, offer.listingId); // ownership / workspace gate

  await prisma.offer.updateMany({
    where: { listingId: offer.listingId, status: { in: ["SENT", "COUNTERED"] }, id: { not: offerId } },
    data: { status: "SUPERSEDED" },
  });
  const accepted = await prisma.offer.update({ where: { id: offerId }, data: { status: "ACCEPTED" } });
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "OFFER_ACCEPTED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "OFFER",
    scopeId: offerId,
    propertyId: listing.propertyId,
    payload: { version: offer.version, annualRent: Number(offer.annualRent), listingId: offer.listingId },
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "offer.accept",
    objectType: "Offer",
    objectId: offerId,
  });
  return accepted;
}
