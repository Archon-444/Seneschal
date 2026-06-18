import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as clients from "@/server/services/clients";
import * as properties from "@/server/services/properties";
import * as tenancies from "@/server/services/tenancies";
import {
  acceptOffer,
  captureBenchmark,
  captureRentIndex,
  getOfferForLink,
  getRenewalRisk,
  listRenewalPipeline,
  openRenewalCase,
  proposeOffer,
  respondToOfferViaLink,
} from "@/server/services/renewals";
import { serveRenewalNotice } from "@/server/services/notice";
import { createSecureLink, validateLinkToken } from "@/server/services/secureLinks";

let W: TestActor;
let clientId: string;
let tenancyId: string;

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Renewals WS");
  const client = await clients.createClient(W.ctx, { displayName: "Al Noor" });
  clientId = client.id;
  const property = await properties.createProperty(W.ctx, {
    clientPrincipalId: clientId,
    community: "Dubai Marina",
    unitNo: "1204",
  });
  const tenancy = await tenancies.createTenancy(W.ctx, {
    propertyId: property.id,
    startDate: daysFromNow(-305),
    endDate: daysFromNow(60),
    annualRent: 72_000,
  });
  tenancyId = tenancy.id;
});

describe("renewal risk desk", () => {
  it("captures an index figure, records evidence, and computes the lawful position", async () => {
    await captureRentIndex(W.ctx, { tenancyId, marketRentAvg: 96_000 });

    const evidence = await prisma.evidenceEvent.findFirst({
      where: { type: "INDEX_CAPTURED", tenancyId },
    });
    expect(evidence).toBeTruthy();

    const risk = await getRenewalRisk(W.ctx, tenancyId);
    expect(risk.latestIndex?.marketRentAvg).toBe(96_000);
    expect(risk.position?.bandPct).toBe(10);
    expect(risk.position?.ceiling).toBe(79_200);
    expect(risk.position?.valueAtRisk).toBe(7_200);
  });

  it("getRenewalRisk has no position before any index is captured", async () => {
    const risk = await getRenewalRisk(W.ctx, tenancyId);
    expect(risk.latestIndex).toBeNull();
    expect(risk.position).toBeNull();
    expect(risk.expiresAt).toBeTruthy();
  });

  it("opens a renewal case once (idempotent) and records assessment evidence", async () => {
    const a = await openRenewalCase(W.ctx, tenancyId);
    const b = await openRenewalCase(W.ctx, tenancyId);
    expect(b.id).toBe(a.id);

    const cases = await prisma.renewalCase.count({ where: { tenancyId } });
    expect(cases).toBe(1);
    expect(
      await prisma.evidenceEvent.findFirst({ where: { type: "RENEWAL_ASSESSMENT_CREATED", tenancyId } }),
    ).toBeTruthy();
  });

  it("lists the tenancy in the pipeline with computed uplift", async () => {
    await captureRentIndex(W.ctx, { tenancyId, marketRentAvg: 96_000 });
    const rows = await listRenewalPipeline(W.ctx);
    const row = rows.find((r) => r.tenancyId === tenancyId);
    expect(row).toBeTruthy();
    expect(row!.valueAtRisk).toBe(7_200);
    expect(row!.ownerName).toBe("Al Noor");
    expect(Math.round(row!.gapPct! * 100)).toBe(25);
  });

  it("filters the pipeline to an explicit clientPrincipalId (fiduciary view)", async () => {
    const other = await clients.createClient(W.ctx, { displayName: "Other Co" });
    const otherProp = await properties.createProperty(W.ctx, {
      clientPrincipalId: other.id,
      community: "JVC",
      unitNo: "9",
    });
    const otherTenancy = await tenancies.createTenancy(W.ctx, {
      propertyId: otherProp.id,
      startDate: daysFromNow(-300),
      endDate: daysFromNow(40),
      annualRent: 48_000,
    });

    const ids = (await listRenewalPipeline(W.ctx, { clientPrincipalId: clientId })).map((r) => r.tenancyId);
    expect(ids).toContain(tenancyId);
    expect(ids).not.toContain(otherTenancy.id);
  });

  it("scopes the pipeline and report to a CLIENT_VIEWER's own client", async () => {
    // a second client + tenancy the viewer should never see
    const other = await clients.createClient(W.ctx, { displayName: "Other Co" });
    const otherProp = await properties.createProperty(W.ctx, {
      clientPrincipalId: other.id,
      community: "JVC",
      unitNo: "9",
    });
    const otherTenancy = await tenancies.createTenancy(W.ctx, {
      propertyId: otherProp.id,
      startDate: daysFromNow(-300),
      endDate: daysFromNow(40),
      annualRent: 48_000,
    });

    const viewer = await addMember(W.workspaceId, "CLIENT_VIEWER", clientId);
    const seen = (await listRenewalPipeline(viewer.ctx)).map((r) => r.tenancyId);
    expect(seen).toContain(tenancyId);
    expect(seen).not.toContain(otherTenancy.id);

    await expect(getRenewalRisk(viewer.ctx, otherTenancy.id)).rejects.toThrow();
  });

  it("rejects a tenancy from another workspace", async () => {
    const other = await makeWorkspace("Other WS", { type: "OWNER" });
    const p = await properties.createProperty(other.ctx, { community: "X", unitNo: "1" });
    const otherTenancy = await tenancies.createTenancy(other.ctx, {
      propertyId: p.id,
      startDate: daysFromNow(-300),
      endDate: daysFromNow(50),
      annualRent: 50_000,
    });
    await expect(getRenewalRisk(W.ctx, otherTenancy.id)).rejects.toThrow();
    await expect(captureRentIndex(W.ctx, { tenancyId: otherTenancy.id, marketRentAvg: 60_000 })).rejects.toThrow();
  });
});

describe("renewal negotiation", () => {
  it("versions proposals and counters, superseding the prior open offer", async () => {
    const rc = await openRenewalCase(W.ctx, tenancyId);
    const o1 = await proposeOffer(W.ctx, {
      renewalCaseId: rc.id,
      party: "LANDLORD",
      annualRent: 79_200,
      paymentSchedule: "4 cheques",
    });
    expect(o1.version).toBe(1);
    expect(await prisma.evidenceEvent.findFirst({ where: { type: "OFFER_PROPOSED", scopeId: o1.id } })).toBeTruthy();
    expect((await prisma.tenancy.findUnique({ where: { id: tenancyId } }))!.status).toBe("NEGOTIATING");

    const o2 = await proposeOffer(W.ctx, {
      renewalCaseId: rc.id,
      party: "TENANT",
      annualRent: 77_000,
      paymentSchedule: "2 cheques",
    });
    expect(o2.version).toBe(2);
    expect((await prisma.offer.findUnique({ where: { id: o1.id } }))!.status).toBe("SUPERSEDED");
    expect(await prisma.evidenceEvent.findFirst({ where: { type: "OFFER_COUNTERED", scopeId: o2.id } })).toBeTruthy();
  });

  it("accepting an offer agrees the case and renews the tenancy", async () => {
    const rc = await openRenewalCase(W.ctx, tenancyId);
    const o = await proposeOffer(W.ctx, {
      renewalCaseId: rc.id,
      party: "LANDLORD",
      annualRent: 79_200,
      paymentSchedule: "4 cheques",
    });
    await acceptOffer(W.ctx, o.id);

    const after = await prisma.renewalCase.findUnique({ where: { id: rc.id } });
    expect(after!.status).toBe("AGREED");
    expect(after!.decidedOfferId).toBe(o.id);
    expect((await prisma.offer.findUnique({ where: { id: o.id } }))!.status).toBe("ACCEPTED");
    expect((await prisma.tenancy.findUnique({ where: { id: tenancyId } }))!.status).toBe("RENEWED");
    expect(await prisma.evidenceEvent.findFirst({ where: { type: "OFFER_ACCEPTED", scopeId: o.id } })).toBeTruthy();

    const risk = await getRenewalRisk(W.ctx, tenancyId);
    expect(risk.offers).toHaveLength(1);
    expect(risk.renewalCase?.decidedOfferId).toBe(o.id);
  });

  it("serving notice records evidence and moves the case + tenancy", async () => {
    const rc = await openRenewalCase(W.ctx, tenancyId);
    await serveRenewalNotice(W.ctx, { renewalCaseId: rc.id });
    const after = await prisma.renewalCase.findUnique({ where: { id: rc.id } });
    expect(after!.status).toBe("NOTICE_SERVED");
    expect(after!.noticeServedAt).toBeTruthy();
    expect((await prisma.tenancy.findUnique({ where: { id: tenancyId } }))!.status).toBe("NOTICE_SERVED");
    expect(await prisma.evidenceEvent.findFirst({ where: { type: "NOTICE_SERVED", scopeId: rc.id } })).toBeTruthy();
  });

  it("requires renewals.decide to accept an offer", async () => {
    const rc = await openRenewalCase(W.ctx, tenancyId);
    const o = await proposeOffer(W.ctx, {
      renewalCaseId: rc.id,
      party: "LANDLORD",
      annualRent: 79_200,
      paymentSchedule: "4 cheques",
    });
    const agent = await addMember(W.workspaceId, "AGENT"); // read-only on renewals
    await expect(acceptOffer(agent.ctx, o.id)).rejects.toThrow();
  });
});

describe("tenant secure-response link", () => {
  async function landlordOffer() {
    const rc = await openRenewalCase(W.ctx, tenancyId);
    const offer = await proposeOffer(W.ctx, {
      renewalCaseId: rc.id,
      party: "LANDLORD",
      annualRent: 79_200,
      paymentSchedule: "4 cheques",
    });
    return { rc, offer };
  }

  it("lets a tenant counter via the link — a real versioned TENANT offer", async () => {
    const { rc, offer } = await landlordOffer();
    const { linkId } = await createSecureLink(W.ctx, { purpose: "TENANT_OFFER", scopeType: "OFFER", scopeId: offer.id });
    const link = await prisma.secureLink.findUnique({ where: { id: linkId } });

    const view = await getOfferForLink(link!);
    expect(view?.proposedRent).toBe(79_200);
    expect(view?.currentRent).toBe(72_000);

    await respondToOfferViaLink(link!, { action: "COUNTER", annualRent: 77_000, paymentSchedule: "2 cheques" });
    const offers = await prisma.offer.findMany({ where: { renewalCaseId: rc.id }, orderBy: { version: "asc" } });
    expect(offers).toHaveLength(2);
    expect(offers[1].party).toBe("TENANT");
    expect(offers[1].viaSecureLinkId).toBe(linkId);
    expect(offers[0].status).toBe("SUPERSEDED");
    expect(
      await prisma.evidenceEvent.findFirst({ where: { type: "OFFER_COUNTERED", actorType: "TENANT_LINK" } }),
    ).toBeTruthy();
    expect((await prisma.secureLink.findUnique({ where: { id: linkId } }))!.useCount).toBe(1);
  });

  it("lets a tenant accept via the link — case AGREED and tenancy RENEWED", async () => {
    const { rc, offer } = await landlordOffer();
    const { linkId } = await createSecureLink(W.ctx, { purpose: "TENANT_OFFER", scopeType: "OFFER", scopeId: offer.id });
    const link = await prisma.secureLink.findUnique({ where: { id: linkId } });

    await respondToOfferViaLink(link!, { action: "ACCEPT" });
    expect((await prisma.renewalCase.findUnique({ where: { id: rc.id } }))!.status).toBe("AGREED");
    expect((await prisma.tenancy.findUnique({ where: { id: tenancyId } }))!.status).toBe("RENEWED");
    expect(
      await prisma.evidenceEvent.findFirst({ where: { type: "OFFER_ACCEPTED", actorType: "TENANT_LINK" } }),
    ).toBeTruthy();
  });

  it("rejects an expired token and a wrong-purpose link", async () => {
    const { offer } = await landlordOffer();
    const { linkId, url } = await createSecureLink(W.ctx, { purpose: "TENANT_OFFER", scopeType: "OFFER", scopeId: offer.id });
    const token = url.split("/").pop()!;
    await prisma.secureLink.update({ where: { id: linkId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const v = await validateLinkToken(token);
    expect(v.ok).toBe(false);

    const { linkId: proofLinkId } = await createSecureLink(W.ctx, {
      purpose: "PROOF_UPLOAD",
      scopeType: "PROOF_REQUEST",
      scopeId: "nope",
    });
    const proofLink = await prisma.secureLink.findUnique({ where: { id: proofLinkId } });
    await expect(respondToOfferViaLink(proofLink!, { action: "ACCEPT" })).rejects.toThrow();
  });
});

describe("renewal index benchmark", () => {
  it("falls back to a community benchmark when the tenancy has no capture", async () => {
    await captureBenchmark(W.ctx, { community: "Dubai Marina", marketRentAvg: 96_000 });
    const risk = await getRenewalRisk(W.ctx, tenancyId);
    expect(risk.position?.valueAtRisk).toBe(7_200);
    expect(risk.latestIndex?.isBenchmark).toBe(true);
  });

  it("a tenancy-specific capture overrides the benchmark", async () => {
    await captureBenchmark(W.ctx, { community: "Dubai Marina", marketRentAvg: 200_000 });
    await captureRentIndex(W.ctx, { tenancyId, marketRentAvg: 96_000 });
    const risk = await getRenewalRisk(W.ctx, tenancyId);
    expect(risk.latestIndex?.marketRentAvg).toBe(96_000);
    expect(risk.latestIndex?.isBenchmark).toBe(false);
    expect(risk.position?.valueAtRisk).toBe(7_200);
  });

  it("a building-specific benchmark beats the community-wide one", async () => {
    const prop = await properties.createProperty(W.ctx, {
      clientPrincipalId: clientId,
      community: "Dubai Marina",
      building: "Marina Heights",
      unitNo: "5",
    });
    const ten = await tenancies.createTenancy(W.ctx, {
      propertyId: prop.id,
      startDate: daysFromNow(-300),
      endDate: daysFromNow(50),
      annualRent: 72_000,
    });
    await captureBenchmark(W.ctx, { community: "Dubai Marina", marketRentAvg: 200_000 }); // community-wide
    await captureBenchmark(W.ctx, { community: "Dubai Marina", building: "Marina Heights", marketRentAvg: 96_000 }); // building
    const risk = await getRenewalRisk(W.ctx, ten.id);
    expect(risk.latestIndex?.marketRentAvg).toBe(96_000);
    expect(risk.position?.valueAtRisk).toBe(7_200);
  });

  it("the pipeline uses benchmark fallback and flags isBenchmark", async () => {
    await captureBenchmark(W.ctx, { community: "Dubai Marina", marketRentAvg: 96_000 });
    const row = (await listRenewalPipeline(W.ctx)).find((r) => r.tenancyId === tenancyId);
    expect(row?.valueAtRisk).toBe(7_200);
    expect(row?.isBenchmark).toBe(true);
  });

  it("no capture and no matching benchmark → no position", async () => {
    await captureBenchmark(W.ctx, { community: "Other Community", marketRentAvg: 96_000 });
    const risk = await getRenewalRisk(W.ctx, tenancyId);
    expect(risk.position).toBeNull();
    expect(risk.latestIndex).toBeNull();
  });

  it("captureBenchmark writes INDEX_CAPTURED evidence and an audit", async () => {
    const b = await captureBenchmark(W.ctx, { community: "Dubai Marina", marketRentAvg: 96_000 });
    const ev = await prisma.evidenceEvent.findFirst({
      where: { workspaceId: W.workspaceId, type: "INDEX_CAPTURED", scopeType: "WORKSPACE" },
    });
    expect((ev!.payload as { benchmark?: boolean }).benchmark).toBe(true);
    expect(
      await prisma.auditEvent.findFirst({ where: { verb: "renewal.capture_benchmark", objectId: b.id } }),
    ).toBeTruthy();
  });
});
