import { describe, expect, it } from "vitest";
import {
  chequeDue,
  contractExpiry,
  daysBetween,
  formatDubaiDate,
  isoDate,
  noticeGate,
  renewalDate,
  todayInDubai,
  toUtcDateOnly,
} from "@/server/calculators/dates";

// T3.1 — calculators decide. 100% coverage required.

describe("noticeGate", () => {
  it("computes the 90-day default gate (fixture 1: Marina)", () => {
    const r = noticeGate(new Date("2026-09-15"), 90);
    expect(isoDate(r.date)).toBe("2026-06-17");
    expect(r.rule).toBe("notice_gate");
    expect(r.version).toBe("v1");
    expect(r.inputs).toEqual({ endDate: "2026-09-15", noticePeriodDays: 90 });
  });

  it("honors the 60-day contract override (fixture 2: Bayview)", () => {
    const r = noticeGate(new Date("2026-10-31"), 60);
    expect(isoDate(r.date)).toBe("2026-09-01");
  });

  it("crosses month boundaries exactly", () => {
    expect(isoDate(noticeGate(new Date("2026-03-01"), 1).date)).toBe("2026-02-28");
    expect(isoDate(noticeGate(new Date("2026-01-31"), 31).date)).toBe("2025-12-31");
  });

  it("handles leap day arithmetic", () => {
    // 2028 is a leap year: 90 days before 2028-05-29 passes through Feb 29
    expect(isoDate(noticeGate(new Date("2028-05-29"), 90).date)).toBe("2028-02-29");
    expect(isoDate(noticeGate(new Date("2028-03-01"), 1).date)).toBe("2028-02-29");
    // non-leap year
    expect(isoDate(noticeGate(new Date("2027-03-01"), 1).date)).toBe("2027-02-28");
  });

  it("is DST-irrelevant: identical result regardless of instant-of-day", () => {
    const morning = noticeGate(new Date("2026-09-15T00:00:00Z"), 90);
    const night = noticeGate(new Date("2026-09-15T23:59:59Z"), 90);
    expect(isoDate(morning.date)).toBe(isoDate(night.date));
  });

  it("rejects non-positive or non-integer notice periods", () => {
    expect(() => noticeGate(new Date("2026-09-15"), 0)).toThrow();
    expect(() => noticeGate(new Date("2026-09-15"), -5)).toThrow();
    expect(() => noticeGate(new Date("2026-09-15"), 1.5)).toThrow();
  });
});

describe("renewalDate", () => {
  it("is end + 1 day (fixture 1)", () => {
    expect(isoDate(renewalDate(new Date("2026-09-15")).date)).toBe("2026-09-16");
  });
  it("rolls over month and year ends", () => {
    expect(isoDate(renewalDate(new Date("2026-10-31")).date)).toBe("2026-11-01");
    expect(isoDate(renewalDate(new Date("2026-12-31")).date)).toBe("2027-01-01");
    expect(isoDate(renewalDate(new Date("2028-02-28")).date)).toBe("2028-02-29");
  });
  it("carries rule citation", () => {
    const r = renewalDate(new Date("2026-09-15"));
    expect(r.rule).toBe("renewal_date");
    expect(r.inputs).toEqual({ endDate: "2026-09-15" });
  });
});

describe("contractExpiry / chequeDue", () => {
  it("expiry is the end date itself", () => {
    const r = contractExpiry(new Date("2026-09-15"));
    expect(isoDate(r.date)).toBe("2026-09-15");
    expect(r.rule).toBe("contract_expiry");
  });
  it("cheque due is the item due date", () => {
    const r = chequeDue(new Date("2026-06-16"));
    expect(isoDate(r.date)).toBe("2026-06-16");
    expect(r.rule).toBe("cheque_due");
  });
});

describe("date helpers", () => {
  it("toUtcDateOnly truncates to UTC midnight", () => {
    expect(toUtcDateOnly(new Date("2026-06-16T18:30:00Z")).toISOString()).toBe(
      "2026-06-16T00:00:00.000Z",
    );
  });
  it("todayInDubai shifts by +4h: 21:00Z is already tomorrow in Dubai", () => {
    expect(isoDate(todayInDubai(new Date("2026-06-16T21:00:00Z")))).toBe("2026-06-17");
    expect(isoDate(todayInDubai(new Date("2026-06-16T19:59:00Z")))).toBe("2026-06-16");
  });
  it("daysBetween counts whole calendar days, signed", () => {
    expect(daysBetween(new Date("2026-06-01"), new Date("2026-06-16"))).toBe(15);
    expect(daysBetween(new Date("2026-06-16"), new Date("2026-06-01"))).toBe(-15);
    expect(daysBetween(new Date("2026-06-16"), new Date("2026-06-16"))).toBe(0);
  });
  it("formats Dubai-local display", () => {
    expect(formatDubaiDate(new Date("2026-09-15"))).toBe("15 Sept 2026");
  });
});
