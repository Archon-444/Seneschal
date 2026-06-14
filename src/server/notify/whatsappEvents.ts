import type { MessageStatus } from "@prisma/client";
import { prisma } from "../db";
import { recordEvidence } from "../evidence";

// Applies Meta WhatsApp webhook events (delivery statuses + inbound messages).
// Runs from the Outbox (§7) so the webhook route returns fast. Status changes
// are monotonic — QUEUED→SENT→DELIVERED→READ, FAILED terminal — so duplicate or
// out-of-order events are no-ops.

const RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 };

/** The next status, or null if the event should be ignored (no downgrade). */
function nextStatus(current: MessageStatus, event: string): MessageStatus | null {
  if (event === "failed") {
    return current === "QUEUED" || current === "SENT" ? "FAILED" : null;
  }
  const map: Record<string, MessageStatus> = { sent: "SENT", delivered: "DELIVERED", read: "READ" };
  const target = map[event];
  if (!target || current === "FAILED") return null;
  return (RANK[target] ?? 0) > (RANK[current] ?? -1) ? target : null;
}

interface WaStatus {
  id?: string;
  status?: string;
}
interface WaInbound {
  from?: string;
  id?: string;
  text?: { body?: string };
}
interface WaValue {
  statuses?: WaStatus[];
  messages?: WaInbound[];
}
interface WaEntry {
  changes?: { value?: WaValue }[];
}

export async function applyWhatsappEvents(payload: Record<string, unknown>): Promise<void> {
  const entries = (payload.entry as WaEntry[] | undefined) ?? [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};

      for (const st of value.statuses ?? []) {
        if (!st.id || !st.status) continue;
        const msg = await prisma.notificationMessage.findFirst({ where: { providerRef: st.id } });
        if (!msg) continue;
        const next = nextStatus(msg.status, st.status);
        if (next) await prisma.notificationMessage.update({ where: { id: msg.id }, data: { status: next } });
      }

      for (const m of value.messages ?? []) {
        if (!m.from) continue;
        // Best-effort inbound → evidence. Resolve the workspace via the contact phone.
        const contact = await prisma.contact.findFirst({ where: { phone: { contains: m.from } } });
        if (!contact) continue;
        await recordEvidence({
          workspaceId: contact.workspaceId,
          type: "TENANT_ACKNOWLEDGED",
          actorType: "TENANT_LINK",
          scopeType: "WORKSPACE",
          scopeId: contact.workspaceId,
          payload: { from: m.from, text: m.text?.body ?? "", wamid: m.id },
        });
      }
    }
  }
}
