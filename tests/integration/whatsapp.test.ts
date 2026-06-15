import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import { notify } from "@/server/notify";
import { dispatchPending } from "@/server/outbox";
import { handlers } from "@/server/outbox/runner";
import {
  grantMessagingConsent,
  revokeMessagingConsent,
  hasActiveMessagingConsent,
} from "@/server/services/consent";
import { GET, POST } from "@/app/api/v1/webhooks/whatsapp/route";

let W: TestActor;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("WhatsApp WS");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function makeContact(phone: string | null) {
  return prisma.contact.create({
    data: { workspaceId: W.workspaceId, kind: "TENANT", name: "T", phone, email: "t@example.com" },
  });
}

/** Configure the Meta provider and spy on outbound HTTP. */
function stubMetaProvider() {
  vi.stubEnv("WHATSAPP_PROVIDER", "meta");
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "123456");
  vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "test-token");
  const fetchSpy = vi.fn(
    async (..._args: unknown[]) =>
      new Response(JSON.stringify({ messages: [{ id: "wamid.TEST123" }] }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}
const calledMeta = (spy: ReturnType<typeof stubMetaProvider>) =>
  spy.mock.calls.some((args) => String(args[0]).includes("graph.facebook.com"));

async function drain() {
  await dispatchPending(handlers);
}

async function onlyMessage(workspaceId: string) {
  const m = await prisma.notificationMessage.findFirst({ where: { workspaceId } });
  expect(m).toBeTruthy();
  return m!;
}

function waNotify(contactId: string, templateCode = "notice_gate_v1") {
  return notify({
    workspaceId: W.workspaceId,
    channel: "EMAIL",
    templateCode,
    body: "test",
    toContactId: contactId,
    toAddress: "t@example.com",
    preferChannel: "WHATSAPP",
  });
}

describe("whatsapp delivery gating", () => {
  it("no consent → email, Meta never called", async () => {
    const spy = stubMetaProvider();
    const c = await makeContact("+971500000001");
    await waNotify(c.id);
    await drain();
    const m = await onlyMessage(W.workspaceId);
    expect(m.status).toBe("SENT");
    expect(m.channel).toBe("EMAIL");
    expect(calledMeta(spy)).toBe(false);
  });

  it("consent but provider unset → email fallback", async () => {
    const c = await makeContact("+971500000002");
    await grantMessagingConsent(W.ctx, { contactId: c.id });
    await waNotify(c.id);
    await drain();
    const m = await onlyMessage(W.workspaceId);
    expect(m.status).toBe("SENT");
    expect(m.channel).toBe("EMAIL");
  });

  it("consent + provider + phone → WhatsApp, providerRef stored, channel recorded", async () => {
    const spy = stubMetaProvider();
    const c = await makeContact("+971500000003");
    await grantMessagingConsent(W.ctx, { contactId: c.id });
    await waNotify(c.id);
    await drain();
    expect(calledMeta(spy)).toBe(true);
    const m = await onlyMessage(W.workspaceId);
    expect(m.status).toBe("SENT");
    expect(m.providerRef).toBe("wamid.TEST123");
    expect(m.channel).toBe("WHATSAPP"); // Gate 3
  });

  it("consent but no phone → downgrade to email", async () => {
    const spy = stubMetaProvider();
    const c = await makeContact(null);
    await grantMessagingConsent(W.ctx, { contactId: c.id });
    await waNotify(c.id);
    await drain();
    const m = await onlyMessage(W.workspaceId);
    expect(m.status).toBe("SENT");
    expect(m.channel).toBe("EMAIL");
    expect(calledMeta(spy)).toBe(false);
  });

  it("delivers to a workspace user with waOptInAt + phone over WhatsApp", async () => {
    const spy = stubMetaProvider();
    await grantMessagingConsent(W.ctx, { userId: W.ctx.userId });
    await prisma.user.update({ where: { id: W.ctx.userId }, data: { phone: "+971500000099" } });
    await notify({
      workspaceId: W.workspaceId,
      channel: "EMAIL",
      templateCode: "notice_gate_v1",
      body: "test",
      toUserId: W.ctx.userId,
      preferChannel: "WHATSAPP",
    });
    await drain();
    expect(calledMeta(spy)).toBe(true);
    expect((await onlyMessage(W.workspaceId)).channel).toBe("WHATSAPP");
  });

  it("REGRESSION: a message created directly on WHATSAPP is still consent-gated", async () => {
    const spy = stubMetaProvider();
    const c = await makeContact("+971500000006");
    // No consent grant. The gate is on the resolved channel, so even a message
    // built straight on WHATSAPP must fall back to email without a grant.
    await notify({
      workspaceId: W.workspaceId,
      channel: "WHATSAPP",
      templateCode: "notice_gate_v1",
      body: "test",
      toContactId: c.id,
      toAddress: "t@example.com",
    });
    await drain();
    const m = await onlyMessage(W.workspaceId);
    expect(m.channel).toBe("EMAIL");
    expect(calledMeta(spy)).toBe(false);
  });

  it("REGRESSION: plain EMAIL notify (no preferChannel) never touches WhatsApp", async () => {
    const spy = stubMetaProvider();
    const c = await makeContact("+971500000005");
    await grantMessagingConsent(W.ctx, { contactId: c.id });
    await notify({
      workspaceId: W.workspaceId,
      channel: "EMAIL",
      templateCode: "cheque_v1",
      body: "test",
      toContactId: c.id,
      toAddress: "t@example.com",
    });
    await drain();
    expect(calledMeta(spy)).toBe(false);
    expect((await onlyMessage(W.workspaceId)).channel).toBe("EMAIL");
  });
});

describe("messaging consent", () => {
  it("contact grant → has true; revoke → false", async () => {
    const c = await makeContact("+971500000010");
    await grantMessagingConsent(W.ctx, { contactId: c.id });
    expect(await hasActiveMessagingConsent({ contactId: c.id })).toBe(true);
    expect(
      await prisma.consentRecord.findFirst({ where: { contactId: c.id, purpose: "MESSAGING" } }),
    ).toBeTruthy();
    await revokeMessagingConsent(W.ctx, { contactId: c.id });
    expect(await hasActiveMessagingConsent({ contactId: c.id })).toBe(false);
  });

  it("user opt-in sets waOptInAt", async () => {
    await grantMessagingConsent(W.ctx, { userId: W.ctx.userId });
    expect((await prisma.user.findUnique({ where: { id: W.ctx.userId } }))?.waOptInAt).toBeTruthy();
    expect(await hasActiveMessagingConsent({ userId: W.ctx.userId })).toBe(true);
  });

  it("grant/revoke write CONSENT_GRANTED / CONSENT_REVOKED evidence", async () => {
    const c = await makeContact("+971500000011");
    await grantMessagingConsent(W.ctx, { contactId: c.id });
    await revokeMessagingConsent(W.ctx, { contactId: c.id });
    const types = (
      await prisma.evidenceEvent.findMany({
        where: { workspaceId: W.workspaceId, type: { in: ["CONSENT_GRANTED", "CONSENT_REVOKED"] } },
      })
    ).map((e) => e.type);
    expect(types).toContain("CONSENT_GRANTED");
    expect(types).toContain("CONSENT_REVOKED");
  });
});

const sign = (body: string, secret: string) =>
  "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

describe("whatsapp webhook", () => {
  beforeEach(() => {
    vi.stubEnv("WHATSAPP_PROVIDER", "meta");
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "verify-me");
    vi.stubEnv("WHATSAPP_APP_SECRET", "shh");
  });

  it("GET handshake echoes the challenge for the right verify token", async () => {
    const res = await GET(
      new Request("https://x/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42"),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("42");
  });

  it("GET handshake rejects a wrong verify token", async () => {
    const res = await GET(
      new Request("https://x/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=42"),
    );
    expect(res.status).toBe(403);
  });

  it("POST without an app secret configured → 500 (fail closed)", async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", "");
    const body = JSON.stringify({ entry: [] });
    const res = await POST(
      new Request("https://x/api/v1/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": sign(body, "") },
        body,
      }),
    );
    expect(res.status).toBe(500);
  });

  it("inbound message records evidence against the exact-phone contact", async () => {
    const c = await makeContact("+971500000020");
    const body = JSON.stringify({
      entry: [{ changes: [{ value: { messages: [{ from: "971500000020", id: "wamid.IN1", text: { body: "ok" } }] } }] }],
    });
    await POST(
      new Request("https://x/api/v1/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": sign(body, "shh") },
        body,
      }),
    );
    await drain();
    const ev = await prisma.evidenceEvent.findFirst({
      where: { workspaceId: W.workspaceId, type: "TENANT_ACKNOWLEDGED" },
    });
    expect(ev).toBeTruthy();
    expect((ev!.payload as { from?: string }).from).toBe("971500000020");
    void c;
  });

  it("inbound message with only a substring phone match records no evidence", async () => {
    // '+9715000000201' contains '971500000020' but is not an exact match.
    await makeContact("+9715000000201");
    const body = JSON.stringify({
      entry: [{ changes: [{ value: { messages: [{ from: "971500000020", id: "wamid.IN2", text: { body: "ok" } }] } }] }],
    });
    await POST(
      new Request("https://x/api/v1/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": sign(body, "shh") },
        body,
      }),
    );
    await drain();
    const ev = await prisma.evidenceEvent.findFirst({
      where: { workspaceId: W.workspaceId, type: "TENANT_ACKNOWLEDGED" },
    });
    expect(ev).toBeNull();
  });

  it("POST with a bad signature → 401", async () => {
    const body = JSON.stringify({ entry: [] });
    const res = await POST(
      new Request("https://x/api/v1/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": "sha256=deadbeef" },
        body,
      }),
    );
    expect(res.status).toBe(401);
  });

  it("POST delivery status → 200 and (after drain) flips the message", async () => {
    const m = await prisma.notificationMessage.create({
      data: {
        workspaceId: W.workspaceId,
        channel: "WHATSAPP",
        direction: "OUTBOUND",
        templateCode: "notice_gate_v1",
        status: "SENT",
        providerRef: "wamid.ABC",
      },
    });
    const body = JSON.stringify({
      entry: [{ changes: [{ value: { statuses: [{ id: "wamid.ABC", status: "delivered" }] } }] }],
    });
    const res = await POST(
      new Request("https://x/api/v1/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": sign(body, "shh") },
        body,
      }),
    );
    expect(res.status).toBe(200);
    await drain();
    expect((await prisma.notificationMessage.findUnique({ where: { id: m.id } }))?.status).toBe("DELIVERED");
  });

  it("status is monotonic — a late 'delivered' does not downgrade READ", async () => {
    const m = await prisma.notificationMessage.create({
      data: {
        workspaceId: W.workspaceId,
        channel: "WHATSAPP",
        direction: "OUTBOUND",
        templateCode: "x",
        status: "READ",
        providerRef: "wamid.MONO",
      },
    });
    const body = JSON.stringify({
      entry: [{ changes: [{ value: { statuses: [{ id: "wamid.MONO", status: "delivered" }] } }] }],
    });
    await POST(
      new Request("https://x/api/v1/webhooks/whatsapp", {
        method: "POST",
        headers: { "x-hub-signature-256": sign(body, "shh") },
        body,
      }),
    );
    await drain();
    expect((await prisma.notificationMessage.findUnique({ where: { id: m.id } }))?.status).toBe("READ");
  });
});
