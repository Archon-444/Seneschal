import type { Channel, Prisma, ScopeType } from "@prisma/client";
import { prisma } from "../db";
import { enqueue } from "../outbox";

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
    { messageId: message.id, toAddress: input.toAddress ?? null },
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

  let to = (payload.toAddress as string | null) ?? null;
  if (!to && message.toUserId) {
    const user = await prisma.user.findUnique({ where: { id: message.toUserId } });
    to = user?.email ?? null;
  }
  if (!to && message.toContactId) {
    const contact = await prisma.contact.findUnique({ where: { id: message.toContactId } });
    to = (message.channel === "EMAIL" ? contact?.email : contact?.phone) ?? null;
  }
  if (!to) {
    await prisma.notificationMessage.update({
      where: { id: messageId },
      data: { status: "FAILED" },
    });
    return;
  }

  const adapter = await adapterFor(message.channel);
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
