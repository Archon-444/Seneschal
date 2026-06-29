import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, prisma, resetDb } from "../helpers";
import { requestOtp, verifyOtp } from "@/server/auth";
import { deliverNotification, notify } from "@/server/notify";
import { dispatchPending } from "@/server/outbox";
import { redactedBodyFor } from "@/server/notify/categories";

// T9.1 hardening — a sensitive template's live body (the OTP code) must never persist where it
// can be read back: not on NotificationMessage.bodyRef (insert-only, rendered in the feed,
// rolled into digests), and not at rest in a retained Outbox.payload once the send is terminal.
// The code reaches the recipient (and the dev console) but is structurally absent from storage.

const handlers = { "notification.send": deliverNotification };

async function otpUser() {
  const W = await makeWorkspace("Sensitive WS");
  // Constant, digit-free email (the DB resets per test) so a leak check can't false-match a
  // numeric run in the address itself.
  const email = "otp@test.example";
  const user = await prisma.user.create({ data: { email, name: "OTP User" } });
  await prisma.membership.create({
    data: { workspaceId: W.workspaceId, userId: user.id, role: "FIDUCIARY" },
  });
  return { workspaceId: W.workspaceId, email, userId: user.id };
}

function payloadBody(payload: unknown): string | undefined {
  return (payload as { body?: string } | null)?.body;
}

describe("sensitive notification redaction (auth_otp_v1)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("stores only the redacted placeholder on the message row; the live code rides the outbox payload", async () => {
    const { email } = await otpUser();
    await requestOtp(email);

    const msg = await prisma.notificationMessage.findFirstOrThrow({ where: { templateCode: "auth_otp_v1" } });
    expect(msg.bodyRef).toBe(redactedBodyFor("auth_otp_v1"));
    expect(msg.bodyRef).not.toMatch(/\d{6}/); // no 6-digit code on the persisted message row

    // Pre-dispatch, the live code exists ONLY on the outbox payload.
    const ob = await prisma.outbox.findFirstOrThrow({ where: { topic: "notification.send" } });
    expect(payloadBody(ob.payload)).toMatch(/\d{6}/);
  });

  it("end-to-end: the redacted send still delivers a verifiable code", async () => {
    const { email } = await otpUser();
    await requestOtp(email);
    const ob = await prisma.outbox.findFirstOrThrow({ where: { topic: "notification.send" } });
    const code = payloadBody(ob.payload)?.match(/(\d{6})/)?.[1];
    expect(code).toBeTruthy();
    expect((await verifyOtp(email, code!))?.sessionToken).toBeTruthy();
  });

  it("strips the live code from the retained outbox row once the send is dispatched", async () => {
    const { email } = await otpUser();
    await requestOtp(email);
    // Capture the code before dispatch scrubs it, to prove verification survives the scrub.
    const before = await prisma.outbox.findFirstOrThrow({ where: { topic: "notification.send" } });
    const code = payloadBody(before.payload)?.match(/(\d{6})/)?.[1];

    await dispatchPending(handlers);

    const msg = await prisma.notificationMessage.findFirstOrThrow({ where: { templateCode: "auth_otp_v1" } });
    expect(msg.status).toBe("SENT");
    const ob = await prisma.outbox.findFirstOrThrow({ where: { topic: "notification.send" } });
    expect(ob.status).toBe("dispatched");
    expect(payloadBody(ob.payload)).toBeUndefined(); // the body key is gone from the retained row
    expect(code).toBeTruthy();
    expect(JSON.stringify(ob.payload)).not.toContain(code!); // the live code is nowhere in the payload

    // AuthOtp.codeHash was never the cleartext carrier — verification still works after the scrub.
    expect((await verifyOtp(email, code!))?.sessionToken).toBeTruthy();
  });

  it("fails closed: a sensitive send whose payload lost its body dead-letters instead of shipping the placeholder", async () => {
    const { workspaceId, userId, email } = await otpUser();
    const msg = await notify({
      workspaceId,
      channel: "EMAIL",
      templateCode: "auth_otp_v1",
      subject: "Your Seneschal sign-in code",
      body: "Your sign-in code is 999999. It expires in 10 minutes.",
      toUserId: userId,
      toAddress: email,
    });
    // Simulate the body absent at delivery while the message is still QUEUED (a corrupted payload).
    // deliverNotification must refuse to ship the redacted placeholder as if it were the code.
    const ob = await prisma.outbox.findFirstOrThrow({ where: { topic: "notification.send" } });
    await prisma.outbox.update({
      where: { id: ob.id },
      data: { payload: { messageId: msg.id, toAddress: email, preferChannel: null } },
    });

    await dispatchPending(handlers);

    const after = await prisma.notificationMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(after.status).toBe("FAILED"); // dead-lettered…
    expect(after.providerRef).toBeNull(); // …never reached the adapter (no placeholder delivered)
  });

  it("refuses to put a sensitive template on the in-app feed at all", async () => {
    const { workspaceId, userId } = await otpUser();
    await expect(
      notify({
        workspaceId,
        channel: "INAPP",
        templateCode: "auth_otp_v1",
        body: "Your sign-in code is 424242.",
        toUserId: userId,
      }),
    ).rejects.toThrow(/cannot be delivered in-app/i);
  });
});

// A secure-link send embeds the live /link/<token> URL in its body. The token is the only
// credential gating the public link, so it must be redacted from bodyRef exactly like an OTP —
// otherwise it persists on the insert-only, feed-rendered message row and stays replayable.
describe("sensitive notification redaction (secure-link templates)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it.each(["proof_request_v1", "renewal_offer_v1"])(
    "%s keeps the live token off the persisted message row, riding it on the outbox payload",
    async (templateCode) => {
      const W = await makeWorkspace("Link WS");
      const contact = await prisma.contact.create({
        data: { workspaceId: W.workspaceId, kind: "TENANT", name: "External", email: "ext@test.example" },
      });
      const token = "LIVEtoken_ABC-123xyz";
      const msg = await notify({
        workspaceId: W.workspaceId,
        channel: "EMAIL",
        templateCode,
        subject: "Action needed",
        body: `Open https://app.example/link/${token} to respond.`,
        toContactId: contact.id,
        toAddress: contact.email!,
      });

      const row = await prisma.notificationMessage.findUniqueOrThrow({ where: { id: msg.id } });
      expect(row.bodyRef).toBe(redactedBodyFor(templateCode));
      expect(row.bodyRef).not.toContain(token); // the token is absent from the persisted row

      // The live token exists only on the outbox payload, so the recipient still gets the URL.
      const ob = await prisma.outbox.findFirstOrThrow({ where: { topic: "notification.send" } });
      expect(payloadBody(ob.payload)).toContain(token);
    },
  );
});
