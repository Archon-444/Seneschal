import type { EvidenceType, ScopeType } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, require_, scope } from "../authz";
import { resolveClientScopeIds, scopeMatchClauses } from "./clientScope";

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
