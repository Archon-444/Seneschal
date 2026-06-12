import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as proofs from "@/server/services/proofs";
import * as contacts from "@/server/services/contacts";
import { processInboundProofEmail, intakeAddress } from "@/server/services/emailIntake";

// T7.4 — proof submission via tokenized reply-to address lands on the request
// through the same pipeline as the link upload.

let W: TestActor;
let proofId: string;
let token: string;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Email intake WS");
  const contact = await contacts.createContact(W.ctx, {
    kind: "AGENT",
    name: "Agent",
    email: "agent@test.example",
  });
  const request = await proofs.createProofRequest(W.ctx, {
    scopeType: "WORKSPACE",
    title: "Send the receipt",
    requiredEvidence: "Receipt photo",
    assignedContactId: contact.id,
  });
  proofId = request.id;
  const { url } = await proofs.sendProofRequest(W.ctx, request.id);
  token = url.split("/link/")[1];
});

describe("email intake (T7.4)", () => {
  it("attachment to proof+<token>@ lands on the request via the shared pipeline", async () => {
    const result = await processInboundProofEmail({
      to: `Proof Desk <${intakeAddress(token)}>`,
      from: "agent@test.example",
      subject: "Receipt attached",
      text: "Here you go.",
      attachments: [
        { fileName: "receipt.jpg", mime: "image/jpeg", data: Buffer.from("img-bytes") },
      ],
    });
    expect(result.accepted).toBe(true);

    // same artifacts as a link upload: Document + AccessLog + Evidence + status
    const doc = await prisma.document.findFirst({
      where: { scopeType: "PROOF_REQUEST", scopeId: proofId },
    });
    expect(doc!.fileName).toBe("receipt.jpg");
    const log = await prisma.documentAccessLog.findFirst({ where: { documentId: doc!.id } });
    expect(log!.action).toBe("UPLOADED");
    expect(log!.secureLinkId).toBeTruthy();
    const evidence = await prisma.evidenceEvent.findFirst({
      where: { type: "PROOF_UPLOADED", scopeId: proofId },
    });
    expect(evidence).toBeTruthy();
    expect((await prisma.proofRequest.findUnique({ where: { id: proofId } }))!.status).toBe("SUBMITTED");

    // inbound message logged
    const inbound = await prisma.notificationMessage.findFirst({
      where: { direction: "INBOUND", relatedId: proofId },
    });
    expect(inbound!.status).toBe("RECEIVED");
  });

  it("rejects unknown token, missing token, and empty attachments", async () => {
    expect(
      (await processInboundProofEmail({
        to: intakeAddress("not-a-real-token"),
        from: "x@y.z",
        attachments: [{ fileName: "a", mime: "a/b", data: Buffer.from("x") }],
      })).accepted,
    ).toBe(false);
    expect(
      (await processInboundProofEmail({
        to: "plain@nowhere.example",
        from: "x@y.z",
        attachments: [{ fileName: "a", mime: "a/b", data: Buffer.from("x") }],
      })).accepted,
    ).toBe(false);
    expect(
      (await processInboundProofEmail({
        to: intakeAddress(token),
        from: "x@y.z",
        attachments: [],
      })).accepted,
    ).toBe(false);
  });

  it("outbound proof email contains the tokenized reply address", async () => {
    const message = await prisma.notificationMessage.findFirst({
      where: { relatedId: proofId, direction: "OUTBOUND" },
    });
    expect(message!.bodyRef).toContain(`proof+${token}@`);
  });
});
