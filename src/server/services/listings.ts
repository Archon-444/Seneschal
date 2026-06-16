import { Prisma, type Listing, type Property } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, require_, scope } from "../authz";
import { recordEvidence } from "../evidence";
import { assertReadable, contactScopedWhere } from "./contactScope";
import { syncListingPermitDeadline } from "./deadlines";
import { listingReadiness, type ListingReadinessResult } from "../calculators/listingReadiness";
import { toUtcDateOnly } from "../calculators/dates";

// Listings (1B issue #1) — the landlord supply side. A listing markets one owned
// Property; it is reached through the property's persona scope, never a hand-rolled
// workspace clause, so the F0a boundary holds (see services/contactScope.ts "LISTING").
// Every listing carries a deterministic readiness score; publication is gated on it.

export interface ListingInput {
  headline?: string | null;
  askingRent?: number | null;
  availableFrom?: Date | null;
  furnished?: boolean | null;
  description?: string | null;
  permitRef?: string | null;
  permitExpiry?: Date | null;
}

function readinessFor(listing: Listing, property: Pick<Property, "bedrooms" | "sizeSqft">): ListingReadinessResult {
  return listingReadiness({
    askingRent: listing.askingRent != null ? Number(listing.askingRent) : null,
    availableFrom: listing.availableFrom,
    furnished: listing.furnished,
    description: listing.description,
    permitRef: listing.permitRef,
    bedrooms: property.bedrooms,
    sizeSqft: property.sizeSqft,
  });
}

/** Map the public input to Prisma column values (Decimal + date-only coercion). */
function toData(input: ListingInput) {
  const data: Prisma.ListingUncheckedUpdateInput = {};
  if (input.headline !== undefined) data.headline = input.headline;
  if (input.askingRent !== undefined) {
    data.askingRent = input.askingRent == null ? null : new Prisma.Decimal(input.askingRent);
  }
  if (input.availableFrom !== undefined) {
    data.availableFrom = input.availableFrom == null ? null : toUtcDateOnly(input.availableFrom);
  }
  if (input.furnished !== undefined) data.furnished = input.furnished;
  if (input.description !== undefined) data.description = input.description;
  if (input.permitRef !== undefined) data.permitRef = input.permitRef;
  if (input.permitExpiry !== undefined) {
    data.permitExpiry = input.permitExpiry == null ? null : toUtcDateOnly(input.permitExpiry);
  }
  return data;
}

export async function createListing(ctx: AuthzContext, propertyId: string, input: ListingInput = {}) {
  require_(ctx, "listings.write");
  // The owning property must be readable by this context — for a LANDLORD persona
  // that means a property in their owned-property scope; for operators, same workspace.
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  await assertReadable(ctx, { kind: "property", row: property });

  const created = await prisma.listing.create({
    data: {
      ...(toData(input) as Prisma.ListingUncheckedCreateInput),
      workspaceId: ctx.workspaceId,
      propertyId,
      createdById: ctx.userId,
    },
  });
  const stored = await storeReadiness(created, property!);
  await syncListingPermitDeadline(stored);

  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "LISTING_CREATED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "LISTING",
    scopeId: stored.id,
    propertyId,
    payload: { headline: stored.headline, readinessScore: stored.readinessScore },
  });
  return stored;
}

export async function updateListing(ctx: AuthzContext, id: string, input: ListingInput) {
  require_(ctx, "listings.write");
  const existing = await getListing(ctx, id); // scope check
  await prisma.listing.update({ where: { id }, data: toData(input) });
  const refreshed = await prisma.listing.findUnique({ where: { id } });
  const stored = await storeReadiness(refreshed!, existing.property);
  await syncListingPermitDeadline(stored);

  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "LISTING_UPDATED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "LISTING",
    scopeId: id,
    propertyId: stored.propertyId,
    payload: { readinessScore: stored.readinessScore },
  });
  return stored;
}

export async function getListing(ctx: AuthzContext, id: string) {
  require_(ctx, "listings.read");
  const listing = await prisma.listing.findUnique({ where: { id }, include: { property: true } });
  await assertReadable(ctx, { kind: "listing", row: listing });
  return listing!;
}

export async function listListings(ctx: AuthzContext) {
  require_(ctx, "listings.read");
  // Persona contexts go through the sanctioned contact-scope builder; operators use
  // workspace scope. scope(ctx) throws for a persona, so a forgotten branch fails closed.
  const where = ctx.subjectContactId ? await contactScopedWhere(ctx, "LISTING") : { ...scope(ctx) };
  return prisma.listing.findMany({
    where,
    include: { property: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function publishListing(ctx: AuthzContext, id: string) {
  require_(ctx, "listings.publish");
  const listing = await getListing(ctx, id);
  if (listing.status === "ARCHIVED") throw new AuthzError("Cannot publish an archived listing", 422);
  const readiness = readinessFor(listing, listing.property);
  if (!readiness.canPublish) {
    const missing = readiness.checks.filter((c) => c.required && !c.ok).map((c) => c.label);
    throw new AuthzError(
      `Listing is not ready to publish (score ${readiness.score}/${100})` +
        (missing.length ? ` — missing: ${missing.join(", ")}` : ""),
      422,
    );
  }
  const updated = await prisma.listing.update({
    where: { id },
    data: {
      status: "PUBLISHED",
      publishedAt: new Date(),
      readinessScore: readiness.score,
      readiness: readiness as unknown as Prisma.InputJsonValue,
    },
  });
  await syncListingPermitDeadline(updated);
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "LISTING_PUBLISHED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "LISTING",
    scopeId: id,
    propertyId: updated.propertyId,
    payload: { readinessScore: readiness.score },
  });
  return updated;
}

export async function archiveListing(ctx: AuthzContext, id: string) {
  require_(ctx, "listings.write");
  await getListing(ctx, id); // scope check
  const updated = await prisma.listing.update({
    where: { id },
    data: { status: "ARCHIVED", archivedAt: new Date() },
  });
  await syncListingPermitDeadline(updated);
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "LISTING_ARCHIVED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "LISTING",
    scopeId: id,
    propertyId: updated.propertyId,
  });
  return updated;
}

/** Recompute the readiness score from current fields and cache it on the row. */
async function storeReadiness(listing: Listing, property: Pick<Property, "bedrooms" | "sizeSqft">) {
  const readiness = readinessFor(listing, property);
  return prisma.listing.update({
    where: { id: listing.id },
    data: {
      readinessScore: readiness.score,
      readiness: readiness as unknown as Prisma.InputJsonValue,
    },
    include: { property: true },
  });
}
