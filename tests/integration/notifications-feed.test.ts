import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, resetDb, type TestActor } from "../helpers";
import { recordNotification } from "@/server/notify/record";
import {
  listMyNotifications,
  markAllRead,
  markRead,
  setNotificationPreference,
  unreadCount,
} from "@/server/services/notifications";
import { AuthzError } from "@/server/authz";

// PR5 — the in-app feed is self-data: scoped to the recipient, not a portfolio
// capability. A non-overseer recipient can still read their own feed; nobody can
// read or mark another user's items.

let W: TestActor;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Feed WS");
});

function fire(subject: string, recipientUserIds = [W.userId]) {
  return recordNotification({
    workspaceId: W.workspaceId,
    templateCode: "cheque_v1",
    subject,
    body: subject,
    recipientUserIds,
  });
}

describe("in-app notification feed", () => {
  it("lists unread-first and tracks the unread count", async () => {
    await fire("First");
    await fire("Second");
    expect(await unreadCount(W.ctx)).toBe(2);

    const { items } = await listMyNotifications(W.ctx);
    expect(items.map((i) => i.subject)).toEqual(["Second", "First"]); // newest unread first

    await markRead(W.ctx, items[0].id);
    expect(await unreadCount(W.ctx)).toBe(1);
    // The read item now sorts after the still-unread one.
    const after = await listMyNotifications(W.ctx);
    expect(after.items[0].subject).toBe("First");
  });

  it("a muted category is dropped from the badge but stays in the feed", async () => {
    await fire("Muted deadline"); // cheque_v1 → DEADLINES
    expect(await unreadCount(W.ctx)).toBe(1);

    await setNotificationPreference(W.ctx, "DEADLINES", "DAILY", false);
    expect(await unreadCount(W.ctx)).toBe(0); // muted from the badge
    expect((await listMyNotifications(W.ctx)).items).toHaveLength(1); // still in the feed
  });

  it("markAllRead clears every unread item", async () => {
    await fire("A");
    await fire("B");
    expect(await markAllRead(W.ctx)).toBe(2);
    expect(await unreadCount(W.ctx)).toBe(0);
  });

  it("a non-overseer recipient reads their OWN feed", async () => {
    const viewer = await addMember(W.workspaceId, "AGENT"); // not an overseer role
    await fire("For the viewer", [viewer.userId]);
    const { items } = await listMyNotifications(viewer.ctx);
    expect(items).toHaveLength(1);
    expect(items[0].subject).toBe("For the viewer");
    expect(await unreadCount(W.ctx)).toBe(0); // not the admin's item
  });

  it("cannot read or mark another user's item", async () => {
    await fire("Admin only");
    const { items } = await listMyNotifications(W.ctx);
    const other = await addMember(W.workspaceId, "MANAGER");

    expect(await unreadCount(other.ctx)).toBe(0);
    expect((await listMyNotifications(other.ctx)).items).toHaveLength(0);
    await expect(markRead(other.ctx, items[0].id)).rejects.toBeInstanceOf(AuthzError);
  });
});
