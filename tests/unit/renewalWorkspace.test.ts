import { describe, expect, it } from "vitest";
import { deriveRenewalTaskPath, type RenewalTaskFacts } from "@/server/services/renewalWorkspace";
import type { OfferView } from "@/server/services/renewals";

const at = new Date("2026-08-18T08:00:00.000Z");

const base: RenewalTaskFacts = {
  nextActionCode: "CAPTURE_INDEX",
  indexCapturedAt: null,
  indexProvisional: false,
  caseOpenedAt: null,
  notice: null,
  offers: [],
  renewedAt: null,
};

function offer(overrides: Partial<OfferView> = {}): OfferView {
  return {
    id: "offer-1",
    version: 1,
    party: "LANDLORD",
    annualRent: 84_000,
    paymentSchedule: "4 cheques",
    paymentMethod: null,
    termMonths: 12,
    status: "SENT",
    note: null,
    createdAt: at,
    sentToTenant: false,
    sentToTenantAt: null,
    permittedMaxSnapshot: null,
    indexCitation: null,
    ...overrides,
  } as OfferView;
}

function path(overrides: Partial<RenewalTaskFacts> = {}) {
  return deriveRenewalTaskPath({ ...base, ...overrides });
}

function task(tasks: ReturnType<typeof path>, code: ReturnType<typeof path>[number]["code"]) {
  return tasks.find((candidate) => candidate.code === code)!;
}

describe("deriveRenewalTaskPath", () => {
  it("shows source capture as the only current task when no case exists", () => {
    const tasks = path();
    expect(task(tasks, "ASSESS_SOURCE").state).toBe("CURRENT");
    expect(tasks.filter((candidate) => candidate.state === "CURRENT")).toHaveLength(1);
    expect(task(tasks, "OPEN_CASE").state).toBe("FUTURE");
  });

  it("keeps a provisional source current rather than presenting it as completed proof", () => {
    const tasks = path({ nextActionCode: "VERIFY_INDEX_SOURCE", indexCapturedAt: at, indexProvisional: true });
    expect(task(tasks, "ASSESS_SOURCE").state).toBe("CURRENT");
    expect(task(tasks, "ASSESS_SOURCE").summary).toMatch(/provisional/i);
  });

  it("distinguishes service pending evidence from a served notice", () => {
    const pending = path({
      nextActionCode: "ADD_SERVICE_EVIDENCE",
      indexCapturedAt: at,
      caseOpenedAt: at,
      notice: {
        id: "notice-1",
        status: "SERVICE_RECORDED_PENDING_EVIDENCE",
        serviceMethod: "EMAIL",
        generatedAt: at,
        approvedAt: at,
        servedAt: null,
        docId: null,
        serviceRef: null,
        attestedAt: null,
      },
    });
    expect(task(pending, "SERVE_NOTICE").state).toBe("BLOCKED");
    expect(task(pending, "PROVE_SERVICE").state).toBe("CURRENT");

    const served = path({
      nextActionCode: "PREPARE_TERMS",
      indexCapturedAt: at,
      caseOpenedAt: at,
      notice: {
        id: "notice-1",
        status: "SERVED",
        serviceMethod: "EMAIL",
        generatedAt: at,
        approvedAt: at,
        servedAt: at,
        docId: null,
        serviceRef: "inbox-ref",
        attestedAt: null,
      },
    });
    expect(task(served, "SERVE_NOTICE").state).toBe("COMPLETED");
    expect(task(served, "PROVE_SERVICE").state).toBe("COMPLETED");
  });

  it("separates prepared terms from tenant delivery", () => {
    const prepared = path({ nextActionCode: "SEND_OFFER", indexCapturedAt: at, caseOpenedAt: at, offers: [offer()] });
    expect(task(prepared, "PROPOSE_TERMS").state).toBe("COMPLETED");
    expect(task(prepared, "SEND_TERMS").state).toBe("CURRENT");

    const sent = path({
      nextActionCode: "AWAIT_TENANT",
      indexCapturedAt: at,
      caseOpenedAt: at,
      offers: [offer({ sentToTenant: true, sentToTenantAt: at })],
    });
    expect(task(sent, "SEND_TERMS").state).toBe("COMPLETED");
    expect(task(sent, "RECORD_RESPONSE").state).toBe("BLOCKED");
  });

  it("makes completion current only after accepted terms", () => {
    const tasks = path({
      nextActionCode: "COMPLETE_RENEWAL",
      indexCapturedAt: at,
      caseOpenedAt: at,
      offers: [offer({ status: "ACCEPTED", sentToTenant: true, sentToTenantAt: at })],
    });
    expect(task(tasks, "RECORD_RESPONSE").state).toBe("COMPLETED");
    expect(task(tasks, "COMPLETE_RENEWAL").state).toBe("CURRENT");
  });

  it("keeps a recorded tenant counter current until a fiduciary decision is persisted", () => {
    const tasks = path({
      nextActionCode: "REVIEW_COUNTER",
      indexCapturedAt: at,
      caseOpenedAt: at,
      offers: [offer(), offer({ id: "offer-2", version: 2, party: "TENANT", status: "COUNTERED" })],
    });
    expect(task(tasks, "RECORD_RESPONSE").state).toBe("CURRENT");
    expect(task(tasks, "RECORD_RESPONSE").summary).toMatch(/requires a fiduciary decision/i);
  });

  it("closes the path with successor and evidence review", () => {
    const tasks = path({
      nextActionCode: "REVIEW_COMPLETED_CASE",
      indexCapturedAt: at,
      caseOpenedAt: at,
      offers: [offer({ status: "ACCEPTED", sentToTenant: true, sentToTenantAt: at })],
      renewedAt: at,
    });
    expect(task(tasks, "COMPLETE_RENEWAL").state).toBe("COMPLETED");
    expect(task(tasks, "REVIEW_EVIDENCE").state).toBe("CURRENT");
  });
});
