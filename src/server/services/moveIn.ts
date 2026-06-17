import type { DocumentKind } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, require_, scope } from "../authz";
import { recordEvidence } from "../evidence";
import { ingestDocument, logDocumentAccess } from "./documents";
import { getTenancy } from "./tenancies";
import { resolveContactScopeIds } from "./contactScope";

// Move-in handover (2A #14) — a condition record for a tenancy with a photo vault
// and a DUAL acknowledgement (landlord + tenant). Scope is enforced by getTenancy:
// a TENANT reaches only their own tenancy's move-in, a LANDLORD only their property's,
// operators any in the workspace. Completed only when BOTH sides have acknowledged.

type AckParty = "LANDLORD" | "TENANT";

export async function createMoveIn(ctx: AuthzContext, tenancyId: string, notes?: string) {
  require_(ctx, "movein.write");
  const tenancy = await getTenancy(ctx, tenancyId); // scope gate
  return prisma.moveIn.create({
    data: {
      workspaceId: ctx.workspaceId,
      tenancyId,
      propertyId: tenancy!.propertyId,
      notes: notes?.trim() || null,
      createdById: ctx.userId,
    },
  });
}

async function loadMoveIn(ctx: AuthzContext, id: string) {
  const m = await prisma.moveIn.findUnique({ where: { id } });
  if (!m || m.workspaceId !== ctx.workspaceId) throw new AuthzError("Not found", 404);
  await getTenancy(ctx, m.tenancyId); // scope gate (persona/operator)
  return m;
}

export async function getMoveIn(ctx: AuthzContext, id: string) {
  require_(ctx, "movein.read");
  return loadMoveIn(ctx, id);
}

export async function listMyMoveIns(ctx: AuthzContext) {
  require_(ctx, "movein.read");
  let where;
  if (ctx.subjectContactId && (ctx.role === "TENANT" || ctx.role === "LANDLORD")) {
    const ids = await resolveContactScopeIds(ctx.workspaceId, ctx.subjectContactId, ctx.role);
    where = { workspaceId: ctx.workspaceId, tenancyId: { in: ids.tenancyIds } };
  } else {
    where = { ...scope(ctx) };
  }
  const rows = await prisma.moveIn.findMany({ where, orderBy: { createdAt: "desc" } });
  // Attach a property label here (a TENANT has no properties.read of its own).
  const props = await prisma.property.findMany({
    where: { id: { in: rows.map((r) => r.propertyId) } },
    select: { id: true, community: true, building: true, unitNo: true },
  });
  const byId = new Map(props.map((p) => [p.id, p]));
  return rows.map((r) => ({ ...r, property: byId.get(r.propertyId) ?? null }));
}

/** Add an inspection photo to the move-in's vault. Stored TENANCY-scoped so ONLY
 *  this tenancy's parties (the current tenant + the owning landlord + operators)
 *  read it — never a former/other tenant of the same unit. */
export async function addMoveInPhoto(
  ctx: AuthzContext,
  id: string,
  file: { fileName: string; mime: string; data: Buffer; kind?: DocumentKind },
) {
  require_(ctx, "movein.write");
  const m = await loadMoveIn(ctx, id);
  const doc = await ingestDocument({
    workspaceId: ctx.workspaceId,
    scopeType: "TENANCY",
    scopeId: m.tenancyId,
    kind: file.kind ?? "MAINTENANCE_PHOTO",
    fileName: file.fileName,
    mime: file.mime,
    data: file.data,
    uploadedById: ctx.userId,
  });
  await logDocumentAccess({ workspaceId: ctx.workspaceId, documentId: doc.id, actorUserId: ctx.userId, action: "UPLOADED" });
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "DOCUMENT_UPLOADED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "TENANCY",
    scopeId: m.tenancyId,
    propertyId: m.propertyId,
    tenancyId: m.tenancyId,
    payload: { documentId: doc.id, moveInId: id, fileName: file.fileName },
  });
  return doc;
}

export async function listMoveInPhotos(ctx: AuthzContext, id: string) {
  require_(ctx, "movein.read");
  const m = await loadMoveIn(ctx, id);
  return prisma.document.findMany({
    where: { workspaceId: ctx.workspaceId, scopeType: "TENANCY", scopeId: m.tenancyId, kind: "MAINTENANCE_PHOTO", archivedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Acknowledge the recorded move-in condition. A persona may only acknowledge their
 * own side; an operator must name the party. The move-in COMPLETES only once BOTH
 * sides have acknowledged — the dual MOVEIN_ACKNOWLEDGED the spec calls for.
 */
export async function acknowledgeMoveIn(ctx: AuthzContext, id: string, party?: AckParty) {
  require_(ctx, "movein.acknowledge");
  const m = await loadMoveIn(ctx, id);

  let ackParty: AckParty;
  if (ctx.role === "TENANT") ackParty = "TENANT";
  else if (ctx.role === "LANDLORD") ackParty = "LANDLORD";
  else {
    if (party !== "LANDLORD" && party !== "TENANT") throw new AuthzError("Specify the acknowledging party", 422);
    ackParty = party;
  }
  if (ackParty === "LANDLORD" && m.landlordAckAt) throw new AuthzError("Landlord has already acknowledged", 422);
  if (ackParty === "TENANT" && m.tenantAckAt) throw new AuthzError("Tenant has already acknowledged", 422);

  const landlordAckAt = ackParty === "LANDLORD" ? new Date() : m.landlordAckAt;
  const tenantAckAt = ackParty === "TENANT" ? new Date() : m.tenantAckAt;
  const both = !!(landlordAckAt && tenantAckAt);
  const updated = await prisma.moveIn.update({
    where: { id },
    data: { landlordAckAt, tenantAckAt, status: both ? "COMPLETED" : "PARTIALLY_ACKNOWLEDGED" },
  });

  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "MOVEIN_ACKNOWLEDGED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "TENANCY",
    scopeId: m.tenancyId,
    tenancyId: m.tenancyId,
    propertyId: m.propertyId,
    payload: { moveInId: id, party: ackParty, byRole: ctx.role },
  });
  if (both) {
    await recordEvidence({
      workspaceId: ctx.workspaceId,
      type: "MOVEIN_COMPLETED",
      actorType: ctx.isStaff ? "STAFF" : "USER",
      actorId: ctx.userId,
      onBehalfOfId: ctx.onBehalfOfId,
      scopeType: "TENANCY",
      scopeId: m.tenancyId,
      tenancyId: m.tenancyId,
      propertyId: m.propertyId,
      payload: { moveInId: id },
    });
  }
  return updated;
}
