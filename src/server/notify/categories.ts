import type { NotificationCategory } from "@prisma/client";

// Pure templateCode → category map (no Prisma). Every templateCode routed through
// `recordNotification` must resolve here; the digest/feed group on `category`.
// `urgent` is NOT derived here — it depends on runtime data (the ladder rung, a
// cheque's status, a flag's severity) and is passed explicitly by the caller.

const TEMPLATE_CATEGORY: Record<string, NotificationCategory> = {
  notice_gate_v1: "DEADLINES",
  cheque_v1: "DEADLINES",
  payment_late_v1: "PAYMENTS",
  payment_bounced_v1: "PAYMENTS",
  risk_flag_v1: "RISK",
  daily_digest_v1: "DIGEST",
  weekly_digest_v1: "DIGEST",
};

export function categoryForTemplate(templateCode: string): NotificationCategory | null {
  return TEMPLATE_CATEGORY[templateCode] ?? null;
}
