import { describe, expect, it } from "vitest";
import { deriveRenewalNextAction, type RenewalNextActionInput } from "@/server/services/renewalNextAction";

const base: RenewalNextActionInput = {
  tenancyId: "tenancy-1",
  noticeGateAt: new Date("2026-09-01T00:00:00.000Z"),
  daysToGate: 45,
  gatePassed: false,
  hasIndex: true,
  provisionalIndex: false,
  caseStatus: "NEGOTIATING",
  noticeStatus: "SERVED",
  currentOffer: null,
  hasAcceptedOffer: false,
  renewedTenancyId: null,
};

function action(overrides: Partial<RenewalNextActionInput> = {}) {
  return deriveRenewalNextAction({ ...base, ...overrides });
}

describe("deriveRenewalNextAction", () => {
  it("routes missing and provisional index sources before workflow actions", () => {
    expect(action({ hasIndex: false, caseStatus: null, noticeStatus: null }).code).toBe("CAPTURE_INDEX");
    expect(action({ provisionalIndex: true, caseStatus: null, noticeStatus: null }).code).toBe("VERIFY_INDEX_SOURCE");
  });

  it("opens a case only after a reviewed source exists", () => {
    expect(action({ caseStatus: null, noticeStatus: null }).code).toBe("OPEN_CASE");
  });

  it("keeps recorded service pending until evidence is attached", () => {
    expect(action({ noticeStatus: "SERVICE_RECORDED_PENDING_EVIDENCE" }).code).toBe("ADD_SERVICE_EVIDENCE");
    const afterGate = action({ noticeStatus: "SERVICE_RECORDED_PENDING_EVIDENCE", gatePassed: true, daysToGate: -1 });
    expect(afterGate.code).toBe("ADD_SERVICE_EVIDENCE");
    expect(afterGate.urgency).toBe("CRITICAL");
  });

  it("requires a served notice before proposal work", () => {
    expect(action({ noticeStatus: "GENERATED" }).code).toBe("SERVE_NOTICE");
    expect(action().code).toBe("PREPARE_TERMS");
  });

  it("distinguishes prepared, delivered, and countered offers", () => {
    expect(
      action({ currentOffer: { party: "LANDLORD", status: "SENT", sentToTenant: false } }).code,
    ).toBe("SEND_OFFER");
    expect(
      action({ currentOffer: { party: "LANDLORD", status: "SENT", sentToTenant: true } }).code,
    ).toBe("AWAIT_TENANT");
    expect(
      action({ currentOffer: { party: "TENANT", status: "COUNTERED", sentToTenant: false } }).code,
    ).toBe("REVIEW_COUNTER");
  });

  it("routes accepted terms to completion", () => {
    expect(action({ hasAcceptedOffer: true }).code).toBe("COMPLETE_RENEWAL");
    expect(action({ caseStatus: "AGREED" }).code).toBe("COMPLETE_RENEWAL");
  });

  it("makes a passed unserved gate critical and review-led", () => {
    const result = action({ gatePassed: true, daysToGate: -1, noticeStatus: null });
    expect(result.code).toBe("REVIEW_CASE");
    expect(result.urgency).toBe("CRITICAL");
  });

  it("marks completed and declined cases as non-active", () => {
    expect(action({ caseStatus: "RENEWED", renewedTenancyId: "tenancy-2" }).code).toBe("REVIEW_COMPLETED_CASE");
    expect(action({ caseStatus: "DECLINED" }).code).toBe("NO_ACTION");
  });

  it("uses one canonical tenancy workspace link", () => {
    expect(action().href).toBe("/renewals/tenancy-1?view=case");
  });
});
