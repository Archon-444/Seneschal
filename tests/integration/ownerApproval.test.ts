import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";
import * as tenancies from "@/server/services/tenancies";
import * as renewals from "@/server/services/renewals";
import {
  decideApprovalViaLink,
  getApprovalForLink,
  offerApprovalSnapshot,
  requestOwnerApproval,
} from "@/server/services/approvals";
import { createSecureLink, validateLinkToken } from "@/server/services/secureLinks";
import { AuthzError } from "@/server/authz";
import { hashToken, sha256Hex } from "@/server/crypto";
import { APPROVAL_COMMENT_MAX } from "@/lib/approvalLimits";

// Absentee-owner APPROVAL link: a recorded sign-off on an offer's exact terms,
// not a workflow gate. Consume-first (H4), guarded claim (F2), token never stored.

let W: TestActor;
let tenancyId: string;
let ownerId: string;
let propertyId: string;

async function openCaseAndOffer() {
  const rc = await renewals.openRenewalCase(W.ctx, tenancyId);
  const offer = await renewals.proposeOffer(W.ctx, {
    renewalCaseId: rc.id,
    party: "LANDLORD",
    annualRent: 84_000,
    paymentSchedule: "4 cheques",
  });
  return { rc, offer };
}

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Owner approval WS");
  const client = await clients.createClient(W.ctx, { displayName: "Family Office" });
  const owner = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Absentee Owner" });
  ownerId = owner.id;
  const tenant = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Tenant" });
  const p = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id,
    ownerContactId: owner.id,
    community: "Marina",
    unitNo: "1204",
  });
  propertyId = p.id;
  tenancyId = (
    await tenancies.createTenancy(W.ctx, {
      propertyId: p.id,
      tenantContactId: tenant.id,
      landlordContactId: owner.id,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      annualRent: 80_000,
      ejariNo: "E-1",
    })
  ).id;
});

describe("absentee-owner APPROVAL link", () => {
  it("request writes Approval + APPROVAL_REQUESTED, hashes the snapshot, never stores the token", async () => {
    const { offer } = await openCaseAndOffer();
    const result = await requestOwnerApproval(W.ctx, { offerId: offer.id, contactId: ownerId });
    const token = result.url.split("/link/")[1]!;
    expect(token).toBeTruthy();

    const approval = await prisma.approval.findUniqueOrThrow({ where: { id: result.approvalId } });
    expect(approval.subjectType).toBe("offer");
    expect(approval.subjectId).toBe(offer.id);
    expect(approval.requestedOfContactId).toBe(ownerId);
    expect(approval.decision).toBeNull();
    const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    expect(approval.payloadHash).toBe(sha256Hex(JSON.stringify(offerApprovalSnapshot(offer, property))));

    const evidence = await prisma.evidenceEvent.findFirstOrThrow({
      where: { type: "APPROVAL_REQUESTED", scopeId: offer.id },
    });
    expect(JSON.stringify(evidence.payload)).not.toContain(token);
    expect(evidence.payload).toMatchObject({ approvalId: approval.id, version: offer.version });

    const link = await prisma.secureLink.findFirstOrThrow({
      where: { purpose: "APPROVAL", scopeId: offer.id },
    });
    expect(link.tokenHash).toBe(hashToken(token));
    expect(link.tokenHash).not.toBe(token);
    expect(link.maxUses).toBe(1);
  });

  it("APPROVED via link records the decision, APPROVAL_GRANTED as TENANT_LINK, useCount 1", async () => {
    const { offer, rc } = await openCaseAndOffer();
    const { url } = await requestOwnerApproval(W.ctx, { offerId: offer.id, contactId: ownerId });
    const token = url.split("/link/")[1]!;
    const caseBefore = (await prisma.renewalCase.findUniqueOrThrow({ where: { id: rc.id } })).status;

    const decided = await decideApprovalViaLink(token, "APPROVED");
    expect(decided.decision).toBe("APPROVED");

    const approval = await prisma.approval.findUniqueOrThrow({ where: { id: decided.approvalId } });
    expect(approval.decision).toBe("APPROVED");
    expect(approval.decidedAt).not.toBeNull();

    const granted = await prisma.evidenceEvent.findFirstOrThrow({
      where: { type: "APPROVAL_GRANTED", scopeId: offer.id },
    });
    expect(granted.actorType).toBe("TENANT_LINK");
    expect(granted.actorId).toBeNull();
    expect(granted.propertyId).toBe(propertyId);
    expect(granted.payload).toMatchObject({
      viaLink: true,
      decision: "APPROVED",
      offerVersion: offer.version,
      offerStatus: "SENT",
    });
    expect(JSON.stringify(granted.payload)).not.toContain(token);

    const link = await prisma.secureLink.findFirstOrThrow({ where: { purpose: "APPROVAL", scopeId: offer.id } });
    expect(link.useCount).toBe(1);

    // Record, not a gate: offer and case are unchanged (proposeOffer already moved the case to NEGOTIATING).
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe("SENT");
    expect((await prisma.renewalCase.findUniqueOrThrow({ where: { id: rc.id } })).status).toBe(caseBefore);
  });

  it("REJECTED via link records APPROVAL_REJECTED and leaves offer/case untouched", async () => {
    const { offer, rc } = await openCaseAndOffer();
    const { url } = await requestOwnerApproval(W.ctx, { offerId: offer.id, contactId: ownerId });
    const token = url.split("/link/")[1]!;
    const caseBefore = (await prisma.renewalCase.findUniqueOrThrow({ where: { id: rc.id } })).status;

    await decideApprovalViaLink(token, "REJECTED", "too high");
    const rejected = await prisma.evidenceEvent.findFirstOrThrow({
      where: { type: "APPROVAL_REJECTED", scopeId: offer.id },
    });
    expect(rejected.actorType).toBe("TENANT_LINK");
    expect(rejected.propertyId).toBe(propertyId);
    expect(rejected.payload).toMatchObject({
      decision: "REJECTED",
      comment: "too high",
      offerStatus: "SENT",
    });
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe("SENT");
    expect((await prisma.renewalCase.findUniqueOrThrow({ where: { id: rc.id } })).status).toBe(caseBefore);
  });

  it("second decide on the same link 409s and writes no second evidence row", async () => {
    const { offer } = await openCaseAndOffer();
    const { url } = await requestOwnerApproval(W.ctx, { offerId: offer.id, contactId: ownerId });
    const token = url.split("/link/")[1]!;
    await decideApprovalViaLink(token, "APPROVED");

    await expect(decideApprovalViaLink(token, "REJECTED")).rejects.toMatchObject({ status: 400 });
    expect(await prisma.evidenceEvent.count({ where: { type: { in: ["APPROVAL_GRANTED", "APPROVAL_REJECTED"] }, scopeId: offer.id } })).toBe(1);
    expect(await prisma.approval.count({ where: { subjectId: offer.id, decision: "APPROVED" } })).toBe(1);
  });

  it("two concurrent decides yield exactly one winner", async () => {
    const { offer } = await openCaseAndOffer();
    const { url } = await requestOwnerApproval(W.ctx, { offerId: offer.id, contactId: ownerId });
    const token = url.split("/link/")[1]!;

    const results = await Promise.allSettled([
      decideApprovalViaLink(token, "APPROVED"),
      decideApprovalViaLink(token, "REJECTED"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const loser = (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason;
    expect(loser).toBeInstanceOf(AuthzError);

    const decided = await prisma.approval.findMany({ where: { subjectId: offer.id, decision: { not: null } } });
    expect(decided).toHaveLength(1);
    expect(await prisma.evidenceEvent.count({
      where: { type: { in: ["APPROVAL_GRANTED", "APPROVAL_REJECTED"] }, scopeId: offer.id },
    })).toBe(1);
  });

  it("expired, revoked and wrong-purpose tokens fail closed with no state change", async () => {
    const { offer } = await openCaseAndOffer();
    const { url, approvalId } = await requestOwnerApproval(W.ctx, { offerId: offer.id, contactId: ownerId });
    const token = url.split("/link/")[1]!;
    const link = await prisma.secureLink.findFirstOrThrow({ where: { purpose: "APPROVAL", scopeId: offer.id } });

    await prisma.secureLink.update({ where: { id: link.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(decideApprovalViaLink(token, "APPROVED")).rejects.toMatchObject({ status: 400 });
    expect((await prisma.approval.findUniqueOrThrow({ where: { id: approvalId } })).decision).toBeNull();

    await prisma.secureLink.update({
      where: { id: link.id },
      data: { expiresAt: new Date(Date.now() + 86_400_000), revokedAt: new Date() },
    });
    await expect(decideApprovalViaLink(token, "APPROVED")).rejects.toMatchObject({ status: 400 });
    expect((await prisma.approval.findUniqueOrThrow({ where: { id: approvalId } })).decision).toBeNull();

    const { url: offerUrl } = await createSecureLink(W.ctx, {
      purpose: "TENANT_OFFER",
      scopeType: "OFFER",
      scopeId: offer.id,
    });
    const offerToken = offerUrl.split("/link/")[1]!;
    const offerLink = await prisma.secureLink.findFirstOrThrow({ where: { purpose: "TENANT_OFFER", scopeId: offer.id } });
    await expect(decideApprovalViaLink(offerToken, "APPROVED")).rejects.toMatchObject({ status: 400 });
    expect((await prisma.secureLink.findUniqueOrThrow({ where: { id: offerLink.id } })).useCount).toBe(0);
    expect((await prisma.approval.findUniqueOrThrow({ where: { id: approvalId } })).decision).toBeNull();
  });

  it("getApprovalForLink returns null for a wrong-purpose or already-decided link", async () => {
    const { offer } = await openCaseAndOffer();
    const { url } = await requestOwnerApproval(W.ctx, { offerId: offer.id, contactId: ownerId });
    const token = url.split("/link/")[1]!;
    const validation = await validateLinkToken(token);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    const view = await getApprovalForLink(validation.link);
    expect(view?.annualRent).toBe(84_000);
    expect(view?.unit).toContain("Marina");

    await decideApprovalViaLink(token, "APPROVED");
    // maxUses=1: token is exhausted; even if we load the row, pending Approval is gone.
    const spent = await prisma.secureLink.findFirstOrThrow({ where: { purpose: "APPROVAL", scopeId: offer.id } });
    expect(await getApprovalForLink(spent)).toBeNull();

    const { linkId } = await createSecureLink(W.ctx, {
      purpose: "TENANT_OFFER",
      scopeType: "OFFER",
      scopeId: offer.id,
    });
    const other = await prisma.secureLink.findUniqueOrThrow({ where: { id: linkId } });
    expect(await getApprovalForLink(other)).toBeNull();
  });

  it("clamps the owner comment before it enters the insert-only evidence payload", async () => {
    const { offer } = await openCaseAndOffer();
    const { url } = await requestOwnerApproval(W.ctx, { offerId: offer.id, contactId: ownerId });
    const token = url.split("/link/")[1]!;
    await decideApprovalViaLink(token, "REJECTED", "x".repeat(APPROVAL_COMMENT_MAX + 1_000));
    const rejected = await prisma.evidenceEvent.findFirstOrThrow({
      where: { type: "APPROVAL_REJECTED", scopeId: offer.id },
    });
    expect((rejected.payload as { comment: string }).comment).toHaveLength(APPROVAL_COMMENT_MAX);
  });

  it("re-request supersedes the prior pending row and revokes the old link", async () => {
    const { offer } = await openCaseAndOffer();
    const first = await requestOwnerApproval(W.ctx, { offerId: offer.id, contactId: ownerId });
    const firstToken = first.url.split("/link/")[1]!;
    const firstRequested = await prisma.evidenceEvent.findFirstOrThrow({
      where: { type: "APPROVAL_REQUESTED", scopeId: offer.id },
    });

    const second = await requestOwnerApproval(W.ctx, { offerId: offer.id, contactId: ownerId });
    expect(second.approvalId).not.toBe(first.approvalId);

    const prior = await prisma.approval.findUniqueOrThrow({ where: { id: first.approvalId } });
    expect(prior.decision).toBeNull();
    expect(prior.decidedAt).not.toBeNull();
    const open = await prisma.approval.findMany({
      where: { subjectId: offer.id, decision: null, decidedAt: null },
    });
    expect(open).toHaveLength(1);
    expect(open[0]!.id).toBe(second.approvalId);

    const requested = await prisma.evidenceEvent.findMany({
      where: { type: "APPROVAL_REQUESTED", scopeId: offer.id },
      orderBy: { createdAt: "asc" },
    });
    expect(requested).toHaveLength(2);
    expect(requested[0]!.supersedesId).toBeNull();
    expect(requested[1]!.supersedesId).toBe(firstRequested.id);

    await expect(decideApprovalViaLink(firstToken, "APPROVED")).rejects.toMatchObject({ status: 400 });
    expect((await prisma.approval.findUniqueOrThrow({ where: { id: second.approvalId } })).decision).toBeNull();

    const secondToken = second.url.split("/link/")[1]!;
    const decided = await decideApprovalViaLink(secondToken, "APPROVED");
    expect(decided.approvalId).toBe(second.approvalId);
    expect((await prisma.approval.findUniqueOrThrow({ where: { id: second.approvalId } })).decision).toBe("APPROVED");
  });
});
