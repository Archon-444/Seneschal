// Status → tone, extracted as a pure module (no JSX) so enum coverage can be
// unit-tested without importing the component tree. Semantics are consistent
// across every Badge-rendered enum (good=verde, in-progress/warn=amber,
// risk=claret, ended/void=muted, neutral=navy), so a single flat map is safe.
// Coverage of all Prisma status enums is enforced by tests/unit/badge-tones.test.ts.

const NEUTRAL = "bg-navy-50 text-navy-500";
const PROGRESS = "bg-amber-100 text-amber-700";
const GOOD = "bg-verde-100 text-verde-700";
const RISK = "bg-claret-100 text-claret-700";
const ENDED = "bg-ivory-200 text-muted";

export const BADGE_TONES: Record<string, string> = {
  // neutral / not-yet-started
  OPEN: NEUTRAL, PENDING: NEUTRAL, SCHEDULED: NEUTRAL, INFO: NEUTRAL,
  ACKNOWLEDGED: NEUTRAL, UPLOADED: NEUTRAL, NEW: NEUTRAL, GENERATED: NEUTRAL,
  DRAFT: NEUTRAL, ASSESSING: NEUTRAL, REPORTED: NEUTRAL,
  // in-progress / warn
  REQUESTED: PROGRESS, SENT: PROGRESS, SUBMITTED: PROGRESS, WAITING_PROOF: PROGRESS,
  EXTRACTED: PROGRESS, WARN: PROGRESS, RENEWAL_DUE: PROGRESS, NOTICE_DUE: PROGRESS,
  NOTICE_SERVED: PROGRESS, NEGOTIATING: PROGRESS, ENDING: PROGRESS, IN_PROGRESS: PROGRESS,
  REVIEWING: PROGRESS, MAPPED: PROGRESS, CONTACTED: PROGRESS, SENT_FOR_SIGNATURE: PROGRESS,
  AWAITING_APPROVAL: PROGRESS, PARTIALLY_ACKNOWLEDGED: PROGRESS, COUNTERED: PROGRESS,
  ASSIGNED: PROGRESS, QUOTE_REQUESTED: PROGRESS, QUOTE_RECEIVED: PROGRESS,
  SERVICE_RECORDED_PENDING_EVIDENCE: PROGRESS,
  // good / done
  RECEIVED: GOOD, DEPOSITED: GOOD, CLEARED: GOOD, APPROVED: GOOD, ACTIVE: GOOD,
  COMMITTED: GOOD, ACCEPTED: GOOD, RENEWED: GOOD, DONE: GOOD, CONFIRMED: GOOD,
  COMPLETED: GOOD, READY: GOOD, PUBLISHED: GOOD, SIGNED: GOOD, AGREED: GOOD,
  SERVED: GOOD, TENANT_CONFIRMED: GOOD,
  // risk / failure
  LATE: RISK, BOUNCED: RISK, REJECTED: RISK, OVERDUE: RISK, CONFLICT: RISK,
  ROLLED_BACK: RISK, CRITICAL: RISK, DISPUTED: RISK, MISSED: RISK, FAILED: RISK,
  NO_SHOW: RISK, DECLINED: RISK, LAPSED: RISK,
  // ended / void
  CANCELLED: ENDED, CLOSED: ENDED, ARCHIVED: ENDED, SUPERSEDED: ENDED, WITHDRAWN: ENDED,
};

// A few enum values are too long to read well as a pill; give them a short label.
export const BADGE_LABELS: Record<string, string> = {
  SERVICE_RECORDED_PENDING_EVIDENCE: "Service recorded · proof pending",
  PARTIALLY_ACKNOWLEDGED: "Partly acknowledged",
  SENT_FOR_SIGNATURE: "Sent for signature",
};

/** Tailwind tone classes for a status value, falling back to neutral. */
export function badgeTone(value: string): string {
  return BADGE_TONES[value] ?? NEUTRAL;
}
