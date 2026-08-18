import type { ApprovalDecision, Offer, SecureLink } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, assertSameWorkspace, require_ } from "../authz";
import { recordAudit } from "../audit";
import { recordEvidence } from "../evidence";
import { sha256Hex } from "../crypto";
import { APPROVAL_COMMENT_MAX } from "@/lib/approvalLimits";
import { createSecureLink, consumeLinkUse, validateLinkToken } from "./secureLinks";
import { getTenancy } from "./tenancies";
import { evaluateRenewalRisk } from "./risk";

// Absentee-owner APPROVAL link. A recorded sign-off on an offer's exact terms,
// not a workflow gate: sendOfferToTenant / acceptOffer are not blocked on it.
// The owner's attestation is the evidence (actor on the record is the link-party,
// not the agent). Zero enum churn: LinkPurpose.APPROVAL, the Approval model, and
// APPROVAL_REQUESTED/GRANTED/REJECTED were reserved in schema v1.

export interface OfferApprovalSnapshot {
  offerId: string;
  version: number;
  party: string;
  annualRent: number;
  paymentSchedule: string;
  paymentMethod: string | null;
  termMonths: number | null;
  tenancyId: string | null;
  propertyId: string | null;
  community: string | null;
  building: string | null;
  unitNo: string | null;
}

/** Canonical snapshot hashed onto Approval.payloadHash ("exactly what was approved"). */
export function offerApprovalSnapshot(
  offer: Pick<Offer, "id" | "version" | "party" | "annualRent" | "paymentSchedule" | "paymentMethod" | "termMonths" | "tenancyId">,
  property?: { id: string; community: string; building: string | null; unitNo: string | null } | null,
): OfferApprovalSnapshot {
  return {
    offerId: offer.id,
    version: offer.version,
    party: offer.party,
    annualRent: Number(offer.annualRent),
    paymentSchedule: offer.paymentSchedule,
    paymentMethod: offer.paymentMethod,
    termMonths: offer.termMonths,
    tenancyId: offer.tenancyId,
    propertyId: property?.id ?? null,
    community: property?.community ?? null,
    building: property?.building ?? null,
    unitNo: property?.unitNo ?? null,
  };
}

const SIGNABLE: ReadonlySet<string> = new Set(["SENT", "COUNTERED", "ACCEPTED"]);

/** Open pending = not yet decided and not superseded by a later request. */
const OPEN_PENDING = { decision: null, decidedAt: null } as const;

function clampApprovalComment(comment?: string): string | undefined {
  const trimmed = comment?.trim();
  if (!trimmed) return undefined;
  return trimmed.length > APPROVAL_COMMENT_MAX ? trimmed.slice(0, APPROVAL_COMMENT_MAX) : trimmed;
}

export async function requestOwnerApproval(
  ctx: AuthzContext,
  input: { offerId: string; contactId: string },
) {
  require_(ctx, "renewals.decide");
  const offer = await prisma.offer.findUnique({ where: { id: input.offerId } });
  assertSameWorkspace(ctx, offer);
  if (!offer!.tenancyId) throw new AuthzError("Not a renewal offer", 422);
  if (!SIGNABLE.has(offer!.status)) {
    throw new AuthzError(`Offer is not open for sign-off (current: ${offer!.status})`, 422);
  }
  const tenancy = await getTenancy(ctx, offer!.tenancyId);
  const contact = await prisma.contact.findUnique({ where: { id: input.contactId } });
  assertSameWorkspace(ctx, contact);

  const snapshot = offerApprovalSnapshot(offer!, tenancy!.property);
  const payloadHash = sha256Hex(JSON.stringify(snapshot));

  // Re-request: close prior open pending rows (decidedAt set, decision left
  // null — not a reject) and revoke unused APPROVAL links so decide cannot
  // claim a stale row. The new APPROVAL_REQUESTED supersedes the previous.
  const priorRequested = await prisma.evidenceEvent.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      type: "APPROVAL_REQUESTED",
      scopeType: "OFFER",
      scopeId: offer!.id,
    },
    orderBy: { createdAt: "desc" },
  });
  await prisma.approval.updateMany({
    where: {
      workspaceId: ctx.workspaceId,
      subjectType: "offer",
      subjectId: offer!.id,
      ...OPEN_PENDING,
    },
    data: { decidedAt: new Date() },
  });
  await prisma.secureLink.updateMany({
    where: {
      workspaceId: ctx.workspaceId,
      purpose: "APPROVAL",
      scopeType: "OFFER",
      scopeId: offer!.id,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  const approval = await prisma.approval.create({
    data: {
      workspaceId: ctx.workspaceId,
      subjectType: "offer",
      subjectId: offer!.id,
      requestedOfContactId: input.contactId,
      payloadHash,
      decision: null,
      decidedAt: null,
    },
  });
  const link = await createSecureLink(ctx, {
    purpose: "APPROVAL",
    scopeType: "OFFER",
    scopeId: offer!.id,
    contactId: input.contactId,
    maxUses: 1,
    requiredCapability: "renewals.decide",
  });
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "APPROVAL_REQUESTED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "OFFER",
    scopeId: offer!.id,
    tenancyId: offer!.tenancyId,
    propertyId: tenancy!.propertyId,
    payload: { approvalId: approval.id, version: offer!.version },
    supersedesId: priorRequested?.id ?? null,
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "approval.request",
    objectType: "Approval",
    objectId: approval.id,
  });
  return { approvalId: approval.id, url: link.url };
}

export interface ApprovalLinkView {
  approvalId: string;
  offerId: string;
  version: number;
  party: string;
  annualRent: number;
  paymentSchedule: string;
  paymentMethod: string | null;
  termMonths: number | null;
  unit: string;
}

/** Public resolver for an APPROVAL secure link. No AuthzContext. */
export async function getApprovalForLink(link: SecureLink): Promise<ApprovalLinkView | null> {
  // scope-audit: public APPROVAL link path (no ctx); purpose/scopeType/workspace
  // match on the validated token is the gate, before any offer fetch.
  if (link.purpose !== "APPROVAL" || link.scopeType !== "OFFER") return null;
  if (link.revokedAt) return null;
  const offer = await prisma.offer.findUnique({ where: { id: link.scopeId } });
  if (!offer || offer.workspaceId !== link.workspaceId) return null;
  const approval = await prisma.approval.findFirst({
    where: {
      workspaceId: link.workspaceId,
      subjectType: "offer",
      subjectId: offer.id,
      ...OPEN_PENDING,
    },
    orderBy: { createdAt: "desc" },
  });
  if (!approval) return null;
  const tenancy = offer.tenancyId
    ? await prisma.tenancy.findUnique({
        where: { id: offer.tenancyId },
        include: { property: true },
      })
    : null;
  const p = tenancy?.property;
  const unit = p ? [p.community, p.building, p.unitNo].filter(Boolean).join(" · ") : "Unit";
  return {
    approvalId: approval.id,
    offerId: offer.id,
    version: offer.version,
    party: offer.party,
    annualRent: Number(offer.annualRent),
    paymentSchedule: offer.paymentSchedule,
    paymentMethod: offer.paymentMethod,
    termMonths: offer.termMonths,
    unit,
  };
}

/**
 * Record the owner's decision via the public link. Consume-first (H4): the use
 * is claimed before any Approval write so a maxUses=1 link cannot double-decide.
 * Public link paths never write AuditEvent.
 */
export async function decideApprovalViaLink(
  token: string,
  decision: ApprovalDecision,
  comment?: string,
) {
  const validation = await validateLinkToken(token);
  if (!validation.ok) throw new AuthzError("This link is no longer available.", 400);
  if (validation.link.purpose !== "APPROVAL") {
    throw new AuthzError("This link is no longer available.", 400);
  }
  const { consumed } = await consumeLinkUse(validation.link.id);
  if (!consumed) throw new AuthzError("This link is no longer available.", 400);

  const link = validation.link;
  // scope-audit: public APPROVAL decide path (no ctx); consume-first on the
  // validated token is the gate. Side effects are confined to the link's
  // workspace + the pending Approval for this offer.
  const offer = await prisma.offer.findUnique({ where: { id: link.scopeId } });
  if (!offer || offer.workspaceId !== link.workspaceId) {
    throw new AuthzError("This link is no longer available.", 400);
  }
  let propertyId: string | null = null;
  if (offer.tenancyId) {
    const tenancy = await prisma.tenancy.findUnique({ where: { id: offer.tenancyId } });
    if (!tenancy || tenancy.workspaceId !== link.workspaceId) {
      throw new AuthzError("This link is no longer available.", 400);
    }
    propertyId = tenancy.propertyId;
  }
  const pending = await prisma.approval.findFirst({
    where: {
      workspaceId: link.workspaceId,
      subjectType: "offer",
      subjectId: offer.id,
      ...OPEN_PENDING,
    },
    orderBy: { createdAt: "desc" },
  });
  if (!pending) throw new AuthzError("Already decided", 409);

  const claim = await prisma.approval.updateMany({
    where: { id: pending.id, ...OPEN_PENDING },
    data: { decision, decidedAt: new Date() },
  });
  if (claim.count !== 1) throw new AuthzError("Already decided", 409);

  const note = clampApprovalComment(comment);
  await recordEvidence({
    workspaceId: link.workspaceId,
    type: decision === "APPROVED" ? "APPROVAL_GRANTED" : "APPROVAL_REJECTED",
    actorType: "TENANT_LINK",
    actorId: null,
    scopeType: "OFFER",
    scopeId: offer.id,
    tenancyId: offer.tenancyId,
    propertyId,
    payload: {
      viaLink: true,
      decision,
      approvalId: pending.id,
      offerVersion: offer.version,
      offerStatus: offer.status,
      ...(note ? { comment: note } : {}),
    },
  });
  if (offer.renewalCaseId) await evaluateRenewalRisk(offer.renewalCaseId);
  return { approvalId: pending.id, decision };
}
