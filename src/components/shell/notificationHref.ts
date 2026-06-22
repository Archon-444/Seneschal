// Where a notification deep-links when clicked. We send it to the most specific place that is
// ALWAYS the right destination: the related entity's detail page when one exists, otherwise the
// feed category's list page. Returns null when there is no sensible single target (e.g. a digest
// summary), so the row stays non-clickable rather than dumping the user somewhere arbitrary.
//
// String-keyed (the values of Prisma's ScopeType / NotificationCategory enums) so this stays a pure
// helper importable by both the server-rendered page and the client bell, with no Prisma import.

// String-keyed (the values of Prisma's ScopeType / NotificationCategory enums) so this stays a pure
// helper importable by both the server-rendered page and the client bell. `isQuarantined` is a
// hardcoded constant module (edge/node/client safe), already on the client path via the nav.
import { isQuarantined } from "@/server/config/features";

// Scopes whose relatedId is that entity's id AND which have a detail route that is the right landing
// spot regardless of why the notification fired. TENANCY/OFFER/LISTING have no such standalone page,
// so they fall through to the category list below (e.g. a cheque alert → /payments, not a renewal).
const SCOPE_DETAIL: Record<string, (id: string) => string> = {
  PROOF_REQUEST: (id) => `/proofs/${id}`,
  PROPERTY: (id) => `/properties/${id}`,
  CLIENT: (id) => `/clients/${id}`,
  REPORT: (id) => `/reports/${id}`,
  IMPORT_BATCH: (id) => `/imports/${id}`,
};

const CATEGORY_LIST: Record<string, string> = {
  PAYMENTS: "/payments",
  RENEWALS: "/renewals",
  PROOFS: "/proofs",
  RISK: "/risk",
  DEADLINES: "/calendar",
  // ENQUIRIES → /enquiries only while the marketplace loop is live. It is quarantined (and the
  // /enquiries route is gated server-side), so routing there would make enquiry notifications dead
  // 404 links — they stay non-clickable until revival.
  ...(isQuarantined("listings") ? {} : { ENQUIRIES: "/enquiries" }),
  // DIGEST has no single target — it stays non-clickable.
};

export interface NotificationTarget {
  relatedType: string | null;
  relatedId: string | null;
  category: string | null;
}

export function notificationHref(item: NotificationTarget): string | null {
  if (item.relatedType && item.relatedId) {
    const detail = SCOPE_DETAIL[item.relatedType];
    if (detail) return detail(item.relatedId);
  }
  return item.category ? (CATEGORY_LIST[item.category] ?? null) : null;
}
