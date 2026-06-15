import type { Channel, Prisma, ScopeType } from "@prisma/client";
import { prisma } from "../db";
import { enqueue } from "../outbox";
import { whatsappConfigured } from "./whatsapp";
import { hasActiveMessagingConsent } from "../services/consent";

// Notification gateway (T9.1 — release blocking). `notify()` writes a
// NotificationMessage row and enqueues delivery via the outbox; providers live
// behind the adapter interface so swapping one touches only its module.

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
}

export async function notify(input: NotifyInput, db: Prisma.TransactionClient = prisma) {
  const message = await db.notificationMessage.create({
    data: {
      workspaceId: input.workspaceId,
      channel: input.channel,
      direction: "OUTBOUND",
      toUserId: input.toUserId ?? null,
      toContactId: input.toContactId ?? null,
      templateCode: input.templateCode,
      subject: input.subject ?? null,
      bodyRef: input.body,
      status: "QUEUED",
      relatedType: input.relatedType ?? null,
      relatedId: input.relatedId ?? null,
    },
  });
  await enqueue(
    "notification.send",
    { messageId: message.id, toAddress: input.toAddress ?? null, preferChannel: input.preferChannel ?? null },
    db,
  );
  return message;
}

export interface ProviderAdapter {
  send(args: {
    to: string;
    subject: string | null;
    body: string;
  }): Promise<{ providerRef: string | null }>;
}

/** Outbox handler: deliver a queued NotificationMessage via its channel adapter. */
export async function deliverNotification(payload: Record<string, unknown>): Promise<void> {
  const messageId = payload.messageId as string;
  const message = await prisma.notificationMessage.findUnique({ where: { id: messageId } });
  if (!message || message.status !== "QUEUED") return; // idempotent

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
      body: message.bodyRef ?? "",
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
