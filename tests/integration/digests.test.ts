import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import { recordNotification } from "@/server/notify/record";
import { sendUserDailyDigests, sendUserWeeklyDigests } from "@/server/services/digests";
import { setNotificationPreference } from "@/server/services/notifications";

// PR5 — email batching. The in-app feed is the live surface; email is a batched
// backstop routed by per-category cadence, with urgent always-immediate and a
// failed-send fallback so a permanently-FAILED immediate email is never dropped.

let W: TestActor;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Digest WS"); // one FIDUCIARY overseer, default DAILY cadence
});

function fire(templateCode: string, subject: string, urgent = false) {
  return recordNotification({
    workspaceId: W.workspaceId,
    templateCode,
    subject,
    body: subject,
    recipientUserIds: [W.userId],
    urgent,
  });
}

const countMessages = (where: object) => prisma.notificationMessage.count({ where });

describe("email digest batching", () => {
  it("rolls N routine events into a single daily digest email", async () => {
    await fire("cheque_v1", "Cheque A due");
    await fire("cheque_v1", "Cheque B due");
    await fire("payment_late_v1", "Cheque C overdue");

    // Deferred: feed items exist, no per-event email yet.
    expect(await countMessages({ workspaceId: W.workspaceId, channel: "INAPP" })).toBe(3);
    expect(await countMessages({ workspaceId: W.workspaceId, channel: "EMAIL" })).toBe(0);

    await sendUserDailyDigests(W.workspaceId);

    const digests = await prisma.notificationMessage.findMany({
      where: { workspaceId: W.workspaceId, templateCode: "daily_digest_v1", channel: "EMAIL" },
    });
    expect(digests).toHaveLength(1);
    expect(digests[0].toUserId).toBe(W.userId);
    for (const s of ["Cheque A due", "Cheque B due", "Cheque C overdue"]) {
      expect(digests[0].bodyRef).toContain(s);
    }
    // Source feed items are now marked digested.
    const undigested = await countMessages({
      workspaceId: W.workspaceId,
      channel: "INAPP",
      digestedAt: null,
    });
    expect(undigested).toBe(0);
  });

  it("is idempotent — a second daily run within the window sends nothing more", async () => {
    await fire("cheque_v1", "Cheque due");
    await sendUserDailyDigests(W.workspaceId);
    await sendUserDailyDigests(W.workspaceId);
    expect(await countMessages({ workspaceId: W.workspaceId, templateCode: "daily_digest_v1" })).toBe(1);
  });

  it("urgent bypasses the digest: emails immediately and is not re-sent", async () => {
    await fire("payment_bounced_v1", "Cheque bounced", true);
    // Immediate email exists before any digest.
    expect(await countMessages({ workspaceId: W.workspaceId, templateCode: "payment_bounced_v1", channel: "EMAIL" })).toBe(1);

    await sendUserDailyDigests(W.workspaceId);
    // No digest produced (the only item was urgent + emailed); no double-send.
    expect(await countMessages({ workspaceId: W.workspaceId, templateCode: "daily_digest_v1" })).toBe(0);
  });

  it("P0: a permanently-FAILED immediate email is swept into the next digest", async () => {
    await fire("payment_bounced_v1", "Cheque bounced", true);
    const email = await prisma.notificationMessage.findFirstOrThrow({
      where: { workspaceId: W.workspaceId, templateCode: "payment_bounced_v1", channel: "EMAIL" },
    });

    // While the send is still in-flight (QUEUED), the digest must NOT grab it.
    await sendUserDailyDigests(W.workspaceId);
    expect(await countMessages({ workspaceId: W.workspaceId, templateCode: "daily_digest_v1" })).toBe(0);

    // Once the email is terminally FAILED, the next digest re-includes the item.
    await prisma.notificationMessage.update({ where: { id: email.id }, data: { status: "FAILED" } });
    await sendUserDailyDigests(W.workspaceId);
    const digests = await prisma.notificationMessage.findMany({
      where: { workspaceId: W.workspaceId, templateCode: "daily_digest_v1", channel: "EMAIL" },
    });
    expect(digests).toHaveLength(1);
    expect(digests[0].bodyRef).toContain("Cheque bounced");
    expect(await countMessages({ workspaceId: W.workspaceId, channel: "INAPP", digestedAt: null })).toBe(0);
  });

  it("OFF keeps the feed item but never emails it", async () => {
    await setNotificationPreference(W.ctx, "DEADLINES", "OFF");
    await fire("cheque_v1", "Cheque due");

    expect(await countMessages({ workspaceId: W.workspaceId, channel: "INAPP", templateCode: "cheque_v1" })).toBe(1);
    await sendUserDailyDigests(W.workspaceId);
    expect(await countMessages({ workspaceId: W.workspaceId, channel: "EMAIL" })).toBe(0);
  });

  it("IMMEDIATE cadence emails at once without waiting for a digest", async () => {
    await setNotificationPreference(W.ctx, "PAYMENTS", "IMMEDIATE");
    await fire("payment_late_v1", "Cheque overdue");
    expect(await countMessages({ workspaceId: W.workspaceId, templateCode: "payment_late_v1", channel: "EMAIL" })).toBe(1);
  });

  it("weekly digest sends the portfolio summary even with no pending items, unless DIGEST is OFF", async () => {
    await sendUserWeeklyDigests(W.workspaceId);
    const weekly = await prisma.notificationMessage.findFirst({
      where: { workspaceId: W.workspaceId, templateCode: "weekly_digest_v1", channel: "EMAIL" },
    });
    expect(weekly).toBeTruthy();
    expect(weekly!.bodyRef).toContain("This week:");

    // Muting DIGEST suppresses it on a fresh workspace.
    const W2 = await makeWorkspace("Digest WS2");
    await setNotificationPreference(W2.ctx, "DIGEST", "OFF");
    await sendUserWeeklyDigests(W2.workspaceId);
    expect(await countMessages({ workspaceId: W2.workspaceId, templateCode: "weekly_digest_v1" })).toBe(0);
  });
});
