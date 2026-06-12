// Deterministic date calculators (T3.1). Calculators decide; results carry
// { rule, version, inputs } so every Deadline row can cite its math.
//
// Date-only semantics: tenancy dates are stored as UTC midnight. All business
// reasoning happens in Asia/Dubai (UTC+4, no DST), so calendar-day arithmetic
// on the UTC-midnight representation is exact and DST-irrelevant. Display
// formatting converts to Asia/Dubai (see formatDubaiDate).

export const DUBAI_TZ = "Asia/Dubai";

export interface CalcResult {
  date: Date; // UTC midnight of the resulting calendar day
  rule: string;
  version: string;
  inputs: Record<string, unknown>;
}

/** Normalize any Date to UTC midnight of its calendar day (date-only). */
export function toUtcDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDaysUtc(d: Date, days: number): Date {
  const r = toUtcDateOnly(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

/**
 * Notice gate: last day to serve notice = endDate − noticePeriodDays.
 * Default notice period is 90 days; contracts may override (fixture 2: 60).
 */
export function noticeGate(endDate: Date, noticePeriodDays: number): CalcResult {
  if (!Number.isInteger(noticePeriodDays) || noticePeriodDays <= 0) {
    throw new Error(`noticePeriodDays must be a positive integer, got ${noticePeriodDays}`);
  }
  const end = toUtcDateOnly(endDate);
  return {
    date: addDaysUtc(end, -noticePeriodDays),
    rule: "notice_gate",
    version: "v1",
    inputs: { endDate: isoDate(end), noticePeriodDays },
  };
}

/** Renewal date: the day after the contract ends (end + 1). */
export function renewalDate(endDate: Date): CalcResult {
  const end = toUtcDateOnly(endDate);
  return {
    date: addDaysUtc(end, 1),
    rule: "renewal_date",
    version: "v1",
    inputs: { endDate: isoDate(end) },
  };
}

/** Contract expiry deadline is the end date itself. */
export function contractExpiry(endDate: Date): CalcResult {
  const end = toUtcDateOnly(endDate);
  return {
    date: end,
    rule: "contract_expiry",
    version: "v1",
    inputs: { endDate: isoDate(end) },
  };
}

/** Cheque due deadline is the payment item's due date. */
export function chequeDue(dueDate: Date): CalcResult {
  const due = toUtcDateOnly(dueDate);
  return {
    date: due,
    rule: "cheque_due",
    version: "v1",
    inputs: { dueDate: isoDate(due) },
  };
}

/** ISO yyyy-mm-dd of a UTC-midnight date. */
export function isoDate(d: Date): string {
  return toUtcDateOnly(d).toISOString().slice(0, 10);
}

/** Today as a UTC-midnight date-only value, computed in Asia/Dubai. */
export function todayInDubai(now: Date = new Date()): Date {
  // Dubai is fixed UTC+4: shifting the instant by +4h then truncating gives the
  // Dubai calendar day without a timezone database.
  const shifted = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  return toUtcDateOnly(shifted);
}

/** Display formatting in Dubai local convention (dd MMM yyyy). */
export function formatDubaiDate(d: Date): string {
  return toUtcDateOnly(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Whole calendar days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: Date, to: Date): number {
  const ms = toUtcDateOnly(to).getTime() - toUtcDateOnly(from).getTime();
  return Math.round(ms / 86_400_000);
}
