import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, prisma, resetDb } from "../helpers";
import { requestPasswordReset, resetPassword, setUserPassword } from "@/server/auth";
import { deliverNotification, notify } from "@/server/notify";
import { dispatchPending } from "@/server/outbox";
import { redactedBodyFor } from "@/server/notify/categories";

// T9.1 hardening — a sensitive template's live body (the reset URL) must never persist where it
// can be read back: not on NotificationMessage.bodyRef (insert-only, rendered in the feed,
// rolled into digests), and not at rest in a retained Outbox.payload once the send is terminal.
// The URL reaches the recipient (and the dev console, redacted) but is structurally absent from storage.

const handlers = { "notification.send": deliverNotification };

async function resetUser() {
  const W = await makeWorkspace("Sensitive WS");
  const email = "reset@test.example";
  const user = await prisma.user.create({ data: { email, name: "Reset User" } });
  await prisma.membership.create({
    data: { workspaceId: W.workspaceId, userId: user.id, role: "FIDUCIARY" },
  });
  await setUserPassword(user.id, "test-passphrase");
  return { workspaceId: W.workspaceId, email, userId: user.id };
}

function payloadBody(payload: unknown): string | undefined {
  return (payload as { body?: string } | null)?.body;
}

function tokenFromResetMail(payload: unknown): string {
  const match = payloadBody(payload)?.match(/\/login\/reset\/([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error("reset mail did not carry a token URL");
  return match[1];
}

describe("sensitive notification redaction (auth_reset_v1)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("stores only the redacted placeholder on the message row; the live token rides the outbox payload", async () => {
    const { email } = await resetUser();
    await requestPasswordReset(email);

    const msg = await prisma.notificationMessage.findFirstOrThrow({ where: { templateCode: "auth_reset_v1" } });
    expect(msg.bodyRef).toBe(redactedBodyFor("auth_reset_v1"));
    expect(msg.bodyRef).not.toMatch(/\/login\/reset\//);

    const ob = await prisma.outbox.findFirstOrThrow({ where: { topic: "notification.send" } });
    expect(payloadBody(ob.payload)).toMatch(/\/login\/reset\/[A-Za-z0-9_-]+/);
  });

  it("end-to-end: the redacted send still delivers a usable reset token", async () => {
    const { email } = await resetUser();
    await requestPasswordReset(email);
    const ob = await prisma.outbox.findFirstOrThrow({ where: { topic: "notification.send" } });
    const token = tokenFromResetMail(ob.payload);
    expect((await resetPassword(token, "fresh-passphrase"))).toHaveProperty("sessionToken");
  });

  it("strips the live token from the retained outbox row once the send is dispatched", async () => {
    const { email } = await resetUser();
    await requestPasswordReset(email);
    const before = await prisma.outbox.findFirstOrThrow({ where: { topic: "notification.send" } });
    const token = tokenFromResetMail(before.payload);

    await dispatchPending(handlers);

    const msg = await prisma.notificationMessage.findFirstOrThrow({ where: { templateCode: "auth_reset_v1" } });
    expect(msg.status).toBe("SENT");
    const ob = await prisma.outbox.findFirstOrThrow({ where: { topic: "notification.send" } });
    expect(ob.status).toBe("dispatched");
    expect(payloadBody(ob.payload)).toBeUndefined();
    expect(JSON.stringify(ob.payload)).not.toContain(token);

    // PasswordReset.tokenHash was never the cleartext carrier — the token still works after the scrub.
    expect((await resetPassword(token, "fresh-passphrase"))).toHaveProperty("sessionToken");
  });

  it("fails closed: a sensitive send whose payload lost its body dead-letters instead of shipping the placeholder", async () => {
    const { workspaceId, userId, email } = await resetUser();
    const msg = await notify({
      workspaceId,
      channel: "EMAIL",
      templateCode: "auth_reset_v1",
      subject: "Reset your Seneschal password",
      body: "Reset your password using this one-time link:\nhttps://app.example/login/reset/LIVEtoken_ABC-123xyz",
      toUserId: userId,
      toAddress: email,
    });
    const ob = await prisma.outbox.findFirstOrThrow({ where: { topic: "notification.send" } });
    await prisma.outbox.update({
      where: { id: ob.id },
      data: { payload: { messageId: msg.id, toAddress: email, preferChannel: null } },
    });

    await dispatchPending(handlers);

    const after = await prisma.notificationMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(after.status).toBe("FAILED");
    expect(after.providerRef).toBeNull();
  });

  it("refuses to put a sensitive template on the in-app feed at all", async () => {
    const { workspaceId, userId } = await resetUser();
    await expect(
      notify({
        workspaceId,
        channel: "INAPP",
        templateCode: "auth_reset_v1",
        body: "Reset at https://app.example/login/reset/LIVEtoken_ABC-123xyz",
        toUserId: userId,
      }),
    ).rejects.toThrow(/cannot be delivered in-app/i);
  });
});

// A secure-link send embeds the live /link/<token> URL in its body. The token is the only
// credential gating the public link, so it must be redacted from bodyRef exactly like a reset
// URL — otherwise it persists on the insert-only, feed-rendered message row and stays replayable.
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
      expect(row.bodyRef).not.toContain(token);

      const ob = await prisma.outbox.findFirstOrThrow({ where: { topic: "notification.send" } });
      expect(payloadBody(ob.payload)).toContain(token);
    },
  );
});
