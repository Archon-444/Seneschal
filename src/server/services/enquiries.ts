import type { EnquiryStatus, SecureLink } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, assertSameWorkspace, require_, scope } from "../authz";
import { recordEvidence } from "../evidence";
import { recordNotification } from "../notify/record";
import { workspaceOverseers } from "../notify/recipients";

// Enquiries (1C #8) — inbound interest in a published listing, captured from the
// public listing link (no account). Each enquiry notifies the workspace overseers
// and writes an ENQUIRY_RECEIVED event. Operators triage them in the app.

export interface EnquiryInput {
  name: string;
  email?: string;
  phone?: string;
  message?: string;
}

/** Public path: create an enquiry behind a LISTING_VIEW link. No AuthzContext —
 *  the link's workspace scopes everything; only a currently-PUBLISHED listing qualifies. */
export async function createEnquiryFromLink(link: SecureLink, input: EnquiryInput) {
  if (link.purpose !== "LISTING_VIEW" || link.scopeType !== "LISTING" || !link.scopeId) {
    throw new Error("Link is not a listing link");
  }
  const name = input.name.trim();
  if (!name) throw new Error("A name is required");
  const listing = await prisma.listing.findUnique({ where: { id: link.scopeId } });
  if (!listing || listing.status !== "PUBLISHED") throw new Error("This listing is no longer available");

  // scope-audit: public LISTING_VIEW link path (no ctx); the link's workspace + the
  // resolved PUBLISHED listing scope the enquiry. Not reachable by a delegate context.
  const enquiry = await prisma.enquiry.create({
    data: {
      workspaceId: listing.workspaceId,
      listingId: listing.id,
      propertyId: listing.propertyId,
      name,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      message: input.message?.trim() || null,
      source: "LISTING_LINK",
      secureLinkId: link.id,
    },
  });

  await recordEvidence({
    workspaceId: listing.workspaceId,
    type: "ENQUIRY_RECEIVED",
    actorType: "TENANT_LINK",
    scopeType: "LISTING",
    scopeId: listing.id,
    propertyId: listing.propertyId,
    payload: { enquiryId: enquiry.id, name, hasContact: !!(input.email || input.phone) },
  });

  const overseerIds = await workspaceOverseers(listing.workspaceId);
  await recordNotification({
    workspaceId: listing.workspaceId,
    templateCode: "enquiry_v1",
    subject: `New listing enquiry from ${name}`,
    body:
      `${name} enquired about a listing.\n\n` +
      (input.email ? `Email: ${input.email}\n` : "") +
      (input.phone ? `Phone: ${input.phone}\n` : "") +
      (input.message ? `\n${input.message.trim()}\n` : ""),
    recipientUserIds: overseerIds,
    relatedType: "LISTING",
    relatedId: listing.id,
  });

  return enquiry;
}

export async function listEnquiries(ctx: AuthzContext, filters?: { status?: EnquiryStatus }) {
  require_(ctx, "enquiries.read");
  return prisma.enquiry.findMany({
    where: { ...scope(ctx), ...(filters?.status ? { status: filters.status } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

export async function setEnquiryStatus(ctx: AuthzContext, id: string, status: EnquiryStatus) {
  require_(ctx, "enquiries.write");
  const enquiry = await prisma.enquiry.findUnique({ where: { id } });
  assertSameWorkspace(ctx, enquiry);
  return prisma.enquiry.update({ where: { id }, data: { status } });
}
