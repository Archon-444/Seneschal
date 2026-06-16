import type { Prisma, ScopeType } from "@prisma/client";
import { prisma } from "../db";
import { notify } from "./index";
import { categoryForTemplate } from "./categories";
import { loadPreferenceMap, type PreferenceMap } from "./preferences";

// Fan-in helper for INTERNAL user notifications. Replaces the per-admin notify()
// loops. Per recipient it always writes an in-app feed item, then routes email by
// the recipient's per-category cadence:
//   urgent | IMMEDIATE → email now (+ link the email row for the failed-send fallback)
//   DAILY  | WEEKLY    → defer; the digest job picks the feed item up
//   OFF               → feed only, never emailed
// It NEVER sets `digestedAt` — that timestamp means "included in a digest" and is
// owned solely by the digest job, so a permanently-failed immediate email can still
// fall back into the next digest (see services/digests.ts). Contacts have no feed
// or prefs and keep getting direct transactional notify() emails elsewhere.

export interface RecordNotificationInput {
  workspaceId: string;
  templateCode: string;
  subject: string;
  body: string;
  recipientUserIds: string[];
  urgent?: boolean;
  relatedType?: ScopeType;
  relatedId?: string;
  /** Preloaded once per workspace run to avoid an N+1; lazily loaded if omitted. */
  prefs?: PreferenceMap;
  db?: Prisma.TransactionClient;
}

export async function recordNotification(input: RecordNotificationInput): Promise<void> {
  const db = input.db ?? prisma;
  const recipients = [...new Set(input.recipientUserIds)];
  if (recipients.length === 0) return;

  const category = categoryForTemplate(input.templateCode);
  if (!category) throw new Error(`No notification category for template ${input.templateCode}`);
  const urgent = input.urgent ?? false;
  const prefs = input.prefs ?? (await loadPreferenceMap(input.workspaceId, recipients, db));

  for (const userId of recipients) {
    // 1) Always create the in-app feed item (delivered, unread).
    const feed = await notify(
      {
        workspaceId: input.workspaceId,
        channel: "INAPP",
        templateCode: input.templateCode,
        subject: input.subject,
        body: input.body,
        toUserId: userId,
        relatedType: input.relatedType,
        relatedId: input.relatedId,
        category,
        urgent,
      },
      db,
    );

    // 2) Route email by cadence (urgent always sends now).
    const cadence = prefs.cadence(userId, category);
    const sendNow = urgent || cadence === "IMMEDIATE";
    if (!sendNow) continue; // DAILY/WEEKLY deferred to digest; OFF never emails

    const email = await notify(
      {
        workspaceId: input.workspaceId,
        channel: "EMAIL",
        templateCode: input.templateCode,
        subject: input.subject,
        body: input.body,
        toUserId: userId,
        relatedType: input.relatedType,
        relatedId: input.relatedId,
        category,
        urgent,
      },
      db,
    );
    // Link the feed item to its email row so a terminally-FAILED send can be
    // swept back into the next digest rather than lost.
    await db.notificationMessage.update({
      where: { id: feed.id },
      data: { emailMessageId: email.id },
    });
  }
}
