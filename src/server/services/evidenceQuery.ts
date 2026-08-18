import type { EvidenceType, ScopeType } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, require_, scope } from "../authz";
import { resolveClientScopeIds, scopeMatchClauses } from "./clientScope";
import { getTenancy } from "./tenancies";

// Evidence timeline reads (T8.2). Writes go only through recordEvidence (T8.1).

// P9 taxonomy display labels
export const EVIDENCE_LABELS: Partial<Record<EvidenceType, string>> = {
  DOCUMENT_UPLOADED: "Document uploaded",
  DOCUMENT_VIEWED: "Document viewed",
  FIELD_EXTRACTED: "Fields extracted",
  FIELD_CONFIRMED: "Fields confirmed",
  FIELD_CORRECTED: "Field corrected",
  IMPORT_COMMITTED: "Import committed",
  IMPORT_ROLLED_BACK: "Import rolled back",
  REMINDER_SENT: "Reminder sent",
  MESSAGE_RECEIVED: "Message received",
  TASK_ASSIGNED: "Task assigned",
  TASK_COMPLETED: "Task completed",
  PROOF_REQUESTED: "Proof requested",
  PROOF_UPLOADED: "Proof uploaded",
  PROOF_APPROVED: "Proof approved",
  PROOF_REJECTED: "Proof rejected",
  CHEQUE_DUE: "Cheque due",
  CHEQUE_RECEIVED: "Cheque received",
  CHEQUE_DEPOSITED: "Cheque deposited",
  CHEQUE_CLEARED: "Cheque cleared",
  CHEQUE_BOUNCED: "Cheque bounced",
  REPORT_GENERATED: "Report generated",
  REPORT_EXPORTED: "Report exported",
  CONSENT_GRANTED: "Consent granted",
  CONSENT_REVOKED: "Consent revoked",
  RISK_FLAG_RAISED: "Risk flag raised",
  RISK_FLAG_CLEARED: "Risk flag cleared",
  RENEWAL_ASSESSMENT_CREATED: "Renewal assessment created",
  RENEWAL_COMPLETED: "Renewal completed",
  INDEX_CAPTURED: "Index figure captured",
  NOTICE_GENERATED: "Notice generated",
  NOTICE_APPROVED: "Notice approved",
  NOTICE_SERVICE_RECORDED: "Notice service recorded (awaiting evidence)",
  NOTICE_SERVED: "Notice served",
  OFFER_PROPOSED: "Offer proposed",
  OFFER_COUNTERED: "Offer countered",
  OFFER_ACCEPTED: "Offer accepted",
  TENANT_ACKNOWLEDGED: "Tenant acknowledged",
  APPROVAL_REQUESTED: "Owner sign-off requested",
  APPROVAL_GRANTED: "Owner sign-off granted",
  APPROVAL_REJECTED: "Owner sign-off rejected",
  EVIDENCE_PACK_EXPORTED: "Evidence pack exported",
};

export interface EvidenceFilters {
  scopeType?: ScopeType;
  scopeId?: string;
  propertyId?: string;
  tenancyId?: string;
  types?: EvidenceType[];
  limit?: number;
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
