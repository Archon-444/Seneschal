import type { Channel, NotificationCategory, Prisma, ScopeType } from "@prisma/client";
import { prisma } from "../db";
import { enqueue } from "../outbox";
import { whatsappConfigured } from "./whatsapp";
import { hasActiveMessagingConsent } from "../services/consent";
import { isSensitiveTemplate, redactedBodyFor } from "./categories";

// Notification gateway (T9.1 — release blocking). `notify()` is the single writer
// of NotificationMessage. EMAIL/WHATSAPP/SMS rows enqueue delivery via the outbox;
// an INAPP row is a feed item that is "delivered" the moment it exists, so it skips
// the outbox entirely. The fan-in helper (notify/record.ts) sits above this.

export interface NotifyInput {
  workspaceId: string;
  channel: Channel;
  templateCode: string;
  subject?: string;
  body: string;
  toUserId?: string;
  toContactId?: string;
  toAddress?: string; // resolved email/phone; stored on the outbox payload only
  /** Upgrade to this channel at delivery if gated checks pass; else stay `channel`. */
  preferChannel?: Channel;
  relatedType?: ScopeType;
  relatedId?: string;
  /** Feed metadata (INAPP rows + digest routing); ignored by external channels. */
  category?: NotificationCategory;
  urgent?: boolean;
}

export async function notify(input: NotifyInput, db: Prisma.TransactionClient = prisma) {
  const isInApp = input.channel === "INAPP";
  const sensitive = isSensitiveTemplate(input.templateCode);
  // A sensitive body is a secret (OTP) — it must never become an in-app feed item, the very
  // thing INAPP is. Fail closed: a sensitive template has no business on the INAPP channel.
  if (sensitive && isInApp) {
    throw new Error(`Sensitive template ${input.templateCode} cannot be delivered in-app`);
  }
  const message = await db.notificationMessage.create({
    data: {
      workspaceId: input.workspaceId,
      channel: input.channel,
      direction: "OUTBOUND",
      toUserId: input.toUserId ?? null,
      toContactId: input.toContactId ?? null,
      templateCode: input.templateCode,
      subject: input.subject ?? null,
      // Sensitive: store only the non-secret placeholder at rest; the live body rides the
      // outbox payload (below) to the adapter and is never persisted on the message row.
      bodyRef: sensitive ? redactedBodyFor(input.templateCode) : input.body,
      // A feed item exists == delivered; an external send starts QUEUED.
      status: isInApp ? "DELIVERED" : "QUEUED",
      relatedType: input.relatedType ?? null,
      relatedId: input.relatedId ?? null,
      category: input.category ?? null,
      urgent: input.urgent ?? false,
    },
  });
  // INAPP has no external send — no outbox work.
  if (!isInApp) {
    await enqueue(
      "notification.send",
      {
        messageId: message.id,
        toAddress: input.toAddress ?? null,
        preferChannel: input.preferChannel ?? null,
        // The live body travels ONLY on the outbox payload for sensitive sends (deliverNotification
        // reads it instead of the redacted bodyRef). dispatchPending strips it on the terminal flip,
        // so the secret persists nowhere once the send is done or permanently dead.
        ...(sensitive ? { body: input.body } : {}),
      },
      db,
      // H1: the NotificationMessage row id is the natural send-idempotency key.
      // It also pins the (topic, idempotencyKey) unique constraint to "one
      // outbox row per message" — a retry of `notify()` for the same message
      // throws P2002 instead of double-queueing.
      { idempotencyKey: `notification.send:${message.id}` },
    );
  }
  return message;
}

export interface ProviderAdapter {
  send(args: {
    to: string;
    subject: string | null;
    body: string;
    idempotencyKey?: string | null;
  }): Promise<{ providerRef: string | null }>;
}

/** Outbox handler: deliver a queued NotificationMessage via its channel adapter. */
export async function deliverNotification(
  payload: Record<string, unknown>,
  ctx?: { idempotencyKey: string | null },
): Promise<void> {
  const messageId = payload.messageId as string;
  const message = await prisma.notificationMessage.findUnique({ where: { id: messageId } });
  if (!message || message.status !== "QUEUED") return; // idempotent

  // Sensitive templates carry their live body on the outbox payload, never on the message row
  // (bodyRef holds only a redacted placeholder). Resolve it here and fail closed if it is absent —
  // we must never deliver the placeholder as though it were the secret. Mark the message FAILED
  // (a dead-letter) and log the template code + message id, never the code, so an auth-delivery
  // gap stays debuggable. After a successful send dispatchPending strips this body, but the
  // message is then SENT so the QUEUED guard above prevents any re-entry here.
  const sensitive = isSensitiveTemplate(message.templateCode);
  const body = sensitive ? (payload.body as string | undefined) : (message.bodyRef ?? "");
  if (sensitive && (body === undefined || body === null)) {
    console.error(
      `[notify] sensitive ${message.templateCode} message ${messageId} has no deliverable body; marking FAILED`,
    );
    await prisma.notificationMessage.update({ where: { id: messageId }, data: { status: "FAILED" } });
    return;
  }

  // Resolve both addresses once — we may need email and/or phone.
  const user = message.toUserId ? await prisma.user.findUnique({ where: { id: message.toUserId } }) : null;
  const contact = message.toContactId
    ? await prisma.contact.findUnique({ where: { id: message.toContactId } })
    : null;
  const email = (payload.toAddress as string | null) ?? user?.email ?? contact?.email ?? null;
  const phone = user?.phone ?? contact?.phone ?? null;

  // Channel resolution. A message reaches WhatsApp only when it is explicitly
  // preferred (or already on that channel) AND the provider is configured AND a
  // phone exists AND the recipient has active MESSAGING consent. The gate is
  // applied to the *resolved* channel, so a message created directly on WHATSAPP
  // is gated too — never deliver over WhatsApp without an active grant.
  let channel = message.channel;
  if ((payload.preferChannel as Channel | undefined) === "WHATSAPP") channel = "WHATSAPP";
  if (channel === "WHATSAPP") {
    const consented = message.toUserId
      ? await hasActiveMessagingConsent({ userId: message.toUserId }, message.workspaceId)
      : message.toContactId
        ? await hasActiveMessagingConsent({ contactId: message.toContactId }, message.workspaceId)
        : false;
    if (!whatsappConfigured() || !consented || !phone) channel = "EMAIL";
  }

  // Address for the resolved channel. WhatsApp implies a phone (gated above).
  const to = channel === "WHATSAPP" ? phone : email;
  if (!to) {
    await prisma.notificationMessage.update({ where: { id: messageId }, data: { status: "FAILED" } });
    return;
  }

  // Gate 3: the log must record the channel actually used, never claim EMAIL on a WhatsApp send.
  if (channel !== message.channel) {
    await prisma.notificationMessage.update({ where: { id: messageId }, data: { channel } });
  }

  const adapter = await adapterFor(channel);
  try {
    const { providerRef } = await adapter.send({
      to,
      subject: message.subject,
      body: body ?? "",
      idempotencyKey: ctx?.idempotencyKey ?? null,
    });
    await prisma.notificationMessage.update({
      where: { id: messageId },
      data: { status: "SENT", providerRef },
    });
  } catch (err) {
    await prisma.notificationMessage.update({
      where: { id: messageId },
      data: { status: "FAILED" },
    });
    throw err;
  }
}

async function adapterFor(channel: Channel): Promise<ProviderAdapter> {
  if (channel === "EMAIL") {
    const { emailAdapter } = await import("./email");
    return emailAdapter();
  }
  if (channel === "WHATSAPP") {
    const { whatsappAdapter } = await import("./whatsapp");
    return whatsappAdapter();
  }
  throw new Error(`No adapter for channel ${channel}`);
}
