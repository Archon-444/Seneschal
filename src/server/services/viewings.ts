import type { ViewingStatus } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, assertSameWorkspace, require_, scope } from "../authz";
import { recordEvidence } from "../evidence";

// Viewings (2A #10) — scheduled property visits for prospective tenants, usually
// arising from an Enquiry. Operator-facing: scheduling/tracking is workspace staff
// work. scheduledAt is a real timestamp slot.

export interface ViewingInput {
  propertyId: string;
  listingId?: string;
  enquiryId?: string;
  contactId?: string;
  prospectName?: string;
  scheduledAt: Date;
  notes?: string;
}

export async function createViewing(ctx: AuthzContext, input: ViewingInput) {
  require_(ctx, "viewings.write");
  const property = await prisma.property.findUnique({ where: { id: input.propertyId } });
  assertSameWorkspace(ctx, property);
  if (!(input.scheduledAt instanceof Date) || isNaN(input.scheduledAt.getTime())) {
    throw new AuthzError("A valid viewing date/time is required", 422);
  }

  const viewing = await prisma.viewing.create({
    data: {
      workspaceId: ctx.workspaceId,
      propertyId: input.propertyId,
      listingId: input.listingId ?? null,
      enquiryId: input.enquiryId ?? null,
      contactId: input.contactId ?? null,
      prospectName: input.prospectName?.trim() || null,
      scheduledAt: input.scheduledAt,
      notes: input.notes?.trim() || null,
      createdById: ctx.userId,
    },
  });
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "VIEWING_SCHEDULED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "PROPERTY",
    scopeId: input.propertyId,
    propertyId: input.propertyId,
    payload: { viewingId: viewing.id, scheduledAt: input.scheduledAt.toISOString(), listingId: input.listingId ?? null },
  });
  return viewing;
}

export async function listViewings(ctx: AuthzContext, filters?: { status?: ViewingStatus; propertyId?: string }) {
  require_(ctx, "viewings.read");
  return prisma.viewing.findMany({
    where: {
      ...scope(ctx),
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.propertyId ? { propertyId: filters.propertyId } : {}),
    },
    orderBy: { scheduledAt: "asc" },
  });
}

export async function setViewingStatus(ctx: AuthzContext, id: string, status: ViewingStatus) {
  require_(ctx, "viewings.write");
  const viewing = await prisma.viewing.findUnique({ where: { id } });
  assertSameWorkspace(ctx, viewing);
  const updated = await prisma.viewing.update({ where: { id }, data: { status } });
  if (status === "COMPLETED") {
    await recordEvidence({
      workspaceId: ctx.workspaceId,
      type: "VIEWING_COMPLETED",
      actorType: ctx.isStaff ? "STAFF" : "USER",
      actorId: ctx.userId,
      onBehalfOfId: ctx.onBehalfOfId,
      scopeType: "PROPERTY",
      scopeId: viewing!.propertyId,
      propertyId: viewing!.propertyId,
      payload: { viewingId: id },
    });
  }
  return updated;
}
