import type { ActorType, EvidenceType } from "@prisma/client";
import { hasCapability, type AuthzContext } from "../authz";
import { prisma } from "../db";
import { EVIDENCE_LABELS, listEvidenceForTenancy } from "./evidenceQuery";
import { getRenewalRisk, type RenewalRisk } from "./renewals";
import type { RenewalNextActionCode } from "./renewalNextAction";

export type RenewalTaskCode =
  | "ASSESS_SOURCE"
  | "OPEN_CASE"
  | "SERVE_NOTICE"
  | "PROVE_SERVICE"
  | "PROPOSE_TERMS"
  | "SEND_TERMS"
  | "RECORD_RESPONSE"
  | "COMPLETE_RENEWAL"
  | "REVIEW_EVIDENCE";

export type RenewalTaskState = "COMPLETED" | "CURRENT" | "BLOCKED" | "FUTURE" | "NOT_APPLICABLE";

export interface RenewalTaskReceipt {
  label: string;
  at: Date;
  actorType?: ActorType;
  eventId?: string;
}

export interface RenewalWorkspaceTask {
  code: RenewalTaskCode;
  number: number;
  title: string;
  state: RenewalTaskState;
  summary: string;
  prerequisite?: string;
  receipt?: RenewalTaskReceipt;
}

export interface RenewalTaskFacts {
  nextActionCode: RenewalNextActionCode;
  indexCapturedAt: Date | null;
  indexProvisional: boolean;
  caseOpenedAt: Date | null;
  notice: RenewalRisk["currentNotice"];
  offers: RenewalRisk["offers"];
  renewedAt: Date | null;
  receipts?: Partial<Record<RenewalTaskCode, RenewalTaskReceipt>>;
}

const TITLES: Record<RenewalTaskCode, string> = {
  ASSESS_SOURCE: "Assess renewal and capture source",
  OPEN_CASE: "Open renewal case",
  SERVE_NOTICE: "Prepare and serve change notice",
  PROVE_SERVICE: "Add proof of service",
  PROPOSE_TERMS: "Propose renewal terms",
  SEND_TERMS: "Send terms to tenant",
  RECORD_RESPONSE: "Record tenant response or agreement",
  COMPLETE_RENEWAL: "Create successor tenancy",
  REVIEW_EVIDENCE: "Review evidence pack",
};

const ACTION_TASK: Partial<Record<RenewalNextActionCode, RenewalTaskCode>> = {
  CAPTURE_INDEX: "ASSESS_SOURCE",
  VERIFY_INDEX_SOURCE: "ASSESS_SOURCE",
  OPEN_CASE: "OPEN_CASE",
  SERVE_NOTICE: "SERVE_NOTICE",
  ADD_SERVICE_EVIDENCE: "PROVE_SERVICE",
  PREPARE_TERMS: "PROPOSE_TERMS",
  SEND_OFFER: "SEND_TERMS",
  AWAIT_TENANT: "RECORD_RESPONSE",
  REVIEW_COUNTER: "RECORD_RESPONSE",
  COMPLETE_RENEWAL: "COMPLETE_RENEWAL",
  REVIEW_COMPLETED_CASE: "REVIEW_EVIDENCE",
  REVIEW_CASE: "SERVE_NOTICE",
  NO_ACTION: "REVIEW_EVIDENCE",
};

export function deriveRenewalTaskPath(facts: RenewalTaskFacts): RenewalWorkspaceTask[] {
  const landlordOffer = facts.offers.some((offer) => offer.party === "LANDLORD");
  const tenantResponse = facts.offers.some(
    (offer) => offer.party === "TENANT" || offer.status === "ACCEPTED",
  );
  const termsDelivered = facts.offers.some((offer) => offer.sentToTenant) || tenantResponse;
  const accepted = facts.offers.some((offer) => offer.status === "ACCEPTED");
  const noticeServed = facts.notice?.status === "SERVED";
  const pendingServiceEvidence = facts.notice?.status === "SERVICE_RECORDED_PENDING_EVIDENCE";
  const activeTask = ACTION_TASK[facts.nextActionCode] ?? "REVIEW_EVIDENCE";
  const blockedActive = facts.nextActionCode === "AWAIT_TENANT";

  const completed: Record<RenewalTaskCode, boolean> = {
    ASSESS_SOURCE: facts.indexCapturedAt != null && !facts.indexProvisional,
    OPEN_CASE: facts.caseOpenedAt != null,
    SERVE_NOTICE: noticeServed,
    PROVE_SERVICE: noticeServed,
    PROPOSE_TERMS: landlordOffer || tenantResponse,
    SEND_TERMS: termsDelivered,
    RECORD_RESPONSE: tenantResponse,
    COMPLETE_RENEWAL: facts.renewedAt != null,
    REVIEW_EVIDENCE: false,
  };

  const summaries: Record<RenewalTaskCode, string> = {
    ASSESS_SOURCE: completed.ASSESS_SOURCE
      ? "A verified source is recorded for the index-based estimate."
      : facts.indexProvisional
        ? "A provisional concierge figure is recorded and still needs verification."
        : "No verified source is recorded for this renewal assessment.",
    OPEN_CASE: completed.OPEN_CASE
      ? "The renewal case is open and its assessment record is retained."
      : "Open a case only after the source position is understood.",
    SERVE_NOTICE: noticeServed
      ? "The change notice is recorded as served with supporting proof."
      : pendingServiceEvidence
        ? "Service was recorded but is not treated as served until proof is attached."
        : "Prepare and record notice service with supporting proof where required.",
    PROVE_SERVICE: noticeServed
      ? "Proof of service is attached to the served notice record."
      : pendingServiceEvidence
        ? "Add a delivery reference, service document, or signed attestation."
        : "This becomes available when notice service is recorded.",
    PROPOSE_TERMS: completed.PROPOSE_TERMS
      ? "Versioned renewal terms are retained in the case record."
      : "Prepare terms only after the notice position is recorded.",
    SEND_TERMS: completed.SEND_TERMS
      ? "Tenant delivery or a tenant response is recorded."
      : "No tenant delivery link is recorded for the current landlord proposal.",
    RECORD_RESPONSE: completed.RECORD_RESPONSE
      ? facts.nextActionCode === "REVIEW_COUNTER"
        ? "A tenant counter is recorded and requires a fiduciary decision."
        : "A tenant counter or accepted agreement is retained in the offer history."
      : facts.nextActionCode === "AWAIT_TENANT"
        ? "The current proposal is with the tenant; no operator mutation is required yet."
        : "This becomes available after the current terms are delivered.",
    COMPLETE_RENEWAL: completed.COMPLETE_RENEWAL
      ? "The successor tenancy and renewal completion record are available."
      : accepted
        ? "Accepted terms are recorded; create the successor tenancy to complete the renewal."
        : "This becomes available after accepted terms are recorded.",
    REVIEW_EVIDENCE: facts.renewedAt
      ? "Review or export the completed case evidence pack."
      : "The evidence pack remains available for oversight throughout the case.",
  };

  const prerequisites: Partial<Record<RenewalTaskCode, string>> = {
    OPEN_CASE: "Requires a reviewed source position.",
    SERVE_NOTICE: "Requires an open renewal case.",
    PROVE_SERVICE: "Requires recorded notice service.",
    PROPOSE_TERMS: "Requires a recorded notice position.",
    SEND_TERMS: "Requires current landlord terms.",
    RECORD_RESPONSE: "Requires terms delivered to the tenant.",
    COMPLETE_RENEWAL: "Requires persisted accepted/agreed terms.",
    REVIEW_EVIDENCE: "Available as the case record accumulates.",
  };

  return (Object.keys(TITLES) as RenewalTaskCode[]).map((code, index) => {
    let state: RenewalTaskState = completed[code] ? "COMPLETED" : "FUTURE";
    if (code === activeTask) state = blockedActive ? "BLOCKED" : "CURRENT";
    if (code === "SERVE_NOTICE" && pendingServiceEvidence) state = "BLOCKED";
    return {
      code,
      number: index + 1,
      title: TITLES[code],
      state,
      summary: summaries[code],
      prerequisite: state === "FUTURE" ? prerequisites[code] : undefined,
      receipt: facts.receipts?.[code],
    };
  });
}

const TASK_EVIDENCE: Record<RenewalTaskCode, EvidenceType[]> = {
  ASSESS_SOURCE: ["INDEX_CAPTURED"],
  OPEN_CASE: ["RENEWAL_ASSESSMENT_CREATED"],
  SERVE_NOTICE: ["NOTICE_SERVED", "NOTICE_APPROVED", "NOTICE_GENERATED"],
  PROVE_SERVICE: ["NOTICE_SERVED", "NOTICE_SERVICE_RECORDED"],
  PROPOSE_TERMS: ["OFFER_PROPOSED"],
  SEND_TERMS: [],
  RECORD_RESPONSE: ["OFFER_ACCEPTED", "OFFER_COUNTERED", "TENANT_ACKNOWLEDGED"],
  COMPLETE_RENEWAL: ["RENEWAL_COMPLETED"],
  REVIEW_EVIDENCE: ["EVIDENCE_PACK_EXPORTED"],
};

const RENEWAL_EVIDENCE = new Set<EvidenceType>([
  "RENEWAL_ASSESSMENT_CREATED",
  "RENEWAL_COMPLETED",
  "INDEX_CAPTURED",
  "NOTICE_GENERATED",
  "NOTICE_APPROVED",
  "NOTICE_SERVICE_RECORDED",
  "NOTICE_SERVED",
  "OFFER_PROPOSED",
  "OFFER_COUNTERED",
  "OFFER_ACCEPTED",
  "TENANT_ACKNOWLEDGED",
  "APPROVAL_REQUESTED",
  "APPROVAL_GRANTED",
  "APPROVAL_REJECTED",
  "PARTNER_CASE_ASSIGNED",
  "PARTNER_TASK_COMPLETED",
  "EVIDENCE_PACK_EXPORTED",
]);

export async function getRenewalWorkspace(ctx: AuthzContext, tenancyId: string) {
  const risk = await getRenewalRisk(ctx, tenancyId);
  const canReadEvidence = hasCapability(ctx, "evidence.read");
  const events = canReadEvidence
    ? (await listEvidenceForTenancy(ctx, tenancyId)).filter((event) => RENEWAL_EVIDENCE.has(event.type))
    : [];
  const receipts: Partial<Record<RenewalTaskCode, RenewalTaskReceipt>> = {};

  for (const code of Object.keys(TASK_EVIDENCE) as RenewalTaskCode[]) {
    const event = [...events].reverse().find((candidate) => TASK_EVIDENCE[code].includes(candidate.type));
    if (event) {
      receipts[code] = {
        label: EVIDENCE_LABELS[event.type] ?? event.type.replace(/_/g, " ").toLowerCase(),
        at: event.createdAt,
        actorType: event.actorType,
        eventId: event.id,
      };
    }
  }

  if (!receipts.ASSESS_SOURCE && risk.latestIndex) {
    receipts.ASSESS_SOURCE = { label: risk.latestIndex.source, at: risk.latestIndex.capturedAt };
  }
  if (!receipts.OPEN_CASE && risk.renewalCase) {
    receipts.OPEN_CASE = { label: "Renewal case opened", at: risk.renewalCase.createdAt };
  }
  if (!receipts.SERVE_NOTICE && risk.currentNotice?.servedAt) {
    receipts.SERVE_NOTICE = { label: "Notice served with proof", at: risk.currentNotice.servedAt };
  }
  const deliveredOffer = [...risk.offers].reverse().find((offer) => offer.sentToTenantAt);
  if (!receipts.SEND_TERMS && deliveredOffer?.sentToTenantAt) {
    receipts.SEND_TERMS = { label: `Offer v${deliveredOffer.version} sent to tenant`, at: deliveredOffer.sentToTenantAt };
  }

  const successorId = risk.renewalCase?.renewedTenancyId ?? null;
  const successor = successorId
    // scope-audit: successor id comes from getRenewalRisk's scoped case; the workspace predicate is a second fail-closed guard.
    ? await prisma.tenancy.findFirst({
        where: { id: successorId, workspaceId: ctx.workspaceId },
        select: { id: true, startDate: true, endDate: true, annualRent: true, createdAt: true },
      })
    : null;

  const tasks = deriveRenewalTaskPath({
    nextActionCode: risk.nextAction.code,
    indexCapturedAt: risk.latestIndex?.capturedAt ?? null,
    indexProvisional: risk.latestIndex?.provisional ?? false,
    caseOpenedAt: risk.renewalCase?.createdAt ?? null,
    notice: risk.currentNotice,
    offers: risk.offers,
    renewedAt: successor?.createdAt ?? null,
    receipts,
  });

  return {
    risk,
    tasks,
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      label: EVIDENCE_LABELS[event.type] ?? event.type.replace(/_/g, " ").toLowerCase(),
      actorType: event.actorType,
      createdAt: event.createdAt,
      scopeType: event.scopeType,
      scopeId: event.scopeId,
    })),
    successor: successor
      ? { ...successor, annualRent: Number(successor.annualRent), href: `/renewals/${successor.id}` }
      : null,
    capabilities: {
      canWrite: hasCapability(ctx, "renewals.write"),
      canDecide: hasCapability(ctx, "renewals.decide"),
      canReadEvidence,
      canExportEvidence: hasCapability(ctx, "evidence.export"),
    },
  };
}
