import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as clients from "@/server/services/clients";
import * as properties from "@/server/services/properties";
import * as tenancies from "@/server/services/tenancies";
import { openRenewalCase } from "@/server/services/renewals";
import { confirmNoticeService, serveRenewalNotice } from "@/server/services/notice";

// PR-pilot P0-2 — a notice reaches SERVED only with real proof of service. Without
// a delivery reference, an uploaded document, or a signed attestation, the intent
// is held at SERVICE_RECORDED_PENDING_EVIDENCE: no NOTICE_SERVED evidence, no
// case/tenancy advance. confirmNoticeService is the only path that promotes a
// pending record to served once proof is attached.

let W: TestActor;
let tenancyId: string;

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Notice WS");
  const client = await clients.createClient(W.ctx, { displayName: "Notice Co" });
  const property = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id,
    community: "Downtown",
    unitNo: "1502",
  });
  const tenancy = await tenancies.createTenancy(W.ctx, {
    propertyId: property.id,
    startDate: daysFromNow(-305),
    endDate: daysFromNow(60),
    annualRent: 80_000,
  });
  tenancyId = tenancy.id;
});

describe("notice service evidence gate", () => {
  it("serving without proof records intent as pending and does NOT assert service", async () => {
    const rc = await openRenewalCase(W.ctx, tenancyId);
    const notice = await serveRenewalNotice(W.ctx, { renewalCaseId: rc.id, serviceMethod: "EMAIL" });

    expect(notice!.status).toBe("SERVICE_RECORDED_PENDING_EVIDENCE");
    // The honest, proof-pending evidence row — never NOTICE_SERVED.
    expect(
      await prisma.evidenceEvent.findFirst({ where: { type: "NOTICE_SERVICE_RECORDED", scopeId: rc.id } }),
    ).toBeTruthy();
    expect(
      await prisma.evidenceEvent.findFirst({ where: { type: "NOTICE_SERVED", scopeId: rc.id } }),
    ).toBeNull();
    // The case and tenancy must NOT have advanced on an unproven service.
    const reloaded = await prisma.renewalCase.findUnique({ where: { id: rc.id } });
    expect(reloaded!.status).not.toBe("NOTICE_SERVED");
    expect(reloaded!.noticeServedAt).toBeNull();
    expect((await prisma.tenancy.findUnique({ where: { id: tenancyId } }))!.status).not.toBe("NOTICE_SERVED");
  });

  it("confirmNoticeService promotes a pending record to SERVED with proof", async () => {
    const rc = await openRenewalCase(W.ctx, tenancyId);
    const pending = await serveRenewalNotice(W.ctx, { renewalCaseId: rc.id, serviceMethod: "COURIER" });
    expect(pending!.status).toBe("SERVICE_RECORDED_PENDING_EVIDENCE");

    const served = await confirmNoticeService(W.ctx, { noticeId: pending!.id, serviceRef: "tracking-9981" });
    expect(served!.status).toBe("SERVED");
    expect(served!.serviceRef).toBe("tracking-9981");
    expect(
      await prisma.evidenceEvent.findFirst({ where: { type: "NOTICE_SERVED", scopeId: rc.id } }),
    ).toBeTruthy();
    const reloaded = await prisma.renewalCase.findUnique({ where: { id: rc.id } });
    expect(reloaded!.status).toBe("NOTICE_SERVED");
    expect(reloaded!.noticeServedAt).toBeTruthy();
  });

  it("a delivery reference reaches SERVED directly", async () => {
    const rc = await openRenewalCase(W.ctx, tenancyId);
    const notice = await serveRenewalNotice(W.ctx, {
      renewalCaseId: rc.id,
      serviceMethod: "REGISTERED_POST",
      serviceRef: "RP-44120",
    });
    expect(notice!.status).toBe("SERVED");
  });

  it("a signed attestation reaches SERVED directly", async () => {
    const rc = await openRenewalCase(W.ctx, tenancyId);
    const notice = await serveRenewalNotice(W.ctx, {
      renewalCaseId: rc.id,
      serviceMethod: "IN_PERSON",
      attestation: "Manually attested as served by Farina",
    });
    expect(notice!.status).toBe("SERVED");
    expect(notice!.attestation).toContain("Farina");
    expect(notice!.attestedById).toBe(W.ctx.userId);
  });

  it("an uploaded service document reaches SERVED directly", async () => {
    const rc = await openRenewalCase(W.ctx, tenancyId);
    const doc = await prisma.document.create({
      data: {
        workspaceId: W.workspaceId,
        scopeType: "RENEWAL_CASE",
        scopeId: rc.id,
        kind: "NOTICE",
        fileName: "service-proof.pdf",
        mime: "application/pdf",
        sizeBytes: 10,
        storageKey: "test/service-proof.pdf",
        sha256: "deadbeef",
      },
    });
    const notice = await serveRenewalNotice(W.ctx, {
      renewalCaseId: rc.id,
      serviceMethod: "COURIER",
      docId: doc.id,
    });
    expect(notice!.status).toBe("SERVED");
    expect(notice!.docId).toBe(doc.id);
  });

  it("confirmNoticeService rejects when no proof is supplied", async () => {
    const rc = await openRenewalCase(W.ctx, tenancyId);
    const pending = await serveRenewalNotice(W.ctx, { renewalCaseId: rc.id, serviceMethod: "EMAIL" });
    await expect(confirmNoticeService(W.ctx, { noticeId: pending!.id })).rejects.toThrow(
      /delivery reference|document|attestation/,
    );
  });

  it("confirmNoticeService rejects a notice that is not pending evidence", async () => {
    const rc = await openRenewalCase(W.ctx, tenancyId);
    const served = await serveRenewalNotice(W.ctx, {
      renewalCaseId: rc.id,
      serviceMethod: "EMAIL",
      serviceRef: "already-served",
    });
    expect(served!.status).toBe("SERVED");
    await expect(
      confirmNoticeService(W.ctx, { noticeId: served!.id, serviceRef: "again" }),
    ).rejects.toThrow(/pending service evidence/);
  });
});
