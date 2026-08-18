import { EvidenceType, type ActorType, type Prisma, type ScopeType } from "@prisma/client";

export const APPROVED_EVIDENCE_TYPES = Object.values(EvidenceType);

export type EvidenceCategory =
  | "renewals"
  | "payments"
  | "proofs"
  | "documents"
  | "maintenance"
  | "approvals"
  | "reports"
  | "risk"
  | "communications"
  | "other";

export const EVIDENCE_CATEGORIES: { value: EvidenceCategory; label: string }[] = [
  { value: "renewals", label: "Renewals" },
  { value: "payments", label: "Payments" },
  { value: "proofs", label: "Proof requests" },
  { value: "documents", label: "Documents & imports" },
  { value: "maintenance", label: "Maintenance" },
  { value: "approvals", label: "Approvals & tasks" },
  { value: "reports", label: "Reports & exports" },
  { value: "risk", label: "Risk" },
  { value: "communications", label: "Communications" },
  { value: "other", label: "Other records" },
];

const CATEGORY_TYPES: Record<EvidenceCategory, EvidenceType[]> = {
  renewals: [
    "RENEWAL_ASSESSMENT_CREATED", "RENEWAL_COMPLETED", "INDEX_CAPTURED", "NOTICE_GENERATED",
    "NOTICE_APPROVED", "NOTICE_SERVICE_RECORDED", "NOTICE_SERVED", "OFFER_PROPOSED", "OFFER_COUNTERED",
    "OFFER_ACCEPTED", "TENANT_ACKNOWLEDGED", "PARTNER_CASE_ASSIGNED", "PARTNER_TASK_COMPLETED",
  ],
  payments: ["CHEQUE_DUE", "CHEQUE_RECEIVED", "CHEQUE_DEPOSITED", "CHEQUE_CLEARED", "CHEQUE_BOUNCED", "DEPOSIT_RECEIPT_VIEWED"],
  proofs: ["PROOF_REQUESTED", "PROOF_UPLOADED", "PROOF_APPROVED", "PROOF_REJECTED"],
  documents: ["DOCUMENT_UPLOADED", "DOCUMENT_VIEWED", "FIELD_EXTRACTED", "FIELD_CONFIRMED", "FIELD_CORRECTED", "IMPORT_COMMITTED", "IMPORT_ROLLED_BACK"],
  maintenance: ["MAINTENANCE_REPORTED", "MAINTENANCE_QUOTE_UPLOADED", "MAINTENANCE_APPROVED", "MAINTENANCE_COMPLETED", "TENANT_CONFIRMED"],
  approvals: ["TASK_ASSIGNED", "TASK_COMPLETED", "APPROVAL_REQUESTED", "APPROVAL_GRANTED", "APPROVAL_REJECTED"],
  reports: ["REPORT_GENERATED", "REPORT_EXPORTED", "EVIDENCE_PACK_EXPORTED"],
  risk: ["RISK_FLAG_RAISED", "RISK_FLAG_CLEARED"],
  communications: ["REMINDER_SENT", "MESSAGE_RECEIVED", "WHATSAPP_DELIVERY_STATUS", "CONSENT_GRANTED", "CONSENT_REVOKED"],
  other: [
    "LISTING_CREATED", "LISTING_UPDATED", "LISTING_PUBLISHED", "LISTING_ARCHIVED", "LISTING_VIEWED",
    "LANDLORD_VERIFIED", "PASSPORT_SHARED", "PASSPORT_VIEWED", "ENQUIRY_RECEIVED", "VIEWING_SCHEDULED",
    "VIEWING_COMPLETED", "CONTRACT_PACK_GENERATED", "CONTRACT_PACK_SENT", "CONTRACT_PACK_SIGNED",
    "MOVEIN_ACKNOWLEDGED", "MOVEIN_COMPLETED",
  ],
};

export function evidenceTypesForCategory(category?: string): EvidenceType[] | undefined {
  return category && category in CATEGORY_TYPES ? CATEGORY_TYPES[category as EvidenceCategory] : undefined;
}

export interface EvidenceEventForPresentation {
  id: string;
  type: string;
  actorType: ActorType;
  actorId: string | null;
  onBehalfOfId: string | null;
  scopeType: ScopeType;
  scopeId: string | null;
  propertyId: string | null;
  tenancyId: string | null;
  payload: Prisma.JsonValue | null;
  payloadHash: string | null;
  supersedesId: string | null;
  createdAt: Date;
}

export interface EvidencePresentationContext {
  actorLabel?: string;
  onBehalfOfLabel?: string;
  scopeLabel?: string;
  scopeHref?: string | null;
  relatedLinks?: { label: string; href?: string; detail?: string }[];
  correctedBy?: { id: string; title: string }[];
  supersedesTitle?: string;
  unavailableRelatedRecord?: boolean;
}

export interface PresentedEvidenceEvent {
  id: string;
  title: string;
  summary: string;
  occurredAt: Date;
  actorLabel: string;
  onBehalfOfLabel: string | null;
  scopeLabel: string;
  scopeHref: string | null;
  relatedLinks: { label: string; href?: string; detail?: string }[];
  provenance: string[];
  correctionState: { kind: "CORRECTION_TO" | "CORRECTED_BY"; label: string; eventIds: string[] }[];
  technicalDetails: Record<string, unknown>;
  fallback: boolean;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled evidence type: ${String(value)}`);
}

export function titleForEvidenceType(type: EvidenceType): string {
  switch (type) {
    case "DOCUMENT_UPLOADED": return "Document uploaded";
    case "DOCUMENT_VIEWED": return "Document accessed";
    case "FIELD_EXTRACTED": return "Fields proposed from a document";
    case "FIELD_CONFIRMED": return "Extracted fields confirmed";
    case "FIELD_CORRECTED": return "Recorded field corrected";
    case "IMPORT_COMMITTED": return "Import committed to trusted records";
    case "IMPORT_ROLLED_BACK": return "Import rolled back";
    case "REMINDER_SENT": return "Reminder sent";
    case "MESSAGE_RECEIVED": return "Message received";
    case "WHATSAPP_DELIVERY_STATUS": return "WhatsApp delivery status recorded";
    case "TASK_ASSIGNED": return "Task assigned";
    case "TASK_COMPLETED": return "Task completed";
    case "PROOF_REQUESTED": return "Proof requested";
    case "PROOF_UPLOADED": return "Proof uploaded";
    case "PROOF_APPROVED": return "Proof request completed";
    case "PROOF_REJECTED": return "Proof rejected for review";
    case "CHEQUE_DUE": return "Cheque due date recorded";
    case "CHEQUE_RECEIVED": return "Cheque recorded as received";
    case "CHEQUE_DEPOSITED": return "Cheque recorded as deposited";
    case "CHEQUE_CLEARED": return "Cheque recorded as cleared";
    case "CHEQUE_BOUNCED": return "Payment status recorded as bounced";
    case "MAINTENANCE_REPORTED": return "Maintenance issue reported";
    case "MAINTENANCE_QUOTE_UPLOADED": return "Maintenance quote uploaded";
    case "MAINTENANCE_APPROVED": return "Maintenance work approved";
    case "MAINTENANCE_COMPLETED": return "Maintenance work recorded as completed";
    case "TENANT_CONFIRMED": return "Tenant confirmation recorded";
    case "APPROVAL_REQUESTED": return "Approval requested";
    case "APPROVAL_GRANTED": return "Approval granted";
    case "APPROVAL_REJECTED": return "Approval rejected";
    case "REPORT_GENERATED": return "Report generated";
    case "REPORT_EXPORTED": return "Report exported";
    case "EVIDENCE_PACK_EXPORTED": return "Evidence pack exported";
    case "RENEWAL_ASSESSMENT_CREATED": return "Renewal assessment created";
    case "RENEWAL_COMPLETED": return "Successor tenancy created";
    case "INDEX_CAPTURED": return "Smart Rental Index source captured";
    case "NOTICE_GENERATED": return "Change notice generated";
    case "NOTICE_APPROVED": return "Change notice approved";
    case "NOTICE_SERVICE_RECORDED": return "Notice service recorded — awaiting proof";
    case "NOTICE_SERVED": return "Change notice served with proof";
    case "OFFER_PROPOSED": return "Landlord renewal offer recorded";
    case "OFFER_COUNTERED": return "Tenant counter-offer recorded";
    case "OFFER_ACCEPTED": return "Tenant accepted renewal offer";
    case "TENANT_ACKNOWLEDGED": return "Tenant acknowledgement recorded";
    case "PARTNER_CASE_ASSIGNED": return "Partner case assigned";
    case "PARTNER_TASK_COMPLETED": return "Partner task recorded as completed";
    case "CONSENT_GRANTED": return "Consent granted";
    case "CONSENT_REVOKED": return "Consent revoked";
    case "RISK_FLAG_RAISED": return "Rule-based risk flag raised";
    case "RISK_FLAG_CLEARED": return "Rule-based risk flag cleared";
    case "LISTING_CREATED": return "Listing record created";
    case "LISTING_UPDATED": return "Listing record updated";
    case "LISTING_PUBLISHED": return "Listing recorded as published";
    case "LISTING_ARCHIVED": return "Listing archived";
    case "LISTING_VIEWED": return "Listing viewed";
    case "LANDLORD_VERIFIED": return "Landlord verification recorded";
    case "PASSPORT_SHARED": return "Tenant passport shared";
    case "PASSPORT_VIEWED": return "Tenant passport viewed";
    case "ENQUIRY_RECEIVED": return "Enquiry received";
    case "VIEWING_SCHEDULED": return "Viewing scheduled";
    case "VIEWING_COMPLETED": return "Viewing recorded as completed";
    case "CONTRACT_PACK_GENERATED": return "Contract pack generated";
    case "CONTRACT_PACK_SENT": return "Contract pack sent";
    case "CONTRACT_PACK_SIGNED": return "Contract pack recorded as signed";
    case "MOVEIN_ACKNOWLEDGED": return "Move-in acknowledgement recorded";
    case "MOVEIN_COMPLETED": return "Move-in recorded as completed";
    case "DEPOSIT_RECEIPT_VIEWED": return "Deposit receipt viewed";
    default: return assertNever(type);
  }
}

function record(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function text(payload: Record<string, Prisma.JsonValue>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : null;
}

function offerVersion(payload: Record<string, Prisma.JsonValue>): string {
  const version = text(payload, "version");
  return version ? ` v${version}` : "";
}

function humanSummary(type: EvidenceType, payload: Record<string, Prisma.JsonValue>, title: string): string {
  switch (type) {
    case "INDEX_CAPTURED": {
      const source = text(payload, "source") ?? text(payload, "indexSource") ?? "Source label unavailable";
      const amount = text(payload, "marketRentAvg");
      return `${source}${amount ? ` · recorded index average AED ${Number(amount).toLocaleString("en-AE")}` : ""}.`;
    }
    case "NOTICE_SERVED": {
      const method = text(payload, "serviceMethod")?.replace(/_/g, " ").toLowerCase();
      return `Notice service was recorded${method ? ` by ${method}` : ""} with supporting proof.`;
    }
    case "NOTICE_SERVICE_RECORDED":
      return "Service intent was recorded without supporting proof; the notice was not treated as served.";
    case "OFFER_PROPOSED":
    case "OFFER_COUNTERED":
    case "OFFER_ACCEPTED": {
      const rent = text(payload, "annualRent");
      return `${title}${offerVersion(payload)}${rent ? ` at AED ${Number(rent).toLocaleString("en-AE")}/yr` : ""}.`;
    }
    case "RENEWAL_COMPLETED":
      return "A successor tenancy was created and linked to the predecessor renewal record.";
    case "CHEQUE_BOUNCED":
      return "The payment item was recorded as bounced. This is a record of status, not fund movement.";
    case "FIELD_CORRECTED": {
      const field = text(payload, "field");
      return field ? `A correction to ${field} was appended without replacing the earlier event.` : "A correction was appended without replacing the earlier event.";
    }
    case "RISK_FLAG_RAISED":
    case "RISK_FLAG_CLEARED": {
      const code = text(payload, "code")?.replace(/_/g, " ").toLowerCase();
      return `Deterministic rule result recorded${code ? ` for ${code}` : ""}.`;
    }
    default:
      return `${title} was recorded in the append-only evidence ledger.`;
  }
}

function provenanceFrom(payload: Record<string, Prisma.JsonValue>): string[] {
  const keys: [string, string][] = [
    ["source", "Source"], ["indexSource", "Index source"], ["sourceRef", "Source reference"],
    ["calculatorVersion", "Calculator version"], ["ruleVersion", "Rule version"],
    ["templateCode", "Template"], ["serviceMethod", "Service method"], ["serviceRef", "Service reference"],
    ["documentId", "Document"], ["docId", "Document"], ["sha256", "Document hash"],
  ];
  return keys.flatMap(([key, label]) => {
    const value = payload[key];
    if (value == null) return [];
    if (typeof value === "object") return [`${label}: ${JSON.stringify(value)}`];
    return [`${label}: ${String(value)}`];
  });
}

function isKnownType(type: string): type is EvidenceType {
  return APPROVED_EVIDENCE_TYPES.includes(type as EvidenceType);
}

export function presentEvidenceEvent(
  event: EvidenceEventForPresentation,
  context: EvidencePresentationContext = {},
): PresentedEvidenceEvent {
  const knownType = isKnownType(event.type) ? event.type : null;
  const title = knownType ? titleForEvidenceType(knownType) : "Unrecognized evidence event";
  const payload = record(event.payload);
  const correctionState: PresentedEvidenceEvent["correctionState"] = [];
  if (event.supersedesId) {
    correctionState.push({
      kind: "CORRECTION_TO",
      label: `Correction to ${context.supersedesTitle ?? "an earlier event"}`,
      eventIds: [event.supersedesId],
    });
  }
  if (context.correctedBy?.length) {
    correctionState.push({
      kind: "CORRECTED_BY",
      label: `Corrected by ${context.correctedBy.map((item) => item.title).join(", ")}`,
      eventIds: context.correctedBy.map((item) => item.id),
    });
  }

  return {
    id: event.id,
    title,
    summary: knownType
      ? humanSummary(knownType, payload, title)
      : "A newer event type is present. Review the technical details; no meaning has been inferred.",
    occurredAt: event.createdAt,
    actorLabel: context.actorLabel ?? `${event.actorType.toLowerCase().replace(/_/g, " ")} actor${event.actorId ? "" : " (identity unavailable)"}`,
    onBehalfOfLabel: event.onBehalfOfId ? (context.onBehalfOfLabel ?? "Related principal unavailable") : null,
    scopeLabel: context.scopeLabel ?? (context.unavailableRelatedRecord ? "Related record unavailable" : event.scopeType.replace(/_/g, " ").toLowerCase()),
    scopeHref: context.scopeHref ?? null,
    relatedLinks: context.relatedLinks ?? [],
    provenance: provenanceFrom(payload),
    correctionState,
    technicalDetails: {
      eventId: event.id,
      type: event.type,
      storedUtc: event.createdAt.toISOString(),
      actorType: event.actorType,
      actorId: event.actorId,
      onBehalfOfId: event.onBehalfOfId,
      scopeType: event.scopeType,
      scopeId: event.scopeId,
      propertyId: event.propertyId,
      tenancyId: event.tenancyId,
      payloadHash: event.payloadHash,
      supersedesId: event.supersedesId,
      payload: event.payload,
    },
    fallback: !knownType,
  };
}
