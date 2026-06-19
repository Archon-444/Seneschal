import type { NotificationCategory } from "@prisma/client";

// Pure templateCode → category map (no Prisma). Every templateCode routed through
// `recordNotification` must resolve here; the digest/feed group on `category`.
// `urgent` is NOT derived here — it depends on runtime data (the ladder rung, a
// cheque's status, a flag's severity) and is passed explicitly by the caller.

const TEMPLATE_CATEGORY: Record<string, NotificationCategory> = {
  notice_gate_v1: "DEADLINES",
  cheque_v1: "DEADLINES",
  listing_permit_v1: "DEADLINES",
  payment_late_v1: "PAYMENTS",
  payment_bounced_v1: "PAYMENTS",
  risk_flag_v1: "RISK",
  enquiry_v1: "ENQUIRIES",
  daily_digest_v1: "DIGEST",
  weekly_digest_v1: "DIGEST",
};

export function categoryForTemplate(templateCode: string): NotificationCategory | null {
  return TEMPLATE_CATEGORY[templateCode] ?? null;
}

// ── Sensitive templates (T9.1 hardening). A sensitive template's body carries a secret
// (an OTP code) that must NEVER be persisted to NotificationMessage.bodyRef — which is
// insert-only, rendered in the recipient's feed, and rolled into digests — nor left at
// rest in a retained Outbox.payload. For these, notify() stores the placeholder below as
// bodyRef and rides the live body on the outbox payload to the adapter; the runner strips
// it once the send reaches a terminal state. Sensitivity is decided HERE, by template code,
// so no caller can forget a per-call flag (fail-closed). Keyed map (mirrors TEMPLATE_CATEGORY):
// the placeholder is what a feed/digest may safely show.
const SENSITIVE_TEMPLATE_PLACEHOLDER: Record<string, string> = {
  auth_otp_v1: "Your Seneschal sign-in code was sent to your email. It expires in 10 minutes.",
};

export function isSensitiveTemplate(templateCode: string | null | undefined): boolean {
  return templateCode != null && templateCode in SENSITIVE_TEMPLATE_PLACEHOLDER;
}

/** The non-secret stand-in stored as bodyRef for a sensitive template. */
export function redactedBodyFor(templateCode: string): string {
  return SENSITIVE_TEMPLATE_PLACEHOLDER[templateCode] ?? "[content delivered to your registered address]";
}
