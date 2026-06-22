import { describe, expect, it } from "vitest";
import { notificationHref } from "@/components/shell/notificationHref";

// A clicked notification deep-links to the most specific place that is always right for it: the
// related entity's detail page when one exists, else the feed category's list page, else nowhere.

describe("notificationHref", () => {
  it("routes a scoped entity with a detail page to that page", () => {
    expect(notificationHref({ relatedType: "PROOF_REQUEST", relatedId: "p1", category: "PROOFS" })).toBe("/proofs/p1");
    expect(notificationHref({ relatedType: "PROPERTY", relatedId: "x9", category: null })).toBe("/properties/x9");
  });

  it("falls back to the category list for scopes with no standalone detail page", () => {
    // A cheque alert is relatedType TENANCY but belongs on /payments, not a renewal page.
    expect(notificationHref({ relatedType: "TENANCY", relatedId: "t1", category: "PAYMENTS" })).toBe("/payments");
    expect(notificationHref({ relatedType: "OFFER", relatedId: "o1", category: "RENEWALS" })).toBe("/renewals");
    expect(notificationHref({ relatedType: "LISTING", relatedId: "l1", category: "ENQUIRIES" })).toBe("/enquiries");
  });

  it("routes by category alone when there is no related entity", () => {
    expect(notificationHref({ relatedType: null, relatedId: null, category: "RISK" })).toBe("/risk");
    expect(notificationHref({ relatedType: null, relatedId: null, category: "DEADLINES" })).toBe("/calendar");
  });

  it("needs BOTH relatedType and relatedId for a detail route", () => {
    // Missing id → cannot build a detail link, so use the category instead.
    expect(notificationHref({ relatedType: "PROOF_REQUEST", relatedId: null, category: "PROOFS" })).toBe("/proofs");
  });

  it("returns null when there is no sensible single target", () => {
    expect(notificationHref({ relatedType: null, relatedId: null, category: "DIGEST" })).toBeNull();
    expect(notificationHref({ relatedType: null, relatedId: null, category: null })).toBeNull();
  });
});
