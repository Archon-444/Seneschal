import { describe, expect, it } from "vitest";
import { deadlineNextAction } from "@/server/services/deadlines";

describe("deadlineNextAction", () => {
  it("deep-links renewal deadlines to the scoped tenancy workspace", () => {
    expect(
      deadlineNextAction({ kind: "NOTICE_GATE", tenancyId: "tenancy-1", propertyId: "property-1", computedFrom: null }),
    ).toMatchObject({ label: "Review renewal notice gate", href: "/renewals/tenancy-1" });
  });

  it("routes payment deadlines to the payment register", () => {
    expect(
      deadlineNextAction({ kind: "CHEQUE_DUE", tenancyId: "tenancy-1", propertyId: "property-1", computedFrom: null }),
    ).toMatchObject({ label: "Review payment register", href: "/payments" });
  });

  it("falls back to a scoped property for other deadlines", () => {
    expect(
      deadlineNextAction({ kind: "DOCUMENT_EXPIRY", tenancyId: null, propertyId: "property-1", computedFrom: null }),
    ).toMatchObject({ href: "/properties/property-1" });
  });
});
