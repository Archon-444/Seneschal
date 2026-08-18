import type { ActorType, EvidenceType, Prisma, ScopeType } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, require_, scope } from "../authz";
import { resolveClientScopeIds, scopeMatchClauses } from "./clientScope";
import { getTenancy } from "./tenancies";
import { APPROVED_EVIDENCE_TYPES, titleForEvidenceType } from "./evidencePresenter";

// Evidence timeline reads (T8.2). Writes go only through recordEvidence (T8.1).

// Compatibility export for evidence packs and task receipts. The presenter is
// the single exhaustive vocabulary, so scoped/global labels cannot drift.
export const EVIDENCE_LABELS = Object.fromEntries(
  APPROVED_EVIDENCE_TYPES.map((type) => [type, titleForEvidenceType(type)]),
) as Record<EvidenceType, string>;

export interface EvidenceFilters {
  scopeType?: ScopeType;
  scopeId?: string;
  propertyId?: string;
  tenancyId?: string;
  types?: EvidenceType[];
  limit?: number;
}

export interface EvidencePageFilters extends EvidenceFilters {
  actorTypes?: ActorType[];
  from?: Date;
  to?: Date;
  clientPrincipalId?: string;
  renewalCaseId?: string;
  proofRequestId?: string;
  page?: number;
  pageSize?: number;
  sort?: "asc" | "desc";
  eventId?: string;
}

async function evidencePageWhere(ctx: AuthzContext, filters: EvidencePageFilters): Promise<Prisma.EvidenceEventWhereInput> {
  const and: Prisma.EvidenceEventWhereInput[] = [];
  const effectiveClientId = ctx.clientPrincipalId ?? filters.clientPrincipalId;
  if (effectiveClientId) {
    const ids = await resolveClientScopeIds(ctx.workspaceId, effectiveClientId);
    and.push({
      OR: [
        { propertyId: { in: ids.propertyIds } },
        { tenancyId: { in: ids.tenancyIds } },
        ...scopeMatchClauses(ids),
      ],
    });
  }
  if (filters.propertyId) {
    // scope-audit: property-derived tenancy ids only shape an evidence filter; events remain workspace/client scoped below.
    const tenancyIds = (await prisma.tenancy.findMany({
      where: { workspaceId: ctx.workspaceId, propertyId: filters.propertyId },
      select: { id: true },
    })).map((tenancy) => tenancy.id);
    and.push({
      OR: [
        { propertyId: filters.propertyId },
        { scopeType: "PROPERTY", scopeId: filters.propertyId },
        ...(tenancyIds.length ? [{ tenancyId: { in: tenancyIds } } as Prisma.EvidenceEventWhereInput] : []),
      ],
    });
  }
  if (filters.tenancyId) {
    and.push({ OR: [{ tenancyId: filters.tenancyId }, { scopeType: "TENANCY", scopeId: filters.tenancyId }] });
  }
  if (filters.renewalCaseId) {
    // scope-audit: related offer ids only expand an already workspace-scoped evidence filter.
    const offerIds = (await prisma.offer.findMany({
      where: { workspaceId: ctx.workspaceId, renewalCaseId: filters.renewalCaseId },
      select: { id: true },
    })).map((offer) => offer.id);
    and.push({
      OR: [
        { scopeType: "RENEWAL_CASE", scopeId: filters.renewalCaseId },
        ...(offerIds.length ? [{ scopeType: "OFFER" as const, scopeId: { in: offerIds } }] : []),
      ],
    });
  }
  if (filters.proofRequestId) {
    and.push({ scopeType: "PROOF_REQUEST", scopeId: filters.proofRequestId });
  }
  if (filters.eventId) and.push({ id: filters.eventId });
  if (filters.scopeType) and.push({ scopeType: filters.scopeType });
  if (filters.scopeId) and.push({ scopeId: filters.scopeId });
  if (filters.types) and.push({ type: { in: filters.types } });
  if (filters.actorTypes?.length) and.push({ actorType: { in: filters.actorTypes } });
  if (filters.from || filters.to) {
    and.push({ createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } });
  }
  return { ...scope(ctx), ...(and.length ? { AND: and } : {}) };
}

/** Bounded, deterministic evidence page. Equal timestamps are ordered by id so
 * static pagination never duplicates or omits events. */
export async function listEvidencePage(ctx: AuthzContext, filters: EvidencePageFilters = {}) {
  require_(ctx, "evidence.read");
  const pageSize = Math.min(100, Math.max(10, Math.floor(filters.pageSize ?? 40)));
  const requestedPage = Math.max(1, Math.floor(filters.page ?? 1));
  const where = await evidencePageWhere(ctx, filters);
  const total = await prisma.evidenceEvent.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const events = await prisma.evidenceEvent.findMany({
    where,
    orderBy: filters.sort === "asc"
      ? [{ createdAt: "asc" }, { id: "asc" }]
      : [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return { events, page, pageSize, total, totalPages };
}

/** Read correction relationships without widening the caller's evidence scope. */
export async function listEvidenceLineage(ctx: AuthzContext, eventIds: string[], supersededIds: string[]) {
  require_(ctx, "evidence.read");
  const base = await evidencePageWhere(ctx, {});
  const [correctedBy, superseded] = await Promise.all([
    prisma.evidenceEvent.findMany({
      where: { AND: [base, { supersedesId: { in: eventIds } }] },
      select: { id: true, type: true, supersedesId: true },
    }),
    prisma.evidenceEvent.findMany({
      where: { AND: [base, { id: { in: supersededIds } }] },
      select: { id: true, type: true },
    }),
  ]);
  return { correctedBy, superseded };
}

export async function listEvidence(ctx: AuthzContext, filters?: EvidenceFilters) {
  require_(ctx, "evidence.read");
  // CLIENT_VIEWER: evidence is scope-polymorphic — constrain to events whose
  // propertyId/tenancyId or scopeType/scopeId resolve to the viewer's client.
  let clientOr = null;
  if (ctx.clientPrincipalId) {
    const ids = await resolveClientScopeIds(ctx.workspaceId, ctx.clientPrincipalId);
    clientOr = [
      { propertyId: { in: ids.propertyIds } },
      { tenancyId: { in: ids.tenancyIds } },
      ...scopeMatchClauses(ids),
    ];
  }
  return prisma.evidenceEvent.findMany({
    where: {
      ...scope(ctx),
      ...(clientOr ? { OR: clientOr } : {}),
      ...(filters?.scopeType ? { scopeType: filters.scopeType } : {}),
      ...(filters?.scopeId ? { scopeId: filters.scopeId } : {}),
      ...(filters?.propertyId ? { propertyId: filters.propertyId } : {}),
      ...(filters?.tenancyId ? { tenancyId: filters.tenancyId } : {}),
      ...(filters?.types?.length ? { type: { in: filters.types } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: filters?.limit ?? 500,
  });
}

/**
 * Complete chronology for one tenancy. The AND-only filter shape of listEvidence
 * cannot express this: proof uploads and some document events carry no tenancyId.
 */
export async function listEvidenceForTenancy(ctx: AuthzContext, tenancyId: string) {
  require_(ctx, "evidence.read");
  const tenancy = await getTenancy(ctx, tenancyId);

  const cases = await prisma.renewalCase.findMany({
    where: { workspaceId: ctx.workspaceId, tenancyId },
    select: { id: true },
  });
  const caseIds = cases.map((c) => c.id);
  const offers = await prisma.offer.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      OR: [{ tenancyId }, ...(caseIds.length ? [{ renewalCaseId: { in: caseIds } }] : [])],
    },
    select: { id: true },
  });
  const offerIds = offers.map((o) => o.id);
  const itemIds = tenancy.paymentItems.map((i) => i.id);
  const proofs = await prisma.proofRequest.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      OR: [
        { scopeType: "TENANCY", scopeId: tenancyId },
        ...(itemIds.length ? [{ scopeType: "PAYMENT_ITEM" as const, scopeId: { in: itemIds } }] : []),
        ...(caseIds.length ? [{ scopeType: "RENEWAL_CASE" as const, scopeId: { in: caseIds } }] : []),
        { scopeType: "PROPERTY", scopeId: tenancy.propertyId },
      ],
    },
    select: { id: true },
  });
  const proofIds = proofs.map((p) => p.id);

  return prisma.evidenceEvent.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      OR: [
        { tenancyId },
        { scopeType: "TENANCY", scopeId: tenancyId },
        ...(caseIds.length ? [{ scopeType: "RENEWAL_CASE" as const, scopeId: { in: caseIds } }] : []),
        ...(offerIds.length ? [{ scopeType: "OFFER" as const, scopeId: { in: offerIds } }] : []),
        ...(proofIds.length ? [{ scopeType: "PROOF_REQUEST" as const, scopeId: { in: proofIds } }] : []),
        ...(itemIds.length ? [{ scopeType: "PAYMENT_ITEM" as const, scopeId: { in: itemIds } }] : []),
      ],
    },
    orderBy: { createdAt: "asc" },
  });
}
