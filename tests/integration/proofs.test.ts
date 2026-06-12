import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as proofs from "@/server/services/proofs";
import * as contacts from "@/server/services/contacts";
import * as secureLinks from "@/server/services/secureLinks";

// E7 — proof request lifecycle, secure links (T7.2 ⛔), external upload (T7.3).

let W: TestActor;
let contactId: string;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Fiduciary");
  const c = await contacts.createContact(W.ctx, {
    kind: "AGENT",
    name: "Samir Khan",
    email: "samir@test.example",
  });
  contactId = c.id;
});

async function makeRequestWithLink() {
  const request = await proofs.createProofRequest(W.ctx, {
    scopeType: "TENANCY",
    title: "Upload cheque proof",
    requiredEvidence: "Deposit slip photo",
    assignedContactId: contactId,
    dueAt: new Date("2026-12-31"),
  });
  const { url } = await proofs.sendProofRequest(W.ctx, request.id);
  const token = url.split("/link/")[1];
  return { request, token };
}

describe("proof request lifecycle", () => {
  it("creation writes PROOF_REQUESTED; send creates link + notification", async () => {
    const { request, token } = await makeRequestWithLink();
    expect(token).toBeTruthy();

    const evidence = await prisma.evidenceEvent.findFirst({
      where: { type: "PROOF_REQUESTED", scopeId: request.id },
    });
    expect(evidence).toBeTruthy();

    const message = await prisma.notificationMessage.findFirst({
      where: { relatedId: request.id, channel: "EMAIL" },
    });
    expect(message).toBeTruthy();
    expect(message!.status).toBe("QUEUED"); // delivery via outbox, never inline
    const outbox = await prisma.outbox.findFirst({ where: { topic: "notification.send" } });
    expect(outbox).toBeTruthy();

    // raw token never stored — only its hash
    const link = await prisma.secureLink.findFirst({ where: { scopeId: request.id } });
    expect(link!.tokenHash).not.toBe(token);
    expect(JSON.stringify(link)).not.toContain(token);
  });

  it("external upload creates Document + AccessLog + Evidence + Consent and submits", async () => {
    const { request, token } = await makeRequestWithLink();
    const validation = await secureLinks.validateLinkToken(token);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;

    const docs = await proofs.submitProofViaLink(
      validation.link,
      [{ fileName: "slip.jpg", mime: "image/jpeg", data: Buffer.from("fake-image-bytes") }],
      "Deposited today",
      { ip: "1.2.3.4", device: "iPhone" },
    );
    expect(docs).toHaveLength(1);

    const accessLog = await prisma.documentAccessLog.findFirst({
      where: { documentId: docs[0].id, action: "UPLOADED" },
    });
    expect(accessLog!.secureLinkId).toBe(validation.link.id);
    expect(accessLog!.actorUserId).toBeNull(); // no account involved

    const evidence = await prisma.evidenceEvent.findFirst({
      where: { type: "PROOF_UPLOADED", scopeId: request.id },
    });
    expect(evidence!.actorType).toBe("TENANT_LINK");

    const consent = await prisma.consentRecord.findFirst({ where: { contactId } });
    expect(consent!.purpose).toBe("LINK_INTERACTION");
    expect(consent!.noticeVersion).toBe(proofs.PRIVACY_NOTICE_VERSION);

    const updated = await prisma.proofRequest.findUnique({ where: { id: request.id } });
    expect(updated!.status).toBe("SUBMITTED");
  });

  it("approve writes PROOF_APPROVED; reject re-opens with PROOF_REJECTED", async () => {
    const { request, token } = await makeRequestWithLink();
    const v = await secureLinks.validateLinkToken(token);
    if (!v.ok) throw new Error("link invalid");
    await proofs.submitProofViaLink(v.link, [
      { fileName: "slip.jpg", mime: "image/jpeg", data: Buffer.from("x") },
    ]);

    const rejected = await proofs.decideProofRequest(W.ctx, request.id, "REJECTED", "blurry");
    expect(rejected.status).toBe("OPEN"); // re-opened
    expect(
      await prisma.evidenceEvent.findFirst({ where: { type: "PROOF_REJECTED", scopeId: request.id } }),
    ).toBeTruthy();

    await proofs.submitProofViaLink(v.link, [
      { fileName: "slip2.jpg", mime: "image/jpeg", data: Buffer.from("y") },
    ]);
    const approved = await proofs.decideProofRequest(W.ctx, request.id, "APPROVED", "ok");
    expect(approved.status).toBe("APPROVED");
  });

  it("overdue sweep flags and is idempotent", async () => {
    const request = await proofs.createProofRequest(W.ctx, {
      scopeType: "TENANCY",
      title: "Old request",
      requiredEvidence: "x",
      assignedContactId: contactId,
      dueAt: new Date("2020-01-01"),
    });
    expect(await proofs.sweepOverdueProofRequests(W.workspaceId)).toBe(1);
    expect(await proofs.sweepOverdueProofRequests(W.workspaceId)).toBe(0); // idempotent

    const flag = await prisma.riskFlag.findFirst({
      where: { code: "PROOF_OVERDUE", scopeId: request.id, status: "OPEN" },
    });
    expect(flag).toBeTruthy();
  });
});

describe("secure links (T7.2)", () => {
  it("expired links return a safe refusal", async () => {
    const { request } = await makeRequestWithLink();
    const { url } = await secureLinks.createSecureLink(W.ctx, {
      purpose: "PROOF_UPLOAD",
      scopeType: "PROOF_REQUEST",
      scopeId: request.id,
      expiresInDays: -1, // already expired
    });
    const token = url.split("/link/")[1];
    const v = await secureLinks.validateLinkToken(token);
    expect(v).toEqual({ ok: false, reason: "expired" });
  });

  it("revocation is audited and immediate", async () => {
    const { request } = await makeRequestWithLink();
    const { linkId, url } = await secureLinks.createSecureLink(W.ctx, {
      purpose: "PROOF_UPLOAD",
      scopeType: "PROOF_REQUEST",
      scopeId: request.id,
    });
    await secureLinks.revokeSecureLink(W.ctx, linkId);
    const token = url.split("/link/")[1];
    expect(await secureLinks.validateLinkToken(token)).toEqual({ ok: false, reason: "revoked" });

    const audit = await prisma.auditEvent.findFirst({
      where: { verb: "securelink.revoke", objectId: linkId },
    });
    expect(audit).toBeTruthy();
  });

  it("maxUses exhausts", async () => {
    const { request } = await makeRequestWithLink();
    const { linkId, url } = await secureLinks.createSecureLink(W.ctx, {
      purpose: "PROOF_UPLOAD",
      scopeType: "PROOF_REQUEST",
      scopeId: request.id,
      maxUses: 1,
    });
    const token = url.split("/link/")[1];
    expect((await secureLinks.validateLinkToken(token)).ok).toBe(true);
    await secureLinks.consumeLinkUse(linkId);
    expect(await secureLinks.validateLinkToken(token)).toEqual({ ok: false, reason: "exhausted" });
  });

  it("unknown token is not found", async () => {
    expect(await secureLinks.validateLinkToken("garbage-token")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});
