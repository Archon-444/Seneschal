import type { NoticeStatus, OfferParty, OfferStatus, RenewalStatus } from "@prisma/client";

export type RenewalNextActionCode =
  | "CAPTURE_INDEX"
  | "VERIFY_INDEX_SOURCE"
  | "OPEN_CASE"
  | "SERVE_NOTICE"
  | "ADD_SERVICE_EVIDENCE"
  | "PREPARE_TERMS"
  | "SEND_OFFER"
  | "AWAIT_TENANT"
  | "REVIEW_COUNTER"
  | "COMPLETE_RENEWAL"
  | "REVIEW_COMPLETED_CASE"
  | "REVIEW_CASE"
  | "NO_ACTION";

export type RenewalUrgency = "CRITICAL" | "WARN" | "NORMAL" | "NONE";

export interface RenewalNextAction {
  code: RenewalNextActionCode;
  label: string;
  reason: string;
  urgency: RenewalUrgency;
  dueAt?: Date;
  href: string;
  responsibleLayer?: string;
}

export interface RenewalNextActionInput {
  tenancyId: string;
  noticeGateAt: Date;
  daysToGate: number;
  gatePassed: boolean;
  hasIndex: boolean;
  provisionalIndex: boolean;
  caseStatus: RenewalStatus | null;
  noticeStatus: NoticeStatus | null;
  currentOffer: {
    party: OfferParty;
    status: OfferStatus;
    sentToTenant: boolean;
  } | null;
  hasAcceptedOffer: boolean;
  renewedTenancyId?: string | null;
}

function gateUrgency(daysToGate: number): RenewalUrgency {
  if (daysToGate <= 14) return "CRITICAL";
  if (daysToGate <= 30) return "WARN";
  return "NORMAL";
}

export function deriveRenewalNextAction(input: RenewalNextActionInput): RenewalNextAction {
  const href = `/renewals/${input.tenancyId}?view=case`;
  const base = {
    href,
    dueAt: input.noticeGateAt,
    urgency: gateUrgency(input.daysToGate),
  } as const;

  if (input.renewedTenancyId || input.caseStatus === "RENEWED") {
    return {
      ...base,
      code: "REVIEW_COMPLETED_CASE",
      label: "Review completed renewal",
      reason: "The successor tenancy and renewal completion record are available.",
      urgency: "NONE",
      dueAt: undefined,
      responsibleLayer: "Fiduciary oversight",
    };
  }
  if (input.caseStatus === "DECLINED") {
    return {
      ...base,
      code: "NO_ACTION",
      label: "No renewal action",
      reason: "The renewal case was declined. Review the record if circumstances change.",
      urgency: "NONE",
      dueAt: undefined,
      responsibleLayer: "Fiduciary oversight",
    };
  }
  if (input.caseStatus === "LAPSED") {
    return {
      ...base,
      code: "REVIEW_CASE",
      label: "Review lapsed notice position",
      reason: "The recorded notice gate has passed without a served notice on file.",
      urgency: "CRITICAL",
      responsibleLayer: "Fiduciary decision",
    };
  }
  if (input.noticeStatus === "SERVICE_RECORDED_PENDING_EVIDENCE") {
    return {
      ...base,
      code: "ADD_SERVICE_EVIDENCE",
      label: "Add service evidence",
      reason: "Service was recorded but is not treated as served until proof is attached.",
      responsibleLayer: "Decision-authorized fiduciary or manager",
    };
  }
  if (input.gatePassed && input.noticeStatus !== "SERVED") {
    return {
      ...base,
      code: "REVIEW_CASE",
      label: "Review lapsed notice position",
      reason: "The recorded notice gate has passed without a served notice on file.",
      urgency: "CRITICAL",
      responsibleLayer: "Fiduciary decision",
    };
  }
  if (!input.hasIndex) {
    return {
      ...base,
      code: "CAPTURE_INDEX",
      label: "Capture index source",
      reason: "No index source is available for the renewal assessment.",
      responsibleLayer: "Authorized renewal operator",
    };
  }
  if (input.provisionalIndex) {
    return {
      ...base,
      code: "VERIFY_INDEX_SOURCE",
      label: "Verify index source",
      reason: "The calculation uses a provisional concierge figure awaiting verification.",
      responsibleLayer: "Authorized renewal operator",
    };
  }
  if (!input.caseStatus) {
    return {
      ...base,
      code: "OPEN_CASE",
      label: "Open renewal case",
      reason: "The source is captured but no renewal case has been opened.",
      responsibleLayer: "Authorized renewal operator",
    };
  }
  if (!input.noticeStatus || input.noticeStatus === "GENERATED" || input.noticeStatus === "APPROVED") {
    return {
      ...base,
      code: "SERVE_NOTICE",
      label: "Serve notice with proof",
      reason: "No served notice with supporting evidence is on file.",
      responsibleLayer: "Decision-authorized fiduciary or manager",
    };
  }
  if (input.noticeStatus === "WITHDRAWN") {
    return {
      ...base,
      code: "REVIEW_CASE",
      label: "Review withdrawn notice",
      reason: "The current notice was withdrawn; confirm the intended next step.",
      urgency: "WARN",
      responsibleLayer: "Fiduciary decision",
    };
  }
  if (input.hasAcceptedOffer || input.caseStatus === "AGREED") {
    return {
      ...base,
      code: "COMPLETE_RENEWAL",
      label: "Complete renewal",
      reason: "Terms are accepted; create the successor tenancy and completion record.",
      urgency: "NORMAL",
      responsibleLayer: "Decision-authorized fiduciary or manager",
    };
  }
  if (!input.currentOffer) {
    return {
      ...base,
      code: "PREPARE_TERMS",
      label: "Prepare renewal terms",
      reason: "The notice is served and no proposal is currently on the table.",
      urgency: "NORMAL",
      responsibleLayer: "Authorized renewal operator",
    };
  }
  if (input.currentOffer.party === "TENANT" && input.currentOffer.status === "COUNTERED") {
    return {
      ...base,
      code: "REVIEW_COUNTER",
      label: "Review tenant counter",
      reason: "The tenant returned revised terms that require a recorded decision.",
      urgency: "WARN",
      responsibleLayer: "Fiduciary decision",
    };
  }
  if (input.currentOffer.party === "LANDLORD" && input.currentOffer.status === "SENT") {
    if (!input.currentOffer.sentToTenant) {
      return {
        ...base,
        code: "SEND_OFFER",
        label: "Send proposal to tenant",
        reason: "Landlord terms are prepared but no tenant delivery link is recorded.",
        urgency: "NORMAL",
        responsibleLayer: "Authorized renewal operator",
      };
    }
    return {
      ...base,
      code: "AWAIT_TENANT",
      label: "Await tenant response",
      reason: "The current proposal was sent and remains open for the tenant.",
      urgency: "NORMAL",
      responsibleLayer: "Tenant",
    };
  }
  return {
    ...base,
    code: "REVIEW_CASE",
    label: "Review renewal case",
    reason: "The persisted records do not map to a safe automatic next action.",
    urgency: "WARN",
    responsibleLayer: "Fiduciary oversight",
  };
}
