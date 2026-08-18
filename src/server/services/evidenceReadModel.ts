import { ActorType, type EvidenceType, type Prisma } from "@prisma/client";
import { type AuthzContext, require_ } from "../authz";
import { prisma } from "../db";
import { formatDubaiDate } from "../calculators/dates";
import { listClients } from "./clients";
import { listProperties } from "./properties";
import { listProofRequests } from "./proofs";
import { listEvidenceLineage, listEvidencePage } from "./evidenceQuery";
import {
  APPROVED_EVIDENCE_TYPES,
  evidenceTypesForCategory,
  presentEvidenceEvent,
  titleForEvidenceType,
  type PresentedEvidenceEvent,
} from "./evidencePresenter";

export interface EvidenceTimelineFilters {
  type?: string;
  category?: string;
  actor?: string;
  from?: Date;
  to?: Date;
  client?: string;
  property?: string;
  tenancy?: string;
  renewal?: string;
  proof?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: "asc" | "desc";
  event?: string;
}

function approvedTypes(filters: EvidenceTimelineFilters): EvidenceType[] | undefined {
  let types = filters.type && APPROVED_EVIDENCE_TYPES.includes(filters.type as EvidenceType)
    ? [filters.type as EvidenceType]
    : evidenceTypesForCategory(filters.category);
  const q = filters.q?.trim().toLowerCase();
  if (q) {
    const matching = APPROVED_EVIDENCE_TYPES.filter((type) => titleForEvidenceType(type).toLowerCase().includes(q));
    types = types ? types.filter((type) => matching.includes(type)) : matching;
  }
  return types;
}

function stringField(payload: Prisma.JsonValue | null, keys: string[]): string[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const row = payload as Record<string, Prisma.JsonValue>;
  return keys.flatMap((key) => typeof row[key] === "string" ? [row[key] as string] : []);
}

function propertyLabel(property: { community: string; building: string | null; unitNo: string | null }) {
  return [property.community, property.building, property.unitNo].filter(Boolean).join(" · ") || "Property";
}

function tenancyLabel(tenancy: { ejariNo: string | null; startDate: Date; endDate: Date }) {
  return tenancy.ejariNo
    ? `Tenancy · Ejari ${tenancy.ejariNo}`
    : `Tenancy · ${formatDubaiDate(tenancy.startDate)}–${formatDubaiDate(tenancy.endDate)}`;
}

export async function getEvidenceTimeline(ctx: AuthzContext, filters: EvidenceTimelineFilters = {}) {
  require_(ctx, "evidence.read");
  const types = approvedTypes(filters);
  const actorTypes = filters.actor && Object.values(ActorType).includes(filters.actor as ActorType)
    ? [filters.actor as ActorType]
    : undefined;
  const pageResult = await listEvidencePage(ctx, {
    types,
    actorTypes,
    from: filters.from,
    to: filters.to,
    clientPrincipalId: filters.client,
    propertyId: filters.property,
    tenancyId: filters.tenancy,
    renewalCaseId: filters.renewal,
    proofRequestId: filters.proof,
    page: filters.page,
    pageSize: filters.pageSize,
    sort: filters.sort,
    eventId: filters.event,
  });
  const events = pageResult.events;
  const ids = (values: Array<string | null | undefined>) => [...new Set(values.filter((value): value is string => !!value))];

  const actorIds = ids(events.flatMap((event) => [event.actorId, event.onBehalfOfId]));
  const propertyIds = ids(events.flatMap((event) => [event.propertyId, event.scopeType === "PROPERTY" ? event.scopeId : null]));
  const tenancyIds = ids(events.flatMap((event) => [event.tenancyId, event.scopeType === "TENANCY" ? event.scopeId : null]));
  const clientIds = ids(events.map((event) => event.scopeType === "CLIENT" ? event.scopeId : null));
  const caseIds = ids(events.map((event) => event.scopeType === "RENEWAL_CASE" ? event.scopeId : null));
  const offerIds = ids(events.map((event) => event.scopeType === "OFFER" ? event.scopeId : null));
  const proofIds = ids(events.map((event) => event.scopeType === "PROOF_REQUEST" ? event.scopeId : null));
  const paymentIds = ids(events.map((event) => event.scopeType === "PAYMENT_ITEM" ? event.scopeId : null));
  const documentIds = ids(events.flatMap((event) => stringField(event.payload, ["documentId", "docId", "fileDocId"])));
  const supersededIds = ids(events.map((event) => event.supersedesId));

  // scope-audit: every id below originates from already authorized evidence rows; each persona model is workspace-constrained.
  const [users, memberships, clients, properties, tenancies, cases, offers, proofs, payments, documents, lineage] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }),
    prisma.membership.findMany({ where: { workspaceId: ctx.workspaceId, userId: { in: actorIds }, revokedAt: null }, select: { userId: true, role: true } }),
    prisma.clientPrincipal.findMany({ where: { workspaceId: ctx.workspaceId, id: { in: clientIds } }, select: { id: true, displayName: true } }),
    prisma.property.findMany({ where: { workspaceId: ctx.workspaceId, id: { in: propertyIds } }, select: { id: true, clientPrincipalId: true, community: true, building: true, unitNo: true } }),
    prisma.tenancy.findMany({ where: { workspaceId: ctx.workspaceId, id: { in: tenancyIds } }, select: { id: true, propertyId: true, ejariNo: true, startDate: true, endDate: true } }),
    prisma.renewalCase.findMany({ where: { workspaceId: ctx.workspaceId, id: { in: caseIds } }, select: { id: true, tenancyId: true, status: true } }),
    prisma.offer.findMany({ where: { workspaceId: ctx.workspaceId, id: { in: offerIds } }, select: { id: true, tenancyId: true, renewalCaseId: true, version: true, party: true, status: true } }),
    prisma.proofRequest.findMany({ where: { workspaceId: ctx.workspaceId, id: { in: proofIds } }, select: { id: true, title: true, status: true } }),
    prisma.paymentItem.findMany({ where: { workspaceId: ctx.workspaceId, id: { in: paymentIds } }, select: { id: true, tenancyId: true, seq: true, status: true } }),
    prisma.document.findMany({ where: { workspaceId: ctx.workspaceId, id: { in: documentIds }, archivedAt: null }, select: { id: true, fileName: true, sha256: true } }),
    listEvidenceLineage(ctx, events.map((event) => event.id), supersededIds),
  ]);

  const userMap = new Map(users.map((user) => [user.id, user.name]));
  const roleMap = new Map(memberships.map((membership) => [membership.userId, membership.role]));
  const clientMap = new Map(clients.map((client) => [client.id, client]));
  const propertyMap = new Map(properties.map((property) => [property.id, property]));
  const tenancyMap = new Map(tenancies.map((tenancy) => [tenancy.id, tenancy]));
  const caseMap = new Map(cases.map((renewalCase) => [renewalCase.id, renewalCase]));
  const offerMap = new Map(offers.map((offer) => [offer.id, offer]));
  const proofMap = new Map(proofs.map((proof) => [proof.id, proof]));
  const paymentMap = new Map(payments.map((payment) => [payment.id, payment]));
  const documentMap = new Map(documents.map((document) => [document.id, document]));
  const supersededMap = new Map(lineage.superseded.map((event) => [event.id, event]));

  function actorLabel(actorType: string, actorId: string | null) {
    if (!actorId) return `${actorType.toLowerCase().replace(/_/g, " ")} actor · identity unavailable`;
    const name = userMap.get(actorId);
    const role = roleMap.get(actorId);
    return name ? `${name}${role ? ` · ${role.toLowerCase().replace(/_/g, " ")}` : ""}` : "Actor identity unavailable";
  }

  function scopeContext(event: (typeof events)[number]) {
    let label = event.scopeType.replace(/_/g, " ").toLowerCase();
    let href: string | null = null;
    let unavailable = false;
    const relatedLinks: { label: string; href?: string; detail?: string }[] = [];

    if (event.scopeType === "CLIENT" && event.scopeId) {
      const client = clientMap.get(event.scopeId);
      if (client) { label = client.displayName; href = `/clients/${client.id}`; } else unavailable = true;
    } else if (event.scopeType === "PROPERTY" && event.scopeId) {
      const property = propertyMap.get(event.scopeId);
      if (property) { label = propertyLabel(property); href = `/properties/${property.id}`; } else unavailable = true;
    } else if (event.scopeType === "TENANCY" && event.scopeId) {
      const tenancy = tenancyMap.get(event.scopeId);
      if (tenancy) { label = tenancyLabel(tenancy); href = `/renewals/${tenancy.id}`; } else unavailable = true;
    } else if (event.scopeType === "RENEWAL_CASE" && event.scopeId) {
      const renewalCase = caseMap.get(event.scopeId);
      if (renewalCase) { label = `Renewal case · ${renewalCase.status.toLowerCase().replace(/_/g, " ")}`; href = `/renewals/${renewalCase.tenancyId}`; } else unavailable = true;
    } else if (event.scopeType === "OFFER" && event.scopeId) {
      const offer = offerMap.get(event.scopeId);
      if (offer) { label = `${offer.party.toLowerCase()} offer v${offer.version} · ${offer.status.toLowerCase()}`; href = offer.tenancyId ? `/renewals/${offer.tenancyId}?view=terms` : null; } else unavailable = true;
    } else if (event.scopeType === "PROOF_REQUEST" && event.scopeId) {
      const proof = proofMap.get(event.scopeId);
      if (proof) { label = `${proof.title} · ${proof.status.toLowerCase().replace(/_/g, " ")}`; href = `/proofs/${proof.id}`; } else unavailable = true;
    } else if (event.scopeType === "PAYMENT_ITEM" && event.scopeId) {
      const payment = paymentMap.get(event.scopeId);
      if (payment) { label = `Payment item ${payment.seq} · ${payment.status.toLowerCase()}`; href = "/payments"; } else unavailable = true;
    }

    const property = event.propertyId ? propertyMap.get(event.propertyId) : null;
    if (property && event.scopeType !== "PROPERTY") relatedLinks.push({ label: propertyLabel(property), href: `/properties/${property.id}`, detail: "Property" });
    const tenancy = event.tenancyId ? tenancyMap.get(event.tenancyId) : null;
    if (tenancy && event.scopeType !== "TENANCY") relatedLinks.push({ label: tenancyLabel(tenancy), href: `/renewals/${tenancy.id}`, detail: "Tenancy" });
    for (const documentId of stringField(event.payload, ["documentId", "docId", "fileDocId"])) {
      const document = documentMap.get(documentId);
      relatedLinks.push(document
        ? { label: document.fileName, href: `/vault/${document.id}`, detail: `Document · SHA-256 ${document.sha256}` }
        : { label: "Related document unavailable", detail: "Document" });
    }
    return { label: unavailable ? "Related record unavailable" : label, href: unavailable ? null : href, unavailable, relatedLinks };
  }

  const presented: PresentedEvidenceEvent[] = events.map((event) => {
    const scope = scopeContext(event);
    const corrections = lineage.correctedBy.filter((candidate) => candidate.supersedesId === event.id);
    const original = event.supersedesId ? supersededMap.get(event.supersedesId) : null;
    return presentEvidenceEvent(event, {
      actorLabel: actorLabel(event.actorType, event.actorId),
      onBehalfOfLabel: event.onBehalfOfId ? actorLabel("USER", event.onBehalfOfId) : undefined,
      scopeLabel: scope.label,
      scopeHref: scope.href,
      relatedLinks: scope.relatedLinks,
      unavailableRelatedRecord: scope.unavailable,
      correctedBy: corrections.map((candidate) => ({ id: candidate.id, title: titleForEvidenceType(candidate.type) })),
      supersedesTitle: original ? titleForEvidenceType(original.type) : undefined,
    });
  });

  return { ...pageResult, events: presented };
}

export async function getEvidenceFilterOptions(ctx: AuthzContext) {
  require_(ctx, "evidence.read");
  const [clients, properties, proofs] = await Promise.all([
    listClients(ctx),
    listProperties(ctx),
    listProofRequests(ctx),
  ]);
  const propertyIds = properties.map((property) => property.id);
  // scope-audit: property ids came from listProperties' persona/client/delegate-safe result.
  const tenancies = await prisma.tenancy.findMany({
    where: { workspaceId: ctx.workspaceId, propertyId: { in: propertyIds }, archivedAt: null },
    select: { id: true, propertyId: true, ejariNo: true, startDate: true, endDate: true },
    orderBy: { endDate: "desc" },
    take: 500,
  });
  // scope-audit: tenancy ids came from the authorized property set above.
  const renewals = await prisma.renewalCase.findMany({
    where: { workspaceId: ctx.workspaceId, tenancyId: { in: tenancies.map((tenancy) => tenancy.id) }, archivedAt: null },
    select: { id: true, tenancyId: true, status: true },
    orderBy: { updatedAt: "desc" },
    take: 300,
  });
  const propertyById = new Map(properties.map((property) => [property.id, property]));
  return {
    actorTypes: Object.values(ActorType),
    clients: clients.map((client) => ({ id: client.id, label: client.displayName })),
    properties: properties.map((property) => ({ id: property.id, label: propertyLabel(property) })),
    tenancies: tenancies.map((tenancy) => ({
      id: tenancy.id,
      label: `${propertyById.get(tenancy.propertyId) ? propertyLabel(propertyById.get(tenancy.propertyId)!) : "Related property unavailable"} · ${tenancyLabel(tenancy)}`,
    })),
    renewals: renewals.map((renewal) => ({ id: renewal.id, label: `Renewal · ${renewal.status.toLowerCase().replace(/_/g, " ")}` })),
    proofs: proofs.slice(0, 300).map((proof) => ({ id: proof.id, label: proof.title })),
  };
}
